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

test("outstanding cache key version is v2 so stale v1 customer rows are ignored", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(source, /outstanding:v2:/);
  assert.doesNotMatch(source, /outstanding:v1:/);
});
