import test from "node:test";
import assert from "node:assert/strict";

import { slimVisitStockChecks } from "../app/lib/visitReportSave.js";

test("slimVisitStockChecks keeps only marked items and caps the list", () => {
  const stockChecks = [
    { itemCode: "A", itemName: "Item A", status: "" },
    { itemCode: "B", itemName: "Item B", status: "AVAILABLE" },
    { itemCode: "C", itemName: "Item C", status: "NOT_AVAILABLE" },
    { itemCode: "D", itemName: "Item D", status: "AVAILABLE" },
  ];

  assert.deepEqual(slimVisitStockChecks(stockChecks, 2), [
    { itemCode: "B", itemName: "Item B", status: "AVAILABLE" },
    { itemCode: "C", itemName: "Item C", status: "NOT_AVAILABLE" },
  ]);
});

test("slimVisitStockChecks falls back to unmarked items when none are checked", () => {
  const stockChecks = [
    { itemCode: "A", itemName: "Item A" },
    { itemCode: "B", itemName: "Item B" },
  ];

  assert.deepEqual(slimVisitStockChecks(stockChecks, 10), [
    { itemCode: "A", itemName: "Item A", status: "" },
    { itemCode: "B", itemName: "Item B", status: "" },
  ]);
});
