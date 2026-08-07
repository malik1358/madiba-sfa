import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HISTORY_MONTHS = 6;
const HISTORY_LIMIT = 5000;
const PEER_LIMIT = 30000;
const CACHE_VERSION = 4;
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

function monthKey(value) {
  const date = parseDateValue(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseDateValue(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const isoDate = new Date(`${text.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  // Handles formats like 30/04/2025 or 30-04-2025.
  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(utc.getTime())) return utc;
  }

  // Handles formats like "Wednesday, April 30, 2025".
  const longMonthMatch = text.match(/(?:^|,\s*)([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (longMonthMatch) {
    const candidate = new Date(`${longMonthMatch[1]} ${longMonthMatch[2]}, ${longMonthMatch[3]} UTC`);
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthStartFromKey(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-01`;
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
    // Some customer codes can be present in uploaded datasets but missing in customers master.
    // Allow request to continue; downstream sales query will return empty transactions if no history exists.
    return {
      customer_code: customerCode,
      current_salesman_code: "",
    };
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
  const { data, error } = await admin
    .from("sales_raw")
    .select("id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
    .eq("customer_code", customerCode)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  // Sort in JS by parsed date to avoid DB text-order artifacts.
  const sortedRows = rows
    .map((row) => {
      const parsed = parseDateValue(row.transaction_date);
      return {
        ...row,
        __stamp: parsed ? parsed.getTime() : 0,
      };
    })
    .sort((a, b) => {
      if (b.__stamp !== a.__stamp) return b.__stamp - a.__stamp;
      return Number(b.id || 0) - Number(a.id || 0);
    });

  const selectedMonthKeys = [];
  const selectedMonthSet = new Set();

  for (const row of sortedRows) {
    const key = monthKey(row.transaction_date);
    if (!key || selectedMonthSet.has(key)) continue;

    selectedMonthSet.add(key);
    selectedMonthKeys.push(key);

    if (selectedMonthSet.size >= HISTORY_MONTHS) break;
  }

  const filtered = sortedRows
    .filter((row) => selectedMonthSet.has(monthKey(row.transaction_date)))
    .map(({ __stamp, ...row }) => row);

  const lastMonthKey = selectedMonthKeys.at(-1) || "";

  return {
    fromDate: monthStartFromKey(lastMonthKey),
    monthKeys: selectedMonthKeys,
    transactions: filtered,
  };
}

async function fetchPeerTransactions(admin, scope, selectedMonthKeys, customerCode) {
  const monthSet = new Set((selectedMonthKeys || []).filter(Boolean));
  if (monthSet.size === 0) return [];

  let query = admin
    .from("sales_raw")
    .select("id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
    .neq("customer_code", customerCode)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(PEER_LIMIT);

  if (!scope.hasAllAccess && Array.isArray(scope.visibleSalesmanCodes) && scope.visibleSalesmanCodes.length > 0) {
    query = query.in("salesman_code", scope.visibleSalesmanCodes);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows
    .filter((row) => monthSet.has(monthKey(row.transaction_date)))
    .map((row) => {
      const parsed = parseDateValue(row.transaction_date);
      return {
        ...row,
        __stamp: parsed ? parsed.getTime() : 0,
      };
    })
    .sort((a, b) => {
      if (b.__stamp !== a.__stamp) return b.__stamp - a.__stamp;
      return Number(b.id || 0) - Number(a.id || 0);
    })
    .map(({ __stamp, ...row }) => row);
}

async function refreshCustomerCache(admin, customerCode, cacheKey, scope) {
  const fresh = await fetchCustomerTransactions(admin, customerCode);
  const peerTransactions = await fetchPeerTransactions(admin, scope, fresh.monthKeys, customerCode);
  const payload = {
    version: CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    fromDate: fresh.fromDate,
    transactions: fresh.transactions,
    peerTransactions,
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

    const isCurrentCacheVersion = Number(cached?.version || 0) === CACHE_VERSION;

    if (cached && isCurrentCacheVersion && !forceRefresh) {
      const stale = isStaleCache(cached.updatedAt);

      if (stale) {
        // Return previous data immediately, refresh snapshot in background.
        void refreshCustomerCache(admin, customerCode, key, scope).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        customerCode,
        fromDate: cached.fromDate || "",
        updatedAt: cached.updatedAt || "",
        isStale: stale,
        isRefreshing: stale,
        source: "cache",
        transactions: Array.isArray(cached.transactions) ? cached.transactions : [],
        peerTransactions: Array.isArray(cached.peerTransactions) ? cached.peerTransactions : [],
      });
    }

    const fresh = await fetchCustomerTransactions(admin, customerCode);
    const peerTransactions = await fetchPeerTransactions(admin, scope, fresh.monthKeys, customerCode);
    const payload = {
      version: CACHE_VERSION,
      updatedAt: new Date().toISOString(),
      fromDate: fresh.fromDate,
      transactions: fresh.transactions,
      peerTransactions,
    };
    await writeCached(admin, key, payload);

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
