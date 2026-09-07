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

test("collection queue cache key version is v5 so empty v4 caches are discarded", async () => {
  const source = await import("node:fs").then((fs) => (
    fs.readFileSync(new URL("../app/lib/mobileDataCache.js", import.meta.url), "utf8")
  ));
  assert.match(source, /collectionQueues:v5:/);
  assert.doesNotMatch(source, /collectionQueues:v4:/);
});
