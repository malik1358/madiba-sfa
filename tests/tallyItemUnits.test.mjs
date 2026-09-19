import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTallyOrderExportRows,
  parseTallyItemMasterRow,
  resolveTallySalesRouting,
  formatTallyVoucherType,
  splitTallyItemName,
} from "../app/lib/tallyItemUnits.js";

test("splitTallyItemName extracts code and name", () => {
  const split = splitTallyItemName("A000057_PAPERLINE PHOTOCOPY PAPER");
  assert.equal(split.itemCode, "A000057");
  assert.equal(split.itemName, "PAPERLINE PHOTOCOPY PAPER");
});

test("parseTallyItemMasterRow reads tally name and master unit", () => {
  const row = parseTallyItemMasterRow({
    "TALLY ITEM NAME ": "A003234_GOLDEN STAR PAPER",
    "MASTER UNIT": "RIM",
  });
  assert.equal(row.item_code, "A003234");
  assert.equal(row.tally_unit, "RIM");
});

test("resolveTallySalesRouting maps ZIA, ASRAR, and regional others", () => {
  assert.deepEqual(resolveTallySalesRouting({ salesman_code: "ZIA" }, "riyadh"), {
    costCenter: "BM",
    salesTeam: "ZIA",
    godown: "RIYADH W/H 1",
    area: "RIYADH",
  });
  assert.equal(resolveTallySalesRouting({ salesman_code: "ASRAR AHMED" }, "riyadh").salesTeam, "ASRAR");
  assert.equal(resolveTallySalesRouting({ salesman_code: "ALI" }, "dammam").godown, "DAMMAM W/H 1");
});

test("buildTallyOrderExportRows builds one Tally import row per line", () => {
  const rows = buildTallyOrderExportRows({
    order: { customer_name: "TEST", salesman_code: "ZIA" },
    lines: [{ item_code: "A000057", item_name: "PAPER", quantity: 2, rate: 100, category: "PAPER" }],
    unitMap: { A000057: { tally_unit: "CTN", tally_item_name: "A000057_PAPERLINE" } },
    orderNumber: "SO-1",
    pricingRegion: "riyadh",
    paymentType: "credit",
    exportDate: new Date("2026-09-19T08:00:00Z"),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["VOUCHER TYPE"], "riyadh w/s credit");
  assert.equal(rows[0]["ITEM NAME"], "A000057_PAPERLINE");
  assert.equal(rows[0]["Item Unit"], "CTN");
  assert.equal(rows[0].GODOWN, "RIYADH W/H 1");
  assert.equal(formatTallyVoucherType("jeddah", "cash"), "jeddah w/s cash");
});
