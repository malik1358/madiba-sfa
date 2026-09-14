import test from "node:test";
import assert from "node:assert/strict";

import {
  buildItemPriceHistoryInserts,
  decoratePriceHistoryRows,
  extractItemPriceFromSnapshotPayload,
  matchItemCatalogEntries,
  pricesEqual,
} from "../app/lib/itemPriceHistory.js";

test("buildItemPriceHistoryInserts records only changed regional prices", () => {
  const previous = new Map([
    ["A001::riyadh", 10],
    ["A001::dammam", 11],
  ]);

  const rows = buildItemPriceHistoryInserts(previous, {
    riyadh: { A001: 10, A002: 5 },
    dammam: { A001: 12 },
    jeddah: { A001: 10 },
  }, { recordedAt: "2026-09-14T07:00:00.000Z", source: "price_sync" });

  const byKey = Object.fromEntries(rows.map((row) => [`${row.item_code}::${row.region}`, row.price]));
  assert.equal(byKey["A001::riyadh"], undefined);
  assert.equal(byKey["A001::dammam"], 12);
  assert.equal(byKey["A002::riyadh"], 5);
  assert.equal(byKey["A001::jeddah"], 10);
  // Region fallbacks also seed missing Dammam/Jeddah rates from Riyadh on first write.
  assert.equal(byKey["A002::dammam"], 5);
  assert.equal(byKey["A002::jeddah"], 5);
  assert.equal(rows[0].recorded_at, "2026-09-14T07:00:00.000Z");
});

test("decoratePriceHistoryRows marks up/down/current against previous points", () => {
  const decorated = decoratePriceHistoryRows([
    { item_code: "A001", region: "riyadh", price: 12, recorded_at: "2026-09-14T08:00:00.000Z" },
    { item_code: "A001", region: "riyadh", price: 10, recorded_at: "2026-09-13T08:00:00.000Z" },
    { item_code: "A001", region: "riyadh", price: 11, recorded_at: "2026-09-12T08:00:00.000Z" },
  ], { currentPrice: 12 });

  assert.equal(decorated.length, 3);
  assert.equal(decorated[0].isCurrent, true);
  assert.equal(decorated[0].change, "up");
  assert.equal(decorated[1].change, "down");
  assert.equal(decorated[2].previousPrice, null);
});

test("extractItemPriceFromSnapshotPayload reads price maps and sheet payloads", () => {
  assert.equal(extractItemPriceFromSnapshotPayload({
    priceMap: { A001: 9.5 },
  }, "a001"), 9.5);

  assert.equal(extractItemPriceFromSnapshotPayload({
    regionPriceMaps: { dammam: { A001: 8.25 } },
  }, "A001", "dammam"), 8.25);

  assert.ok(pricesEqual(9.5, 9.5000));
});

test("matchItemCatalogEntries ranks code hits above name hits", () => {
  const matches = matchItemCatalogEntries([
    { item_code: "B100", item_name: "Glue stick", category: "Stationery" },
    { item_code: "A100", item_name: "Paper A4", category: "Stationery" },
    { item_code: "A110", item_name: "Notebook", category: "Stationery" },
  ], "A1", 10);

  assert.deepEqual(matches.map((row) => row.itemCode), ["A100", "A110"]);
});
