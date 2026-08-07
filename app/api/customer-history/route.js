import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HISTORY_MONTHS = 6;
const HISTORY_LIMIT = 5000;
const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
}

function cacheKeyFor(customerCode) {
  return `customer_history_cache:${normalizeCode(customerCode)}`;
}

function fromDateIso(monthsBack = HISTORY_MONTHS) {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsBack);
  return date.toISOString().slice(0, 10);
}

function isStaleCache(updatedAt) {
  if (!updatedAt) return true;
  const stamp = new Date(updatedAt);
  if (Number.isNaN(stamp.getTime())) return true;

  const now = new Date();
  return (
    stamp.getUTCFullYear() !== now.getUTCFullYear()
    || stamp.getUTCMonth() !== now.getUTCMonth()
    || stamp.getUTCDate() !== now.getUTCDate()
  );
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

  const role = String(currentProfile.role || "").toLowerCase();
  const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .in("role", ["salesman", "manager", "admin"])
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const allProfiles = profilesRes.data || [];
  const authUsers = usersRes.data?.users || [];

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = allProfiles;
  } else {
    const subordinateIds = new Set();

    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      const headCode = normalizeCode(metadata.head_salesman_code);
      if (headCode && headCode === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });

    members = allProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));
  }

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const visibleSalesmanCodes = [...new Set([
    ...members.map((member) => normalizeCode(member.salesman_code)).filter(Boolean),
    ...mutualGroupCodes,
  ])];

  return {
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleSalesmanCodes,
    mutualSalesmanCodes: mutualGroupCodes,
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
    throw new Error("You do not have access to this customer.");
  }

  return customer;
}

async function loadCached(admin, cacheKey) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", cacheKey)
    .maybeSingle();

  if (error) throw error;
  if (!data?.setting_value) return null;

  try {
    const parsed = JSON.parse(String(data.setting_value));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCached(admin, cacheKey, payload) {
  const { error } = await admin
    .from("system_settings")
    .upsert(
      {
        setting_key: cacheKey,
        setting_value: JSON.stringify(payload),
      },
      { onConflict: "setting_key" }
    );

  if (error) throw error;
}

async function fetchCustomerTransactions(admin, customerCode) {
  const fromDate = fromDateIso();

  const { data, error } = await admin
    .from("sales_raw")
    .select("id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
    .eq("customer_code", customerCode)
    .gte("transaction_date", fromDate)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) throw error;

  return {
    fromDate,
    transactions: Array.isArray(data) ? data : [],
  };
}

async function refreshCustomerCache(admin, customerCode, cacheKey) {
  const fresh = await fetchCustomerTransactions(admin, customerCode);
  const payload = {
    updatedAt: new Date().toISOString(),
    fromDate: fresh.fromDate,
    transactions: fresh.transactions,
    peerTransactions: [],
  };

  await writeCached(admin, cacheKey, payload);
  return payload;
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
    const forceRefresh = String(url.searchParams.get("refresh") || "").trim() === "1";

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const scope = await resolveScope(admin, token);
    await ensureCustomerVisible(admin, customerCode, scope);

    const key = cacheKeyFor(customerCode);
    const cached = await loadCached(admin, key);

    if (cached && !forceRefresh) {
      const stale = isStaleCache(cached.updatedAt);

      if (stale) {
        // Return previous data immediately, refresh snapshot in background.
        void refreshCustomerCache(admin, customerCode, key).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        customerCode,
        fromDate: cached.fromDate || fromDateIso(),
        updatedAt: cached.updatedAt || "",
        isStale: stale,
        isRefreshing: stale,
        source: "cache",
        transactions: Array.isArray(cached.transactions) ? cached.transactions : [],
        peerTransactions: Array.isArray(cached.peerTransactions) ? cached.peerTransactions : [],
      });
    }

    const payload = await refreshCustomerCache(admin, customerCode, key);

    return NextResponse.json({
      success: true,
      customerCode,
      fromDate: payload.fromDate,
      updatedAt: payload.updatedAt,
      isStale: false,
      isRefreshing: false,
      source: "fresh",
      transactions: payload.transactions,
      peerTransactions: payload.peerTransactions,
    });
  } catch (error) {
    const message = error.message || "Unable to load customer history.";
    const status = /not authenticated|login|profile|access|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
