import test from "node:test";
import assert from "node:assert/strict";

import { isCacheEntryFresh, shouldUseLocalCacheOnly } from "../app/lib/localDataStore.js";
import { buildScopeHash } from "../app/lib/mobileDataCache.js";

test("buildScopeHash is stable for the same salesman scope", () => {
  const scope = { hasAllAccess: false, visibleSalesmanCodes: ["SM2", "SM1"] };
  assert.equal(buildScopeHash(scope), "SM1|SM2");
  assert.equal(buildScopeHash({ hasAllAccess: true }), "all");
});

test("isCacheEntryFresh respects expiresAt", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    isCacheEntryFresh({ expiresAt: now + 60_000 }, 60_000, now),
    true,
  );
  assert.equal(
    isCacheEntryFresh({ expiresAt: now - 1 }, 60_000, now),
    false,
  );
});

test("shouldUseLocalCacheOnly prefers saved data even when online", () => {
  const cached = { value: { customers: [] } };
  assert.equal(shouldUseLocalCacheOnly(cached), true);
  assert.equal(shouldUseLocalCacheOnly(cached, { revalidate: true }), false);
  assert.equal(shouldUseLocalCacheOnly(cached, { forceRefresh: true }), false);
  assert.equal(shouldUseLocalCacheOnly(null), false);
});

test("outstanding cache is dropped after an outstanding upload refresh", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  const uploadSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/management/upload/page.js", import.meta.url), "utf8")
  ));
  const refreshSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/offlineDataRefresh.js", import.meta.url), "utf8")
  ));
  assert.match(source, /export async function invalidateOutstandingCache/);
  assert.match(uploadSource, /await invalidateOutstandingCache\(\)/);
  assert.match(refreshSource, /await invalidateOutstandingCache\(\)/);
});

test("every upload (sales, outstanding, receipt) recalculates customer history and collection queue caches", async () => {
  const uploadSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/management/upload/page.js", import.meta.url), "utf8")
  ));
  const refreshSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/offlineDataRefresh.js", import.meta.url), "utf8")
  ));
  const receiptsRouteSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/api/receipts/route.js", import.meta.url), "utf8")
  ));

  // Sales, outstanding, and receipt uploads must each invalidate every collection-dependent cache.
  const uploadFunctions = uploadSource.split(/async function upload/).slice(1);
  assert.equal(uploadFunctions.length, 4); // Sales, Outstanding, Receipt, Item Unit
  for (const fn of uploadFunctions.slice(0, 3)) {
    assert.match(fn, /await invalidateOutstandingCache\(\)/);
    assert.match(fn, /await invalidateCustomerHistoryCache\(\)/);
    assert.match(fn, /await invalidateCollectionQueuesForUser\(\)/);
  }

  assert.match(refreshSource, /await invalidateCustomerHistoryCache\(\)/);
  assert.match(refreshSource, /await invalidateCollectionQueuesForUser\(\)/);

  // Receipt uploads must also broadcast so other already-open sessions recalculate.
  assert.match(receiptsRouteSource, /publishOfflineDataUpdate/);
  assert.match(receiptsRouteSource, /trigger: "receipt-upload"/);
});

test("customer-history cache is exposed with invalidate/subscribe helpers", async () => {
  const mobileDataCache = await import("../app/lib/mobileDataCache.js");
  assert.equal(typeof mobileDataCache.invalidateCustomerHistoryCache, "function");
  assert.equal(typeof mobileDataCache.subscribeCustomerHistoryCacheCleared, "function");
  assert.equal(typeof mobileDataCache.invalidateCollectionQueuesForUser, "function");
  assert.equal(mobileDataCache.CUSTOMER_HISTORY_CACHE_PREFIX, "history:v5");
});

test("the global Refresh button also clears history/outstanding/collection caches, not just the mobile snapshot", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/components/GlobalAppStatus.jsx", import.meta.url), "utf8")
  ));
  const refreshFn = source.split("async function refreshDeviceData")[1]?.split("\n\n")[0] || "";
  assert.match(refreshFn, /await invalidateOutstandingCache\(\)/);
  assert.match(refreshFn, /await invalidateCustomerHistoryCache\(\)/);
  assert.match(refreshFn, /await invalidateCollectionQueuesForUser\(\)/);
  assert.match(refreshFn, /await ensureMobileSnapshotFresh/);
});

test("Customer Audit always revalidates history from the network, never a silently-fresh 24h cache", async () => {
  const hookSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/management/customer-audit/hooks/useCustomerData.js", import.meta.url), "utf8")
  ));
  const cacheSource = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(hookSource, /fetchCustomerHistoryCached\(\s*session\.access_token,\s*scope,\s*customer\.customer_code,\s*\{[\s\S]*?revalidate: true,/);
  assert.match(cacheSource, /revalidate: Boolean\(options\.revalidate\)/);
});

test("collection queue cache keeps v6 current and still reads legacy v5/v4 offline queues", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(source, /COLLECTION_QUEUE_CACHE_VERSION = 6/);
  assert.match(source, /LEGACY_COLLECTION_QUEUE_CACHE_VERSIONS = \[5, 4\]/);
  assert.match(source, /collectionQueues:v\$\{version\}:/);
  assert.match(source, /readCollectionQueuesEntryForScope/);
});

test("payment collections loadQueue shows cached customers immediately while offline", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url), "utf8")
  ));
  assert.match(source, /navigator\.onLine === false/);
  assert.match(source, /if \(offline\) \{\s*setRefreshingQueue\(false\);\s*setError\(""\);\s*return cachedResult;/);
});

test("invalidateCollectionQueuesForUser clears every queue cache version by prefix", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(source, /removeCacheEntriesByPrefix\("collectionQueues:v"\)/);
});

test("outstanding cache key version is v2 so stale v1 customer rows are ignored", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(source, /outstanding:v2:/);
  assert.doesNotMatch(source, /outstanding:v1:/);
});
