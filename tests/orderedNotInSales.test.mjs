import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderedNotInSalesReport,
  clampOrderedNotInSalesDays,
  resolveOrderedNotInSalesWindow,
} from "../app/lib/orderedNotInSales.js";

test("ordered-not-in-sales window is inclusive last N KSA days ending today", () => {
  const window = resolveOrderedNotInSalesWindow({
    days: 7,
    now: new Date("2026-10-27T12:00:00+03:00"),
  });
  assert.equal(window.toDate, "2026-10-27");
  assert.equal(window.fromDate, "2026-10-21");
  assert.equal(window.days, 7);
  assert.ok(window.startIso);
  assert.ok(window.endIso);
});

test("ordered-not-in-sales days clamp to 1..31", () => {
  assert.equal(clampOrderedNotInSalesDays(0), 1);
  assert.equal(clampOrderedNotInSalesDays(7), 7);
  assert.equal(clampOrderedNotInSalesDays(99), 31);
  assert.equal(clampOrderedNotInSalesDays("x"), 7);
});

test("report lists ordered items missing from sales and aggregates qty/value", () => {
  const report = buildOrderedNotInSalesReport({
    orderLines: [
      {
        order_id: 1,
        item_code: "a100",
        item_name: "Pen",
        category: "Stationery",
        quantity: 10,
        rate: 2,
        line_value: 20,
        submitted_at: "2026-10-25T08:00:00.000Z",
      },
      {
        order_id: 2,
        item_code: "A100",
        item_name: "Pen Blue",
        category: "Stationery",
        quantity: 5,
        rate: 2,
        submitted_at: "2026-10-26T08:00:00.000Z",
      },
      {
        order_id: 3,
        item_code: "B200",
        item_name: "Paper",
        category: "Paper",
        quantity: 3,
        rate: 10,
        line_value: 30,
        submitted_at: "2026-10-24T08:00:00.000Z",
      },
      {
        order_id: 4,
        item_code: "C300",
        item_name: "Sold item",
        category: "Other",
        quantity: 1,
        rate: 50,
        line_value: 50,
        submitted_at: "2026-10-23T08:00:00.000Z",
      },
    ],
    soldItemCodes: ["c300", "Z999"],
    window: { fromDate: "2026-10-21", toDate: "2026-10-27", days: 7 },
  });

  assert.equal(report.summary.orderedItems, 3);
  assert.equal(report.summary.soldItems, 1);
  assert.equal(report.summary.missingItems, 2);
  assert.deepEqual(
    report.rows.map((row) => row.itemCode),
    ["A100", "B200"],
  );
  assert.equal(report.rows[0].orderedQty, 15);
  assert.equal(report.rows[0].orderCount, 2);
  assert.equal(report.rows[0].orderValue, 30);
  assert.equal(report.rows[0].itemName, "Pen Blue");
  assert.equal(report.rows[1].orderedQty, 3);
  assert.equal(report.summary.missingQty, 18);
  assert.equal(report.summary.missingValue, 60);
});

test("zero-quantity order lines are ignored", () => {
  const report = buildOrderedNotInSalesReport({
    orderLines: [
      { order_id: 1, item_code: "X1", quantity: 0, rate: 10, line_value: 0 },
      { order_id: 2, item_code: "X2", quantity: -2, rate: 10, line_value: -20 },
    ],
    soldItemCodes: [],
  });
  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.orderedItems, 0);
});
