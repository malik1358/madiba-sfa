import test from "node:test";
import assert from "node:assert/strict";

import { isCacheEntryFresh } from "../app/lib/localDataStore.js";
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
