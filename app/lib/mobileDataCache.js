import { fetchWithLocalCache, fetchWithLocalCacheResilient, readCacheEntry, writeCacheEntry } from "./localDataStore.js";
import {
  finishDataRefreshJob,
  markDataRefreshStep,
  seedDataRefreshMeta,
  snapshotRefreshSteps,
  startDataRefreshJob,
} from "./dataRefreshStatus.js";
import { getSupabaseClient } from "./supabase.js";
import { buildScopeHash } from "./scopeHash.js";
import {
  filterPendingOrdersForScope,
  PENDING_ORDER_STATUSES,
  PENDING_ORDERS_SELECT,
} from "./pendingOrdersQuery.js";

export { buildScopeHash } from "./scopeHash.js";

export const SNAPSHOT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
export const COLLECTION_QUEUES_READY_EVENT = "madiba-collection-queues-ready";
const MOBILE_SNAPSHOT_META_KEY = "mobileSnapshot:meta:v1";
const COLLECTION_QUEUE_HYDRATE_WAIT_MS = 45000;

export const CACHE_TTL = {
  scopeMs: 15 * 60 * 1000,
  customersBasicMs: 30 * 60 * 1000,
  customersEnrichedMs: 15 * 60 * 1000,
  customerHistoryMs: 24 * 60 * 60 * 1000,
  itemsMasterMs: 24 * 60 * 60 * 1000,
  outstandingMs: 24 * 60 * 60 * 1000,
  myDaySnapshotMs: 24 * 60 * 60 * 1000,
  collectionQueuesMs: 24 * 60 * 60 * 1000,
  pendingOrdersMs: 24 * 60 * 60 * 1000,
  mobileSnapshotMs: 7 * 24 * 60 * 60 * 1000,
};

function scopeCacheKey(userId) {
  return `scope:v2:${String(userId || "").trim()}`;
}

function customersCacheKey(scope, enriched = false) {
  const prefix = enriched ? "customers:visible:enriched:v8" : "customers:visible:basic:v5";
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

function collectionQueuesCacheKey(scope) {
  // v5: ignore empty queues left behind by the v4 hydrate-wait race.
  return `collectionQueues:v5:${buildScopeHash(scope)}`;
}

export function collectionQueuesHaveRows(queues) {
  return Boolean(
    queues?.dueCustomers?.length
    || queues?.notDueCustomers?.length
    || queues?.legalCustomers?.length,
  );
}

function isBrowserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function collectionScopeCacheKey(userId) {
  return `collectionScope:v1:${String(userId || "").trim()}`;
}

function myDaySnapshotCacheKey(userId, dateKey) {
  return `myday:v5:${String(userId || "").trim()}:${String(dateKey || "").trim()}`;
}

function pendingOrdersCacheKey(userId, scope) {
  return `pendingOrders:v1:${String(userId || "").trim()}:${buildScopeHash(scope)}`;
}

function pendingOrdersInvoiceMetaCacheKey(userId) {
  return `pendingOrdersInvoiceMeta:v1:${String(userId || "").trim()}`;
}

async function fetchMobileSnapshotNetwork(accessToken) {
  const response = await fetch("/api/mobile-snapshot", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load mobile snapshot.");
  }
  return payload.snapshot;
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

export async function invalidateSalesScopeCache(userId) {
  const { removeCacheEntry } = await import("./localDataStore.js");
  await removeCacheEntry(scopeCacheKey(userId));
}

export async function fetchSalesScopeCached(options = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.user?.id) {
    throw new Error("Please login again.");
  }

  if (options.forceRefresh) {
    await invalidateSalesScopeCache(session.user.id);
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

export async function upsertLocalVisibleCustomer(scope, customer) {
  if (!scope || !customer?.customer_code) return false;

  const code = String(customer.customer_code || "").trim().toUpperCase();
  const nextCustomer = { ...customer, customer_code: customer.customer_code };

  async function merge(enriched) {
    const key = customersCacheKey(scope, enriched);
    const entry = await readCacheEntry(key);
    if (enriched) {
      const current = entry?.value && typeof entry.value === "object" ? entry.value : { customers: [], inactiveCustomers: [] };
      const customers = [
        nextCustomer,
        ...(Array.isArray(current.customers) ? current.customers : []).filter((row) => (
          String(row?.customer_code || "").trim().toUpperCase() !== code
        )),
      ];
      await writeCacheEntry(key, { ...current, customers }, {
        ttlMs: enriched ? CACHE_TTL.customersEnrichedMs : CACHE_TTL.customersBasicMs,
      });
      return;
    }

    const current = Array.isArray(entry?.value) ? entry.value : [];
    await writeCacheEntry(
      key,
      [nextCustomer, ...current.filter((row) => String(row?.customer_code || "").trim().toUpperCase() !== code)],
      { ttlMs: CACHE_TTL.customersBasicMs },
    );
  }

  await Promise.all([merge(false), merge(true)]);
  return true;
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

export async function readMobileSnapshotMeta() {
  const entry = await readCacheEntry(MOBILE_SNAPSHOT_META_KEY);
  return entry?.value && typeof entry.value === "object" ? entry.value : null;
}

export async function writeMobileSnapshotMeta(meta) {
  if (!meta || typeof meta !== "object") return false;
  return writeCacheEntry(MOBILE_SNAPSHOT_META_KEY, meta, { ttlMs: CACHE_TTL.mobileSnapshotMs });
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

export async function invalidateCollectionQueuesForUser(userId) {
  const { removeCacheEntry } = await import("./localDataStore.js");
  const scopeEntry = await readCacheEntry(collectionScopeCacheKey(userId));
  if (!scopeEntry?.value) return;
  await removeCacheEntry(collectionQueuesCacheKey(scopeEntry.value));
}

export async function readCollectionQueuesForUser(userId) {
  const scopeEntry = await readCacheEntry(collectionScopeCacheKey(userId));
  if (!scopeEntry?.value) return null;
  const entry = await readCacheEntry(collectionQueuesCacheKey(scopeEntry.value));
  return entry?.value || null;
}

function emitCollectionQueuesReady() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COLLECTION_QUEUES_READY_EVENT));
}

export async function waitForHydratedCollectionQueues(userId, maxMs = COLLECTION_QUEUE_HYDRATE_WAIT_MS) {
  const existing = await readCollectionQueuesForUser(userId);
  // An empty queue is not "ready" — a partial hydrate can write {} before the
  // live API has customers. Keep waiting for rows or the full snapshot finish.
  if (collectionQueuesHaveRows(existing)) return existing;
  if (typeof window === "undefined" || !userId) return existing || null;

  return new Promise((resolve) => {
    let settled = false;

    const finish = async (acceptEmpty = false) => {
      if (settled) return;
      const next = await readCollectionQueuesForUser(userId);
      if (!acceptEmpty && !collectionQueuesHaveRows(next)) return;
      settled = true;
      window.removeEventListener(COLLECTION_QUEUES_READY_EVENT, onQueuesReady);
      window.removeEventListener("madiba-mobile-snapshot-hydrated", onSnapshotHydrated);
      window.clearTimeout(timer);
      resolve(next);
    };

    const onQueuesReady = () => {
      void finish(false);
    };

    const onSnapshotHydrated = () => {
      void finish(true);
    };

    const timer = window.setTimeout(() => {
      void finish(true);
    }, Math.max(0, Number(maxMs) || COLLECTION_QUEUE_HYDRATE_WAIT_MS));

    window.addEventListener(COLLECTION_QUEUES_READY_EVENT, onQueuesReady);
    window.addEventListener("madiba-mobile-snapshot-hydrated", onSnapshotHydrated);
  });
}

async function fetchCollectionQueuesNetwork(accessToken) {
  const response = await fetch("/api/payment-collections", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load payment collection queue.");
  }
  return {
    dueCustomers: payload.dueCustomers || [],
    notDueCustomers: payload.notDueCustomers || [],
    legalCustomers: payload.legalCustomers || [],
    salesScope: payload.salesScope || null,
    schedulerScope: payload.schedulerScope || null,
  };
}

export async function writeCollectionQueuesForUser(userId, scope, queues) {
  if (!userId || !scope || !queues) return false;

  const collectionScope = {
    hasAllAccess: Boolean(scope?.hasAllAccess),
    visibleSalesmanCodes: Array.isArray(scope?.visibleSalesmanCodes) ? scope.visibleSalesmanCodes : [],
  };

  const cachePayload = {
    dueCustomers: queues.dueCustomers || [],
    notDueCustomers: queues.notDueCustomers || [],
    legalCustomers: queues.legalCustomers || [],
    salesScope: queues.salesScope || null,
    schedulerScope: queues.schedulerScope || null,
  };

  await Promise.all([
    writeCacheEntry(collectionScopeCacheKey(userId), collectionScope, { ttlMs: CACHE_TTL.scopeMs }),
    writeCacheEntry(collectionQueuesCacheKey(collectionScope), cachePayload, { ttlMs: CACHE_TTL.collectionQueuesMs }),
  ]);

  return true;
}

async function resolveCollectionScopeForUser(accessToken, userId, preferredScope = null) {
  if (preferredScope) {
    return {
      hasAllAccess: Boolean(preferredScope?.hasAllAccess),
      visibleSalesmanCodes: Array.isArray(preferredScope?.visibleSalesmanCodes) ? preferredScope.visibleSalesmanCodes : [],
    };
  }

  const cachedScope = await readCacheEntry(collectionScopeCacheKey(userId));
  if (cachedScope?.value) return cachedScope.value;

  const salesScope = await fetchSalesScopeNetwork(accessToken);
  return {
    hasAllAccess: Boolean(salesScope?.hasAllAccess),
    visibleSalesmanCodes: Array.isArray(salesScope?.visibleSalesmanCodes) ? salesScope.visibleSalesmanCodes : [],
  };
}

export async function fetchCollectionQueuesCached(accessToken, userId, options = {}) {
  if (!accessToken || !userId) {
    throw new Error("Please login again.");
  }

  const scope = await resolveCollectionScopeForUser(accessToken, userId, options.scope);
  const cacheKey = collectionQueuesCacheKey(scope);
  const cached = await readCacheEntry(cacheKey);
  const emptyCached = !collectionQueuesHaveRows(cached?.value);
  // Empty queues must not stick for the full TTL — refetch while online.
  const forceRefresh = Boolean(options.forceRefresh)
    || (emptyCached && isBrowserOnline());

  const result = await fetchWithLocalCacheResilient(
    cacheKey,
    CACHE_TTL.collectionQueuesMs,
    async () => {
      const queues = await fetchCollectionQueuesNetwork(accessToken);
      const writeScope = queues.salesScope || scope;
      await writeCollectionQueuesForUser(userId, writeScope, queues);
      // Keep the lookup key in sync when the API scope hash differs from the
      // provisional sales-scope used to start this fetch.
      if (buildScopeHash(writeScope) !== buildScopeHash(scope)) {
        await writeCacheEntry(cacheKey, {
          dueCustomers: queues.dueCustomers || [],
          notDueCustomers: queues.notDueCustomers || [],
          legalCustomers: queues.legalCustomers || [],
          salesScope: queues.salesScope || null,
          schedulerScope: queues.schedulerScope || null,
        }, { ttlMs: CACHE_TTL.collectionQueuesMs });
      }
      return queues;
    },
    {
      onUpdate: options.onUpdate,
      forceRefresh,
      revalidate: Boolean(options.revalidate),
    },
  );

  return {
    queues: result.data,
    fromCache: result.fromCache,
    stale: result.stale,
    offline: Boolean(result.offline),
  };
}

export async function hydrateFromMobileSnapshot(snapshot, userId) {
  if (!snapshot || !userId) return false;

  markDataRefreshStep("download", "done");
  markDataRefreshStep("collections", "running");
  const collectionWrites = [];
  const collectionScope = snapshot.collectionScope || snapshot.salesScope;
  if (collectionScope) {
    collectionWrites.push(writeCacheEntry(collectionScopeCacheKey(userId), collectionScope, { ttlMs: CACHE_TTL.scopeMs }));
    if (snapshot.collectionQueues) {
      collectionWrites.push(writeCacheEntry(
        collectionQueuesCacheKey(collectionScope),
        snapshot.collectionQueues,
        { ttlMs: CACHE_TTL.collectionQueuesMs },
      ));
    }
  }
  await Promise.all(collectionWrites);
  markDataRefreshStep("collections", "done");
  emitCollectionQueuesReady();

  markDataRefreshStep("customers", "running");
  const customerWrites = [];

  if (snapshot.salesScope) {
    customerWrites.push(writeCacheEntry(scopeCacheKey(userId), snapshot.salesScope, { ttlMs: CACHE_TTL.scopeMs }));
  }

  const customerScope = snapshot.customerScope || snapshot.salesScope;
  if (customerScope) {
    if (Array.isArray(snapshot.customersBasic)) {
      customerWrites.push(writeCacheEntry(
        customersCacheKey(customerScope, false),
        snapshot.customersBasic,
        { ttlMs: CACHE_TTL.customersBasicMs },
      ));
    }
    if (snapshot.customersEnriched) {
      customerWrites.push(writeCacheEntry(
        customersCacheKey(customerScope, true),
        snapshot.customersEnriched,
        { ttlMs: CACHE_TTL.customersEnrichedMs },
      ));
    }
  }
  await Promise.all(customerWrites);
  markDataRefreshStep("customers", "done");

  markDataRefreshStep("items", "running");
  if (snapshot.itemsMaster) {
    await writeCacheEntry(itemsMasterCacheKey(), snapshot.itemsMaster, { ttlMs: CACHE_TTL.itemsMasterMs });
  }
  markDataRefreshStep("items", "done");

  markDataRefreshStep("orders", "running");
  if (Array.isArray(snapshot.pendingOrders) && snapshot.salesScope) {
    await writeCacheEntry(
      pendingOrdersCacheKey(userId, snapshot.salesScope),
      snapshot.pendingOrders,
      { ttlMs: CACHE_TTL.pendingOrdersMs },
    );
  }
  markDataRefreshStep("orders", "done");

  const savedAt = Date.now();
  const builtAt = snapshot.builtAt || new Date(savedAt).toISOString();
  await writeMobileSnapshotMeta({
    builtAt,
    savedAt,
    snapshotKey: snapshot.snapshotKey || "",
  });
  seedDataRefreshMeta({ lastBuiltAt: builtAt, lastSavedAt: savedAt });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("madiba-mobile-snapshot-hydrated"));
  }

  return true;
}

export async function fetchAndHydrateMobileSnapshot(options = {}) {
  const manageJob = options.manageJob !== false;
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.user?.id) {
    throw new Error("Please login again.");
  }

  if (manageJob) {
    startDataRefreshJob("device-data", snapshotRefreshSteps(false));
  }

  try {
    markDataRefreshStep("download", "running");
    const snapshot = await fetchMobileSnapshotNetwork(session.access_token);
    await hydrateFromMobileSnapshot(snapshot, session.user.id);
    if (manageJob) {
      finishDataRefreshJob({
        lastBuiltAt: snapshot.builtAt,
        lastSavedAt: Date.now(),
      });
    }
    return { snapshot, userId: session.user.id };
  } catch (error) {
    if (manageJob) {
      finishDataRefreshJob({ error: error.message || "Unable to refresh device data." });
    }
    throw error;
  }
}

export async function ensureMobileSnapshotFresh(options = {}) {
  if (typeof navigator !== "undefined" && !navigator.onLine && !options.forceRefresh) {
    const meta = await readMobileSnapshotMeta();
    if (meta) seedDataRefreshMeta({ lastBuiltAt: meta.builtAt, lastSavedAt: meta.savedAt });
    return { skipped: true, offline: true, meta };
  }

  const supabase = getSupabaseClient();
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };

  const [foundation, meta] = await Promise.all([
    hydrateFoundationFromCache(session.user.id),
    readMobileSnapshotMeta(),
  ]);
  if (meta) {
    seedDataRefreshMeta({ lastBuiltAt: meta.builtAt, lastSavedAt: meta.savedAt });
  }

  const hasCustomers = Array.isArray(foundation?.customers) && foundation.customers.length > 0;
  const savedAt = Number(meta?.savedAt || 0);
  const ageMs = savedAt > 0 ? Date.now() - savedAt : Number.POSITIVE_INFINITY;
  const stale = !hasCustomers || ageMs > SNAPSHOT_STALE_AFTER_MS;
  if (!options.forceRefresh && !stale) {
    return { skipped: true, meta };
  }

  return fetchAndHydrateMobileSnapshot(options);
}

async function fetchPendingOrdersNetwork(scope) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("sales_orders")
    .select(PENDING_ORDERS_SELECT)
    .in("status", PENDING_ORDER_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  return filterPendingOrdersForScope(data, scope);
}

export async function invalidatePendingOrdersCache(userId, scope) {
  const { removeCacheEntry } = await import("./localDataStore.js");
  await removeCacheEntry(pendingOrdersCacheKey(userId, scope));
}

export async function upsertLocalPendingOrder(userId, scope, order) {
  if (!userId || !scope || !order?.id) return false;
  const current = await readPendingOrdersCache(userId, scope);
  const rows = Array.isArray(current) ? current : [];
  const next = [
    order,
    ...rows.filter((row) => String(row?.id) !== String(order.id)),
  ];
  return writeCacheEntry(
    pendingOrdersCacheKey(userId, scope),
    next,
    { ttlMs: CACHE_TTL.pendingOrdersMs },
  );
}

export async function fetchPendingOrdersCached(userId, scope, options = {}) {
  if (!userId) throw new Error("Please login again.");

  return fetchWithLocalCacheResilient(
    pendingOrdersCacheKey(userId, scope),
    CACHE_TTL.pendingOrdersMs,
    () => fetchPendingOrdersNetwork(scope),
    {
      onUpdate: options.onUpdate,
      revalidate: Boolean(options.revalidate),
      forceRefresh: Boolean(options.forceRefresh),
    },
  );
}

export async function readPendingOrdersCache(userId, scope) {
  const entry = await readCacheEntry(pendingOrdersCacheKey(userId, scope));
  return Array.isArray(entry?.value) ? entry.value : null;
}

export async function waitForPendingOrdersHydration(userId, scope, maxMs = 2500) {
  const cached = await readPendingOrdersCache(userId, scope);
  if (cached && cached.length > 0) return true;

  if (typeof window === "undefined") return false;

  return new Promise((resolve) => {
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("madiba-mobile-snapshot-hydrated", onHydrated);
      clearTimeout(timer);
      const next = await readPendingOrdersCache(userId, scope);
      resolve(Boolean(next && next.length > 0));
    };

    const onHydrated = () => {
      finish();
    };

    const timer = window.setTimeout(() => {
      finish();
    }, maxMs);

    window.addEventListener("madiba-mobile-snapshot-hydrated", onHydrated);
  });
}

export async function readPendingOrdersInvoiceMeta(userId) {
  const entry = await readCacheEntry(pendingOrdersInvoiceMetaCacheKey(userId));
  return entry?.value && typeof entry.value === "object" ? entry.value : {};
}

export async function writePendingOrdersInvoiceMeta(userId, items) {
  if (!userId || !items || typeof items !== "object") return false;
  return writeCacheEntry(
    pendingOrdersInvoiceMetaCacheKey(userId),
    items,
    { ttlMs: CACHE_TTL.pendingOrdersMs },
  );
}
