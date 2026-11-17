import test from "node:test";
import assert from "node:assert/strict";
import { applyMisGrowthFilters, buildMisFilterCatalogs } from "../app/lib/misFilters.js";

test("applyMisGrowthFilters filters sales and keeps matching customers on receipts/outstanding", () => {
  const salesRows = [
    { transaction_date: "2026-10-05", category: "Sundry", salesman_code: "S1", salesman_name: "Ali", customer_code: "1001", customer_name: "A Co", item_code: "A1", item_name: "Item A", sales_amount: 100, quantity: 1 },
    { transaction_date: "2026-10-06", category: "Electronics", salesman_code: "S2", salesman_name: "Bob", customer_code: "2002", customer_name: "B Co", item_code: "B1", item_name: "Item B", sales_amount: 200, quantity: 2 },
  ];
  const receiptRows = [
    { customer_code: "1001", amount: 50 },
    { customer_code: "2002", amount: 80 },
  ];
  const outstandingRows = [
    { customer_code: "1001", outstanding: 10 },
    { customer_code: "2002", outstanding: 20 },
  ];

  const result = applyMisGrowthFilters({
    salesRows,
    receiptRows,
    outstandingRows,
    inventoryPhysical: {
      physical: 300,
      byCategory: { Sundry: 100, Electronics: 200 },
    },
    filters: {
      values: { category: ["Sundry"] },
    },
  });

  assert.equal(result.filtered, true);
  assert.equal(result.salesRows.length, 1);
  assert.equal(result.salesRows[0].customer_code, "1001");
  assert.deepEqual(result.receiptRows.map((row) => row.customer_code), ["1001"]);
  assert.deepEqual(result.outstandingRows.map((row) => row.customer_code), ["1001"]);
  assert.equal(result.inventoryPhysical.physical, 100);
  assert.deepEqual(result.inventoryPhysical.byCategory, { Sundry: 100 });
});

test("buildMisFilterCatalogs includes category and salesman labels", () => {
  const catalogs = buildMisFilterCatalogs([
    { transaction_date: "2026-10-05", category: "Sundry", salesman_code: "S1", salesman_name: "Ali", customer_code: "1001", customer_name: "A Co", item_code: "A1", item_name: "Item A", sales_amount: 100, quantity: 1 },
  ]);
  assert.ok(catalogs.category.includes("Sundry"));
  assert.ok(catalogs.salesman_code.includes("S1") || catalogs.salesman.some((value) => String(value).includes("Ali")));
});
