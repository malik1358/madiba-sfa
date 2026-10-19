import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOfflineDataPushCopy,
  buildOfflineDataVersion,
  kindsNeedCustomerSnapshot,
  kindsNeedPriceCache,
  normalizeOfflineDataKinds,
  parseOfflineRefreshKinds,
  shouldApplyOfflineDataVersion,
  shouldPublishOfflineDataUpdate,
  hashOfflineDataContent,
} from "../app/lib/offlineDataBroadcastShared.js";

test("normalizeOfflineDataKinds keeps only known catalog kinds", () => {
  assert.deepEqual(
    normalizeOfflineDataKinds(["transactions", "PRICES", "unknown", "schemes"]),
    ["transactions", "prices", "schemes"],
  );
});

test("snapshot rebuild is required only for sales and outstanding", () => {
  assert.equal(kindsNeedCustomerSnapshot(["prices"]), false);
  assert.equal(kindsNeedCustomerSnapshot(["schemes"]), false);
  assert.equal(kindsNeedCustomerSnapshot(["outstanding"]), true);
  assert.equal(kindsNeedCustomerSnapshot(["transactions"]), true);
  assert.equal(kindsNeedPriceCache(["prices"]), true);
  assert.equal(kindsNeedPriceCache(["outstanding"]), false);
});

test("offline data version records trigger and kinds", () => {
  const payload = buildOfflineDataVersion({
    kinds: ["outstanding"],
    trigger: "outstanding-upload",
    version: 123,
  });
  assert.equal(payload.version, 123);
  assert.equal(payload.trigger, "outstanding-upload");
  assert.deepEqual(payload.kinds, ["outstanding"]);
  assert.equal(typeof payload.updatedAt, "string");
});

test("push copy describes outstanding and price updates", () => {
  assert.equal(buildOfflineDataPushCopy(["outstanding"]).title, "Outstanding updated");
  assert.equal(buildOfflineDataPushCopy(["prices"]).title, "Prices updated");
});

test("devices apply a newer offline data version only once", () => {
  assert.equal(shouldApplyOfflineDataVersion(200, 100), true);
  assert.equal(shouldApplyOfflineDataVersion(100, 100), false);
  assert.equal(shouldApplyOfflineDataVersion(0, 100), false);
  assert.equal(shouldApplyOfflineDataVersion(300, 100, "abc", "abc"), false);
  assert.equal(shouldApplyOfflineDataVersion(300, 100, "def", "abc"), true);
  assert.deepEqual(parseOfflineRefreshKinds("transactions,outstanding"), ["transactions", "outstanding"]);
});

test("server publish is skipped when catalog content hash is unchanged", () => {
  const hash = hashOfflineDataContent({ prices: { A: 1 } });
  assert.equal(shouldPublishOfflineDataUpdate({ contentHash: hash }, hash), false);
  assert.equal(shouldPublishOfflineDataUpdate({ contentHash: hash }, hashOfflineDataContent({ prices: { A: 2 } })), true);
  assert.equal(shouldPublishOfflineDataUpdate(null, hash), true);
});
