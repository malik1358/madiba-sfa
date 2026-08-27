import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OUTSTANDING_DATASET_KEY,
  customerCodeCandidates,
  customerMatchesOutstandingCodeSet,
  resolveOutstandingCustomerOwnership,
} from "../../lib/outstanding";
import { mergeSalesSnapshots } from "../../lib/salesHistory";
import { buildSalesmanScopeMatchers } from "../../lib/mutualSalesmanGroups.js";
import {
  customerSalesmanAssignmentMatchesScope,
  resolvePeersUnderSameHeadUserIds,
  resolveSubordinateUserIds,
} from "../../lib/salesHierarchy.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HISTORY_MONTHS = 6;
const HISTORY_LIMIT = 30000;
const PEER_LIMIT = 30000;
const CACHE_VERSION = 9;
const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isProductPromoterRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "product-promoter" || normalized === "product_promoter";
}

function extractEmailLocalPart(email) {
  const raw = String(email || "").trim().toLowerCase();
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function flexibleNameLikePattern(value) {
  const tokens = String(value || "")
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  return tokens.length > 0 ? `%${tokens.join("%")}%` : "";
}

function namesLooselyMatch(left, right) {
  const leftToken = normalizeLooseToken(left);
  const rightToken = normalizeLooseToken(right);
  if (!leftToken || !rightToken) return false;
  return leftToken === rightToken || leftToken.includes(rightToken) || rightToken.includes(leftToken);
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function identitySearchPattern(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, "%")
    .replace(/^%+|%+$/g, "");
}

function isSalesTeamRole(role) {
  const normalized = normalizeRole(role);
  return ["salesman", "manager", "admin", "invoice_maker", "invoice-maker"].includes(normalized);
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
    normalizeCode(metadata.head_salesman_name),
    normalizeCode(localPart),
    normalizeCode(localPart.replace(/[._-]+/g, " ")),
    normalizeCode(localPart.replace(/[._-]+/g, "")),
  ].filter(Boolean);
}

function fuzzyMatchedProfileCodes(allProfiles, authUser) {
  const localPart = extractEmailLocalPart(authUser?.email);
  const localToken = normalizeLooseToken(localPart);
  if (!localToken) return [];

  return allProfiles
    .filter((profile) => {
      const nameToken = normalizeLooseToken(profile?.salesman_name);
      const codeToken = normalizeLooseToken(profile?.salesman_code);
      return (
        (nameToken && (nameToken.includes(localToken) || localToken.includes(nameToken)))
        || (codeToken && (codeToken.includes(localToken) || localToken.includes(codeToken)))
      );
    })
    .flatMap((profile) => profileCodeCandidates(profile));
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
}

function cacheKeyFor(customerCode, scope) {
  const scopeIdentity = scope.hasAllAccess
    ? "ALL"
    : [...new Set(scope.visibleSalesmanCodes || [])].sort().join("|");
  let scopeHash = 0;

  for (let index = 0; index < scopeIdentity.length; index += 1) {
    scopeHash = ((scopeHash * 31) + scopeIdentity.charCodeAt(index)) >>> 0;
  }

  return `customer_history_cache:${normalizeCode(customerCode)}:${scopeHash.toString(36)}`;
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

async function hasOutstandingCustomerAccess(admin, customerCode, scope) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  try {
    const dataset = JSON.parse(data?.setting_value || "null");
    const ownership = resolveOutstandingCustomerOwnership(dataset, scope.visibleSalesmanCodes);
    return customerMatchesOutstandingCodeSet(customerCode, ownership.ownedCustomerCodes);
  } catch {
    return false;
  }
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
  const currentAuthUser = authMap.get(currentProfile.id) || user;
  const currentMetadata = currentAuthUser?.user_metadata || currentAuthUser?.app_metadata || {};
  const inheritedHeadCode = normalizeCode(currentMetadata.head_salesman_code);

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = scopedProfiles;
  } else if (isProductPromoterRole(role) && inheritedHeadCode) {
    const headProfile = {
      salesman_code: inheritedHeadCode,
      salesman_name: currentMetadata.head_salesman_name || inheritedHeadCode,
    };
    const peerIds = resolvePeersUnderSameHeadUserIds(authUsers, headProfile);

    members = scopedProfiles.filter((profile) => {
      const profileCode = normalizeCode(profile.salesman_code);
      return profileCode === inheritedHeadCode || peerIds.has(profile.id);
    });
  } else {
    const subordinateIds = resolveSubordinateUserIds(authUsers, currentProfile);

    members = scopedProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));

    // Keep self-scope even when profile role text is dirty (case/spacing mismatch).
    if (!members.some((profile) => profile.id === currentProfile.id)) {
      members = [currentProfile, ...members];
    }
  }

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const scopeMatchers = buildSalesmanScopeMatchers(members);
  const visibleSalesmanCodes = [...new Set([
    ...members.flatMap((member) => profileCodeCandidates(member)),
    ...authCodeCandidates(currentAuthUser),
    ...fuzzyMatchedProfileCodes(scopedProfiles, currentAuthUser),
    ...mutualGroupCodes,
  ])];
  const identitySearchPatterns = [...new Set(
    visibleSalesmanCodes.map(identitySearchPattern).filter(Boolean),
  )];

  return {
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleSalesmanCodes,
    mutualSalesmanCodes: mutualGroupCodes,
    identitySearchPatterns,
    scopeMatchers,
  };
}

async function ensureCustomerVisible(admin, customerCode, customerName, scope) {
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

  async function hasHistoricalSalesAccess(codeCandidate) {
    const scopedSalesmanCodes = scope.visibleSalesmanCodes || [];
    const baseQuery = () => admin
      .from("sales_raw")
      .select("id")
      .eq("customer_code", codeCandidate)
      .limit(1);

    if (scopedSalesmanCodes.length > 0) {
      const { data: scopedRows, error: scopedError } = await baseQuery().in("salesman_code", scopedSalesmanCodes);
      if (scopedError) throw scopedError;
      if (Array.isArray(scopedRows) && scopedRows[0]?.id) return true;
    }

    if (scope.identitySearchPatterns.length > 0) {
      const identityFilters = scope.identitySearchPatterns.flatMap((pattern) => [
        `salesman_code.ilike.%${pattern}%`,
        `salesman_name.ilike.%${pattern}%`,
      ]);
      const { data: nameRows, error: nameError } = await baseQuery().or(identityFilters.join(","));
      if (nameError) throw nameError;
      if (Array.isArray(nameRows) && nameRows[0]?.id) return true;
    }

    const { data: rawRows, error: rawError } = await baseQuery();
    if (rawError) throw rawError;
    return Boolean(Array.isArray(rawRows) && rawRows[0]?.id);
  }

  async function hasHistoricalNameAccess(nameCandidate) {
    const normalizedName = normalizeName(nameCandidate);
    if (!normalizedName) return false;
    const looseLike = flexibleNameLikePattern(normalizedName);
    if (!looseLike) return false;

    const scopedSalesmanCodes = scope.visibleSalesmanCodes || [];
    const baseQuery = () => admin
      .from("sales_raw")
      .select("id")
      .ilike("customer_name", looseLike)
      .limit(1);

    if (scopedSalesmanCodes.length > 0) {
      const { data: scopedRows, error: scopedError } = await baseQuery().in("salesman_code", scopedSalesmanCodes);
      if (scopedError) throw scopedError;
      if (Array.isArray(scopedRows) && scopedRows[0]?.id) return true;
    }

    if (scope.identitySearchPatterns.length > 0) {
      const identityFilters = scope.identitySearchPatterns.flatMap((pattern) => [
        `salesman_code.ilike.%${pattern}%`,
        `salesman_name.ilike.%${pattern}%`,
      ]);
      const { data: nameRows, error: nameError } = await baseQuery().or(identityFilters.join(","));
      if (nameError) throw nameError;
      if (Array.isArray(nameRows) && nameRows[0]?.id) return true;
    }

    const { data: rawRows, error: rawError } = await baseQuery();
    if (rawError) throw rawError;
    return Boolean(Array.isArray(rawRows) && rawRows[0]?.id);
  }

  if (!scope.hasAllAccess && !customerSalesmanAssignmentMatchesScope(customer.current_salesman_code, scope)) {
    const normalizedInput = normalizeCode(customerCode);
    const leadingCodeMatch = normalizedInput.match(/^([A-Z0-9]+)/);
    const leadingCode = normalizeCode(leadingCodeMatch?.[1] || "");
    const codeCandidates = [...new Set([normalizedInput, leadingCode].filter(Boolean))];

    let hasHistoryAccess = false;
    for (const codeCandidate of codeCandidates) {
      const { data: historyRow, error: historyError } = await admin
        .from("active_sales")
        .select("id")
        .eq("customer_code", codeCandidate)
        .in("salesman_code", scope.visibleSalesmanCodes || [])
        .limit(1);

      if (historyError) throw historyError;
      if (Array.isArray(historyRow) && historyRow[0]?.id) {
        hasHistoryAccess = true;
        break;
      }

      if (!hasHistoryAccess) {
        hasHistoryAccess = await hasHistoricalSalesAccess(codeCandidate);
      }

      if (!hasHistoryAccess) {
        hasHistoryAccess = await hasHistoricalNameAccess(customerName);
      }

      if (!hasHistoryAccess && scope.identitySearchPatterns.length > 0) {
        const identityFilters = scope.identitySearchPatterns.flatMap((pattern) => [
          `salesman_code.ilike.%${pattern}%`,
          `salesman_name.ilike.%${pattern}%`,
        ]);
        const { data: nameHistoryRow, error: nameHistoryError } = await admin
          .from("active_sales")
          .select("id")
          .eq("customer_code", codeCandidate)
          .or(identityFilters.join(","))
          .limit(1);

        if (nameHistoryError) throw nameHistoryError;
        if (Array.isArray(nameHistoryRow) && nameHistoryRow[0]?.id) {
          hasHistoryAccess = true;
          break;
        }
      }
    }

    if (!hasHistoryAccess) {
      hasHistoryAccess = await hasOutstandingCustomerAccess(admin, customerCode, scope);
    }

    if (!hasHistoryAccess) {
      throw new Error("You do not have access to this customer.");
    }
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

async function fetchCustomerTransactions(admin, customerCode, customerName, scope) {
  const normalizedInput = normalizeCode(customerCode);
  const leadingCodeMatch = normalizedInput.match(/^([A-Z0-9]+)/);
  const leadingCode = normalizeCode(leadingCodeMatch?.[1] || "");
  const codeCandidates = [...new Set([normalizedInput, leadingCode].filter(Boolean))];
  const normalizedCustomerName = normalizeName(customerName);
  const target = leadingCode || normalizedInput;
  const targetNoZeros = target.replace(/^0+/, "");

  async function fetchHistoryPages(buildQuery) {
    const pageSize = 1000;
    const result = [];

    while (result.length < HISTORY_LIMIT) {
      const from = result.length;
      const { data, error } = await buildQuery()
        .range(from, Math.min(from + pageSize, HISTORY_LIMIT) - 1);

      if (error) throw error;
      const page = data || [];
      result.push(...page);
      if (page.length < pageSize) break;
    }

    return result;
  }

  function customerQuery(matchValue) {
    return admin
      .from("sales_raw")
      .select("id,import_batch_id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
      .eq("customer_code", matchValue)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false });
  }

  let rows = [];
  for (const codeCandidate of codeCandidates) {
    rows = await fetchHistoryPages(() => customerQuery(codeCandidate));
    if (rows.length > 0) break;
  }

  if (rows.length === 0 && target) {
    // Fallback for dirty imported codes (different case/spacing/leading zeros or code+suffix text).
    const looseLike = `%${targetNoZeros || target}%`;
    const fallbackData = await fetchHistoryPages(() => admin
      .from("sales_raw")
      .select("id,import_batch_id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
      .ilike("customer_code", looseLike)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false }));

    rows = (Array.isArray(fallbackData) ? fallbackData : []).filter((row) => {
      const rowCode = normalizeCode(row.customer_code);
      if (!rowCode) return false;
      const rowCodeNoZeros = rowCode.replace(/^0+/, "");
      return (
        rowCode === target
        || rowCodeNoZeros === targetNoZeros
        || rowCode.startsWith(`${target} `)
        || rowCodeNoZeros.startsWith(`${targetNoZeros} `)
      );
    });
  }

  if (rows.length === 0 && normalizedCustomerName) {
    const looseNameLike = flexibleNameLikePattern(normalizedCustomerName);
    if (looseNameLike) {
    const fallbackData = await fetchHistoryPages(() => admin
      .from("sales_raw")
      .select("id,import_batch_id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
      .ilike("customer_name", looseNameLike)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false }));

    rows = (Array.isArray(fallbackData) ? fallbackData : []).filter((row) => {
      return namesLooselyMatch(row.customer_name, normalizedCustomerName)
        || namesLooselyMatch(row.customer_code, normalizedCustomerName);
    });
    }
  }

  // Merge overlapping replacement snapshots before selecting historical months.
  const sortedRows = mergeSalesSnapshots(rows)
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
    .from("active_sales")
    .select("id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class")
    .neq("customer_code", customerCode)
    .order("transaction_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(PEER_LIMIT);

  if (!scope.hasAllAccess) {
    if (!Array.isArray(scope.identitySearchPatterns) || scope.identitySearchPatterns.length === 0) {
      return [];
    }

    const identityFilters = scope.identitySearchPatterns.flatMap((pattern) => [
      `salesman_code.ilike.%${pattern}%`,
      `salesman_name.ilike.%${pattern}%`,
    ]);
    query = query.or(identityFilters.join(","));
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
  const fresh = await fetchCustomerTransactions(admin, customerCode, "", scope);
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
    const customerName = normalizeName(url.searchParams.get("customerName"));
    const forceRefresh = String(url.searchParams.get("refresh") || "").trim() === "1";

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const scope = await resolveScope(admin, token);
    await ensureCustomerVisible(admin, customerCode, customerName, scope);

    const key = cacheKeyFor(customerCode, scope);
    const cached = await loadCached(admin, key);

    const isCurrentCacheVersion = Number(cached?.version || 0) === CACHE_VERSION;

    if (cached && isCurrentCacheVersion && !forceRefresh) {
      const stale = isStaleCache(cached.updatedAt);
      const cachedTransactions = Array.isArray(cached.transactions) ? cached.transactions : [];

      if (cachedTransactions.length === 0) {
        const fresh = await fetchCustomerTransactions(admin, customerCode, customerName, scope);
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
      }

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
        transactions: cachedTransactions,
        peerTransactions: Array.isArray(cached.peerTransactions) ? cached.peerTransactions : [],
      });
    }

    const fresh = await fetchCustomerTransactions(admin, customerCode, customerName, scope);
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
