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

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
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
      .select("id,role,salesman_code,salesman_name")
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const allProfiles = profilesRes.data || [];
  const scopedProfiles = allProfiles.filter((profile) => isSalesTeamRole(profile.role));
  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((entry) => [entry.id, entry]));

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = scopedProfiles;
  } else {
    const subordinateIds = new Set();

    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      const headCode = normalizeCode(metadata.head_salesman_code);
      if (headCode && headCode === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });

    members = scopedProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));

    // Keep self-scope even when profile role text is dirty (case/spacing mismatch).
    if (!members.some((profile) => profile.id === currentProfile.id)) {
      members = [currentProfile, ...members];
    }
  }

  const visibleMembers = members.map((profile) => {
    const authUser = authMap.get(profile.id);
    return {
      id: profile.id,
      role: profile.role || "",
      salesman_code: profile.salesman_code || "",
      salesman_name: profile.salesman_name || "",
      email: authUser?.email || "",
    };
  });

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const currentAuthUser = authMap.get(currentProfile.id) || user;

  const visibleSalesmanCodes = [...new Set([
    ...members.flatMap((member) => profileCodeCandidates(member)),
    ...authCodeCandidates(currentAuthUser),
    ...mutualGroupCodes,
  ])];

  return {
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleSalesmanCodes,
  };
}

async function fetchVisibleCustomers(admin, scope) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  const normalizedScopeCodes = new Set((scope.visibleSalesmanCodes || []).map((code) => normalizeCode(code)).filter(Boolean));

  while (true) {
    let query = admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,latest_transaction_date,customer_type,city,area,mobile")
      .eq("is_active", true)
      .order("customer_name")
      .range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;

    const chunk = (data || []).filter((row) => {
      if (scope.hasAllAccess) return true;
      if (normalizedScopeCodes.size === 0) return false;
      return normalizedScopeCodes.has(normalizeCode(row.current_salesman_code));
    });
    rows.push(...chunk);

    if ((data || []).length < pageSize) break;
    from += pageSize;
  }

  return rows;
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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const scope = await resolveScope(admin, token);
    const customers = await fetchVisibleCustomers(admin, scope);

    return NextResponse.json({
      success: true,
      customers,
      count: customers.length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load visible customers." }, { status: 500 });
  }
}
