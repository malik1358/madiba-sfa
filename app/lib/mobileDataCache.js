import { fetchWithLocalCache, readCacheEntry, writeCacheEntry } from "./localDataStore.js";
import { getSupabaseClient } from "./supabase.js";

export const CACHE_TTL = {
  scopeMs: 15 * 60 * 1000,
  customersBasicMs: 30 * 60 * 1000,
  customersEnrichedMs: 15 * 60 * 1000,
  customerHistoryMs: 24 * 60 * 60 * 1000,
  itemsMasterMs: 24 * 60 * 60 * 1000,
  outstandingMs: 24 * 60 * 60 * 1000,
  myDaySnapshotMs: 24 * 60 * 60 * 1000,
};

export function buildScopeHash(scope) {
  if (scope?.hasAllAccess) return "all";
  const codes = [...(scope?.visibleSalesmanCodes || [])]
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean)
    .sort();
  return codes.join("|") || "none";
}

function scopeCacheKey(userId) {
  return `scope:v1:${String(userId || "").trim()}`;
}

function customersCacheKey(scope, enriched = false) {
  const prefix = enriched ? "customers:visible:enriched:v1" : "customers:visible:basic:v1";
  return `${prefix}:${buildScopeHash(scope)}`;
}

function customerHistoryCacheKey(scope, customerCode) {
  return `history:v1:${buildScopeHash(scope)}:${String(customerCode || "").trim().toUpperCase()}`;
}

function itemsMasterCacheKey() {
  return "items:master:v1";
}

function outstandingCacheKey(customerCode, customerName) {
  return `outstanding:v1:${String(customerCode || "").trim().toUpperCase()}:${String(customerName || "").trim().toUpperCase()}`;
}

function myDaySnapshotCacheKey(userId, dateKey) {
  return `myday:v1:${String(userId || "").trim()}:${String(dateKey || "").trim()}`;
}

async function fetchSalesScopeNetwork(accessToken) {
  const response = await fetch("/api/user/sales-scope", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Unable to load access scope.");
  }
  return data;
}

async function fetchVisibleCustomersNetwork(accessToken, { enriched = false } = {}) {
  const query = enriched ? "?includeRecentSales=1&includeOutstanding=1" : "";
  const response = await fetch(`/api/customers/visible${query}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load visible customers.");
  }

  if (enriched) {
    return {
      customers: payload.customers || [],
      inactiveCustomers: payload.inactiveCustomers || [],
    };
  }

  return payload.customers || [];
}

async function fetchCustomerHistoryNetwork(accessToken, customerCode) {
  const response = await fetch(
    `/api/customer-history?customerCode=${encodeURIComponent(customerCode)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load customer history.");
  }

  return {
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
    peerTransactions: Array.isArray(payload.peerTransactions) ? payload.peerTransactions : [],
  };
}

async function fetchItemsMasterNetwork() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase.from("items_master").select("*");
  if (error) throw error;

  return {
    rows: data || [],
    status: `SUCCESS: ${data?.length || 0} rows`,
  };
}

async function fetchOutstandingNetwork(accessToken, customerCode, customerName) {
  const response = await fetch(
    `/api/outstanding?customerCode=${encodeURIComponent(customerCode || "")}&customerName=${encodeURIComponent(customerName || "")}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load outstanding data.");
  }

  return {
    bucketLabels: payload.bucketLabels || [],
    customer: payload.customer || null,
    customerInvoices: payload.customerInvoices || [],
    uploadedAt: payload.uploadedAt || null,
    fileName: payload.fileName || "",
    needsInvoiceRowsReupload: Boolean(payload.needsInvoiceRowsReupload),
  };
}

export async function fetchSalesScopeCached(options = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.user?.id) {
    throw new Error("Please login again.");
  }

  const result = await fetchWithLocalCache(
    scopeCacheKey(session.user.id),
    CACHE_TTL.scopeMs,
    () => fetchSalesScopeNetwork(session.access_token),
    { onUpdate: options.onUpdate },
  );

  return {
    scope: result.data,
    fromCache: result.fromCache,
    stale: result.stale,
  };
}

export async function fetchVisibleCustomersCached(accessToken, scope, options = {}) {
  const enriched = Boolean(options.enriched);
  const ttlMs = enriched ? CACHE_TTL.customersEnrichedMs : CACHE_TTL.customersBasicMs;

  return fetchWithLocalCache(
    customersCacheKey(scope, enriched),
    ttlMs,
    () => fetchVisibleCustomersNetwork(accessToken, { enriched }),
    { onUpdate: options.onUpdate },
  );
}

export async function fetchCustomerHistoryCached(accessToken, scope, customerCode, options = {}) {
  return fetchWithLocalCache(
    customerHistoryCacheKey(scope, customerCode),
    CACHE_TTL.customerHistoryMs,
    () => fetchCustomerHistoryNetwork(accessToken, customerCode),
    { onUpdate: options.onUpdate },
  );
}

export async function fetchItemsMasterCached(options = {}) {
  return fetchWithLocalCache(
    itemsMasterCacheKey(),
    CACHE_TTL.itemsMasterMs,
    fetchItemsMasterNetwork,
    { onUpdate: options.onUpdate },
  );
}

export async function fetchOutstandingCached(accessToken, customerCode, customerName, options = {}) {
  return fetchWithLocalCache(
    outstandingCacheKey(customerCode, customerName),
    CACHE_TTL.outstandingMs,
    () => fetchOutstandingNetwork(accessToken, customerCode, customerName),
    { onUpdate: options.onUpdate },
  );
}

export async function readMyDaySnapshot(userId, dateKey) {
  const entry = await readCacheEntry(myDaySnapshotCacheKey(userId, dateKey));
  return entry?.value || null;
}

export async function writeMyDaySnapshot(userId, dateKey, snapshot) {
  return writeCacheEntry(
    myDaySnapshotCacheKey(userId, dateKey),
    snapshot,
    { ttlMs: CACHE_TTL.myDaySnapshotMs },
  );
}

export async function hydrateFoundationFromCache(userId) {
  const scopeEntry = await readCacheEntry(scopeCacheKey(userId));
  if (!scopeEntry?.value) return null;

  const scope = scopeEntry.value;
  const [customersEntry, itemsEntry] = await Promise.all([
    readCacheEntry(customersCacheKey(scope, false)),
    readCacheEntry(itemsMasterCacheKey()),
  ]);

  return {
    scope,
    customers: customersEntry?.value || [],
    itemsMaster: itemsEntry?.value?.rows || [],
    itemMasterStatus: itemsEntry?.value?.status || "Not loaded",
  };
}

export async function invalidateVisibleCustomersCache(scope) {
  const { removeCacheEntry } = await import("./localDataStore.js");
  await Promise.all([
    removeCacheEntry(customersCacheKey(scope, false)),
    removeCacheEntry(customersCacheKey(scope, true)),
  ]);
}
