import test from "node:test";
import assert from "node:assert/strict";

import { cacheKeyHasPrefix, isCacheEntryFresh, shouldUseLocalCacheOnly } from "../app/lib/localDataStore.js";

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

test("cacheKeyHasPrefix matches outstanding cache keys only", () => {
  const prefix = "outstanding:v2:";
  assert.equal(cacheKeyHasPrefix("outstanding:v2:1251:SAQR", prefix), true);
  assert.equal(cacheKeyHasPrefix("customers:visible:enriched:v8:all", prefix), false);
  assert.equal(cacheKeyHasPrefix("", prefix), false);
});
