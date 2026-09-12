import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  ingestCategoryGrowthRows,
} from "../app/lib/categoryGrowth.js";
import {
  createSalesBiCube,
  cubeSupportsFilters,
  deserializeSalesBiCube,
  ingestSalesRowsIntoCube,
  monthAlignGrowthFilters,
  salesBiFactToGrowthRow,
  salesBiFactsFromCube,
  serializeSalesBiCube,
  salesBiCubeMeasureTotal,
  salesBiCubeNeedsRebuild,
} from "../app/lib/salesBiCube.js";

test("cube rolls invoice lines into one monthly fact per dimension combo", () => {
  const cube = createSalesBiCube();
  ingestSalesRowsIntoCube(cube, [
    {
      transaction_date: "2026-02-03",
      category: "Fridge",
      salesman_code: "S1",
      salesman_name: "Ali",
      customer_code: "C1",
      item_code: "I1",
      sales_amount: 100,
      profit_amount: 30,
      quantity: 2,
    },
    {
      transaction_date: "2026-02-20",
      category: "Fridge",
      salesman_code: "S1",
      salesman_name: "Ali",
      customer_code: "C1",
      item_code: "I1",
      sales_amount: 50,
      profit_amount: 10,
      quantity: 1,
    },
    {
      transaction_date: "2026-03-01",
      category: "Fridge",
      salesman_code: "S1",
      salesman_name: "Ali",
      customer_code: "C1",
      item_code: "I1",
      sales_amount: 80,
      quantity: 1,
    },
  ]);

  const facts = salesBiFactsFromCube(cube);
  assert.equal(cube.sourceRowCount, 3);
  assert.equal(facts.length, 2);
  const february = facts.find((row) => row.month === "2026-02");
  assert.equal(february.sales_amount, 150);
  assert.equal(february.profit_amount, 40);
  assert.equal(february.quantity, 3);
  assert.equal(february.line_count, 2);
});

test("serialized cube round-trips compact keys", () => {
  const cube = createSalesBiCube();
  ingestSalesRowsIntoCube(cube, [
    { transaction_date: "2026-01-15", category: "Office", salesman_name: "Noor", sales_amount: 40 },
  ]);
  const packed = serializeSalesBiCube({
    facts: salesBiFactsFromCube(cube),
    batchId: "batch-1",
    builtAt: "2026-09-11T08:00:00.000Z",
    sourceRowCount: cube.sourceRowCount,
  });
  const restored = deserializeSalesBiCube(packed);
  assert.equal(restored.batchId, "batch-1");
  assert.equal(restored.facts[0].month, "2026-01");
  assert.equal(restored.facts[0].category, "Office");
  assert.equal(restored.facts[0].salesman_name, "Noor");
  assert.equal(restored.facts[0].sales_amount, 40);
});

test("cube facts produce the same yearly totals as raw invoice lines", () => {
  const rows = [
    { transaction_date: "2025-02-10", category: "Fridge", sales_amount: 100 },
    { transaction_date: "2025-02-18", category: "Fridge", sales_amount: 20 },
    { transaction_date: "2026-02-10", category: "Fridge", sales_amount: 150 },
  ];
  const live = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(live, rows);
  const liveReport = buildCategoryGrowthReport(live, { asOfDate: "2026-09-11" });

  const cube = createSalesBiCube();
  ingestSalesRowsIntoCube(cube, rows);
  const fromCube = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(fromCube, salesBiFactsFromCube(cube).map(salesBiFactToGrowthRow));
  const cubeReport = buildCategoryGrowthReport(fromCube, { asOfDate: "2026-09-11" });

  assert.equal(cubeReport.lifetimeTotal, liveReport.lifetimeTotal);
  assert.equal(cubeReport.categories[0].yearValues["2025"], 120);
  assert.equal(cubeReport.categories[0].yearValues["2026"], 150);
});

test("voucher number and reference filters fall back to live sales", () => {
  assert.equal(cubeSupportsFilters({ values: {} }), true);
  assert.equal(cubeSupportsFilters({ values: { voucher_number: ["INV-1"] } }), false);
  assert.equal(cubeSupportsFilters({ values: { reference: ["PO-9"] } }), false);
});

test("old prepared sales models are ignored so a rebuilt cube is used", () => {
  assert.equal(deserializeSalesBiCube({ version: 1, facts: [{ m: "2026-02", a: 99 }] }), null);
});

test("cube rebuilds when it is older than the last sales upload or missing live profit", () => {
  const cube = {
    builtAt: "2026-09-12T06:34:53.210Z",
    facts: [{ month: "2026-02", sales_amount: 100, profit_amount: 0 }],
  };
  assert.equal(salesBiCubeMeasureTotal(cube, "sales"), 100);
  assert.equal(salesBiCubeMeasureTotal(cube, "profit"), 0);
  assert.equal(salesBiCubeNeedsRebuild(cube, { liveHasProfit: true }), true);
  assert.equal(salesBiCubeNeedsRebuild(cube, {
    liveHasProfit: false,
    lastImportAt: "2026-09-12T08:04:27.376Z",
  }), true);
  assert.equal(salesBiCubeNeedsRebuild({
    ...cube,
    builtAt: "2026-09-12T08:10:00.000Z",
    facts: [{ month: "2026-02", sales_amount: 100, profit_amount: 12 }],
  }, { liveHasProfit: true, lastImportAt: "2026-09-12T08:04:27.376Z" }), false);
});

test("date filters snap to month grain for cube reads", () => {
  const aligned = monthAlignGrowthFilters({ dateFrom: "2026-03-15", dateTo: "2026-04-09" });
  assert.equal(aligned.dateFrom, "2026-03-01");
  assert.equal(aligned.dateTo, "2026-04-01");
});
