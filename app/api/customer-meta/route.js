import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function extractEmailLocalPart(email) {
  const raw = String(email || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isSalesTeamRole(role) {
  const normalized = normalizeRole(role);
  return ["salesman", "manager", "admin", "invoice_maker", "invoice-maker"].includes(normalized);
}

const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
}

function profileCodeCandidates(profile) {
  return [normalizeCode(profile?.salesman_code), normalizeCode(profile?.salesman_name)].filter(Boolean);
}

function authCodeCandidates(authUser) {
  const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
  const localPart = extractEmailLocalPart(authUser?.email);

  return [
    normalizeCode(metadata.salesman_code),
    normalizeCode(metadata.salesman_name),
    normalizeCode(metadata.head_salesman_code),
    normalizeCode(localPart),
    normalizeCode(localPart.replace(/[._-]+/g, " ")),
    normalizeCode(localPart.replace(/[._-]+/g, "")),
  ].filter(Boolean);
}

function settingKeyFor(customerCode) {
  return `customer_meta:${normalizeCode(customerCode)}`;
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !currentProfile) {
    throw new Error("Profile not found.");
  }

  const role = normalizeRole(currentProfile.role);
  const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((entry) => [entry.id, entry]));
  const subordinateIds = new Set();

  if (!["admin", "manager"].includes(role)) {
    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      if (normalizeCode(metadata.head_salesman_code) === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });
  }

  const allProfiles = profilesRes.data || [];
  const scopedProfiles = allProfiles.filter((profile) => isSalesTeamRole(profile.role));
  let visibleProfiles = scopedProfiles.filter((profile) => {
    if (["admin", "manager"].includes(role)) return true;
    return profile.id === currentProfile.id || subordinateIds.has(profile.id);
  });

  if (!["admin", "manager"].includes(role) && !visibleProfiles.some((profile) => profile.id === currentProfile.id)) {
    visibleProfiles = [currentProfile, ...visibleProfiles];
  }

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const currentAuthUser = authMap.get(currentProfile.id) || user;

  return {
    hasAllAccess: ["admin", "manager"].includes(role),
    visibleSalesmanCodes: [...new Set([
      ...visibleProfiles.flatMap((profile) => profileCodeCandidates(profile)),
      ...authCodeCandidates(currentAuthUser),
      ...mutualGroupCodes,
    ])],
  };
}

async function ensureCustomerVisible(admin, customerCode, scope) {
  const { data: customer, error } = await admin
    .from("customers")
    .select("customer_code,current_salesman_code")
    .eq("customer_code", customerCode)
    .maybeSingle();

  if (error) throw error;
  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (!scope.hasAllAccess && !scope.visibleSalesmanCodes.includes(normalizeCode(customer.current_salesman_code))) {
    const normalizedInput = normalizeCode(customerCode);
    const leadingCodeMatch = normalizedInput.match(/^([A-Z0-9]+)/);
    const leadingCode = normalizeCode(leadingCodeMatch?.[1] || "");
    const codeCandidates = [...new Set([normalizedInput, leadingCode].filter(Boolean))];

    let hasHistoryAccess = false;
    for (const codeCandidate of codeCandidates) {
      const { data: historyRow, error: historyError } = await admin
        .from("sales_raw")
        .select("id")
        .eq("customer_code", codeCandidate)
        .in("salesman_code", scope.visibleSalesmanCodes || [])
        .limit(1)
        .maybeSingle();

      if (historyError) throw historyError;
      if (historyRow?.id) {
        hasHistoryAccess = true;
        break;
      }
    }

    if (!hasHistoryAccess) {
      throw new Error("You do not have access to this customer.");
    }
  }

  return customer;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(request.url);
    const customerCode = normalizeCode(url.searchParams.get("customerCode"));
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    await ensureCustomerVisible(admin, customerCode, scope);

    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", settingKeyFor(customerCode))
      .maybeSingle();

    if (error) throw error;

    let value = { nationalAddress: "", documents: [] };
    if (data?.setting_value) {
      try {
        value = JSON.parse(String(data.setting_value));
      } catch {
        value = { nationalAddress: "", documents: [] };
      }
    }

    return NextResponse.json({ success: true, customerCode, value });
  } catch (error) {
    const message = error.message || "Unable to load customer meta.";
    const status = /access|session|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const customerCode = normalizeCode(body?.customerCode);
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const value = {
      nationalAddress: String(body?.nationalAddress || "").trim(),
      documents: Array.isArray(body?.documents)
        ? body.documents.map((document) => ({
            type: String(document?.type || "OTHER").trim() || "OTHER",
            name: String(document?.name || "").trim(),
            size: Number(document?.size || 0),
            mimeType: String(document?.mimeType || "").trim(),
          }))
        : [],
    };

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    await ensureCustomerVisible(admin, customerCode, scope);

    const { error } = await admin
      .from("system_settings")
      .upsert(
        {
          setting_key: settingKeyFor(customerCode),
          setting_value: JSON.stringify(value),
        },
        { onConflict: "setting_key" }
      );

    if (error) throw error;

    return NextResponse.json({ success: true, customerCode, value });
  } catch (error) {
    const message = error.message || "Unable to save customer meta.";
    const status = /access|session|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}