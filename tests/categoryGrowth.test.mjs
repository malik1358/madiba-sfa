import test from "node:test";
import assert from "node:assert/strict";

import {
  UNCLASSIFIED_CATEGORY,
  buildCategoryGrowthReport,
  cagrPercent,
  classifyCategoryStatus,
  consecutiveDecliningMonths,
  createCategoryGrowthAccumulator,
  enumerateMonths,
  formatAmountWithDelta,
  formatGrowthPercent,
  formatWholePercent,
  growthPercent,
  ingestCategoryGrowthRows,
  pickBiMeasure,
  monthChangeTone,
  monthGridTotals,
  monthsInQuarter,
  normalizeCategoryName,
  quarterGridTotals,
  yearGridTotals,
  quarterKeyFromMonthKey,
  quarterLabel,
  selectRecentGrowthMonths,
  selectRecentGrowthQuarters,
  silentMonthCount,
} from "../app/lib/categoryGrowth.js";

test("blank categories become Unclassified", () => {
  assert.equal(normalizeCategoryName(""), UNCLASSIFIED_CATEGORY);
  assert.equal(normalizeCategoryName("  Fridge  "), "Fridge");
});

test("growth and CAGR use a prior baseline", () => {
  assert.equal(growthPercent(120, 100), 20);
  assert.equal(growthPercent(80, 0), null);
  assert.equal(Math.round(cagrPercent(100, 121, 2) * 10) / 10, 10);
  assert.equal(formatWholePercent(-12.34), "-12%");
  assert.equal(formatGrowthPercent(-12.34), "-12%");
  assert.equal(formatGrowthPercent(null), "—");
  assert.equal(formatAmountWithDelta(120, 100, true), `${Number(120).toLocaleString("en-SA")} +20%`);
  assert.equal(formatAmountWithDelta(80, 0, true), Number(80).toLocaleString("en-SA"));
});

test("enumerateMonths fills inclusive calendar months", () => {
  assert.deepEqual(enumerateMonths("2025-11", "2026-02"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});

test("category growth report tracks yearly expansion since first sale", () => {
  const acc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(acc, [
    { transaction_date: "2024-02-10", category: "Fridge", sales_amount: 100 },
    { transaction_date: "2024-08-10", category: "Fridge", sales_amount: 100 },
    { transaction_date: "2025-02-10", category: "Fridge", sales_amount: 160 },
    { transaction_date: "2025-08-10", category: "Fridge", sales_amount: 160 },
    { transaction_date: "2025-08-10", category: "Office", sales_amount: 40 },
    { transaction_date: "2026-02-10", category: "Fridge", sales_amount: 200 },
    { transaction_date: "2026-02-10", category: "", sales_amount: 10 },
  ]);

  const report = buildCategoryGrowthReport(acc, { asOfDate: "2026-09-11" });
  const fridge = report.categories.find((row) => row.category === "Fridge");
  const office = report.categories.find((row) => row.category === "Office");
  const unclassified = report.categories.find((row) => row.category === UNCLASSIFIED_CATEGORY);

  assert.equal(report.firstDate, "2024-02-10");
  assert.equal(report.lastDate, "2026-02-10");
  assert.deepEqual(report.years, ["2024", "2025", "2026"]);
  assert.equal(fridge.yearValues["2024"], 200);
  assert.equal(fridge.yearValues["2025"], 320);
  assert.equal(fridge.yearValues["2026"], 200);
  assert.equal(fridge.currentYtd, 200);
  assert.equal(fridge.priorYtd, 160);
  assert.equal(fridge.yoyPercent, 25);
  assert.equal(fridge.status, "green");
  assert.equal(office.status, "red");
  assert.equal(office.statusCode, "silent");
  assert.equal(unclassified.lifetime, 10);
  assert.equal(report.meta.decliningCount >= 1, true);
  assert.equal(report.alerts.some((alert) => alert.title === "Office"), true);
});

test("status lights flag year-over-year drops and new categories", () => {
  assert.equal(classifyCategoryStatus({ yoyPercent: -20 }).status, "red");
  assert.equal(classifyCategoryStatus({ momPercent: -16 }).status, "red");
  assert.equal(classifyCategoryStatus({ decliningMonths: 3 }).status, "red");
  assert.equal(classifyCategoryStatus({ yoyPercent: -8 }).status, "orange");
  assert.equal(classifyCategoryStatus({ yoyPercent: 12 }).status, "green");
  assert.equal(classifyCategoryStatus({ yearCount: 1 }).status, "neutral");
});

test("filters and group-by slice the same sales into different rows", () => {
  const rows = [
    { transaction_date: "2025-01-10", category: "Fridge", salesman_name: "Ali", salesman_code: "S1", customer_name: "Hotel", customer_code: "C1", item_name: "Ice", item_code: "I1", voucher_type: "SI", local_import: "Local", abc_class: "A", sales_amount: 100, quantity: 2 },
    { transaction_date: "2025-06-10", category: "Office", salesman_name: "Ali", salesman_code: "S1", customer_name: "Shop", customer_code: "C2", item_name: "Paper", item_code: "I2", voucher_type: "SI", local_import: "Import", abc_class: "B", sales_amount: 40, quantity: 8 },
    { transaction_date: "2026-02-10", category: "Fridge", salesman_name: "Omar", salesman_code: "S2", customer_name: "Hotel", customer_code: "C1", item_name: "Ice", item_code: "I1", voucher_type: "SR", local_import: "Local", abc_class: "A", sales_amount: 80, quantity: 1 },
  ];

  const salesmanAcc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(salesmanAcc, rows, { groupBy: "salesman" });
  const salesmanReport = buildCategoryGrowthReport(salesmanAcc, { asOfDate: "2026-09-11" });
  assert.equal(salesmanReport.groups.length, 2);
  assert.equal(salesmanReport.groups.some((row) => row.label === "Ali · S1"), true);

  const fridgeAcc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(fridgeAcc, rows, {
    filters: { values: { category: ["Fridge"] } },
  });
  const fridgeReport = buildCategoryGrowthReport(fridgeAcc, { asOfDate: "2026-09-11" });
  assert.equal(fridgeReport.categories.length, 1);
  assert.equal(fridgeReport.categories[0].lifetime, 180);
  assert.equal(fridgeReport.meta.sourceRowCount, 3);
  assert.equal(fridgeReport.meta.rowCount, 2);

  const dateAcc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(dateAcc, rows, { filters: { dateFrom: "2026-01-01" } });
  const dateReport = buildCategoryGrowthReport(dateAcc, { asOfDate: "2026-09-11" });
  assert.equal(dateReport.lifetimeTotal, 80);
});

test("silent and declining helpers count gaps and losing streaks", () => {
  assert.equal(silentMonthCount("2026-01", "2026-04"), 3);
  const byMonth = new Map([
    ["2026-01", 90],
    ["2026-02", 80],
    ["2026-03", 60],
    ["2026-04", 40],
  ]);
  assert.equal(consecutiveDecliningMonths(byMonth, "2026-04"), 3);
});

test("month cells compare to the previous month and keep the current month in view", () => {
  assert.equal(monthChangeTone(120, 100), "up");
  assert.equal(monthChangeTone(80, 100), "down");
  assert.equal(monthChangeTone(100, 100), "");
  assert.deepEqual(
    selectRecentGrowthMonths({
      firstMonth: "2025-01",
      lastDataMonth: "2026-08",
      asOfMonth: "2026-09",
    }),
    [
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ],
  );

  const acc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(acc, [
    { transaction_date: "2026-07-10", category: "Fridge", sales_amount: 100 },
    { transaction_date: "2026-08-10", category: "Fridge", sales_amount: 80 },
  ]);
  const report = buildCategoryGrowthReport(acc, { asOfDate: "2026-09-11" });
  assert.equal(report.currentMonth, "2026-09");
  assert.equal(report.recentMonths.at(-1), "2026-09");
  assert.equal(report.categories[0].monthValues["2026-09"], 0);
});

test("month grid totals add a row total, month totals, and grand total", () => {
  const totals = monthGridTotals(
    [
      { monthValues: { "2026-07": 100, "2026-08": 80 } },
      { monthValues: { "2026-07": 20, "2026-08": 40 } },
    ],
    ["2026-07", "2026-08", "2026-09"],
  );
  assert.deepEqual(totals.rowTotals, [180, 60]);
  assert.deepEqual(totals.columnTotals, [120, 120, 0]);
  assert.equal(totals.grandTotal, 240);
});

test("year grid totals add a row total, year totals, and grand total", () => {
  const totals = yearGridTotals(
    [
      { yearValues: { 2025: 100, 2026: 80 } },
      { yearValues: { 2025: 20, 2026: 40 } },
    ],
    ["2025", "2026"],
  );
  assert.deepEqual(totals.rowTotals, [180, 60]);
  assert.deepEqual(totals.columnTotals, [120, 120]);
  assert.equal(totals.grandTotal, 240);
});

test("profit measure uses GP and stays separate from sales", () => {
  const acc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(acc, [
    { transaction_date: "2026-02-10", category: "Fridge", sales_amount: 200, profit_amount: 40 },
    { transaction_date: "2026-03-10", category: "Fridge", sales_amount: 100, profit_amount: 25 },
  ], { measure: "profit" });
  const report = buildCategoryGrowthReport(acc, { asOfDate: "2026-09-11" });
  assert.equal(report.lifetimeTotal, 65);
  assert.equal(report.categories[0].yearValues["2026"], 65);
  const picked = pickBiMeasure({ lifetimeTotal: 300, measures: { sales: { lifetimeTotal: 300 }, profit: { lifetimeTotal: 65 } } }, "profit");
  assert.equal(picked.lifetimeTotal, 65);
});

test("quarters roll months together and keep the current quarter as QTD", () => {
  assert.equal(quarterKeyFromMonthKey("2026-09"), "2026-Q3");
  assert.deepEqual(monthsInQuarter("2026-Q3"), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(monthsInQuarter("2026-Q3", "2026-08"), ["2026-07", "2026-08"]);
  assert.equal(quarterLabel("2026-Q3", "2026-Q3"), "Q3 26 QTD");
  assert.deepEqual(
    selectRecentGrowthQuarters({ firstMonth: "2024-02", asOfMonth: "2026-09" }),
    ["2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"],
  );

  const acc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(acc, [
    { transaction_date: "2026-01-10", category: "Fridge", sales_amount: 40 },
    { transaction_date: "2026-02-10", category: "Fridge", sales_amount: 60 },
    { transaction_date: "2026-04-10", category: "Fridge", sales_amount: 90 },
    { transaction_date: "2026-07-10", category: "Fridge", sales_amount: 25 },
    { transaction_date: "2026-08-10", category: "Fridge", sales_amount: 15 },
  ]);
  const report = buildCategoryGrowthReport(acc, { asOfDate: "2026-09-11" });
  const fridge = report.categories.find((row) => row.category === "Fridge");
  assert.equal(report.currentQuarter, "2026-Q3");
  assert.equal(report.recentQuarters.at(-1), "2026-Q3");
  assert.equal(fridge.quarterValues["2026-Q1"], 100);
  assert.equal(fridge.quarterValues["2026-Q2"], 90);
  assert.equal(fridge.quarterValues["2026-Q3"], 40);

  const totals = quarterGridTotals(
    [
      { quarterValues: { "2026-Q1": 100, "2026-Q2": 90 } },
      { quarterValues: { "2026-Q1": 20, "2026-Q2": 10 } },
    ],
    ["2026-Q1", "2026-Q2", "2026-Q3"],
  );
  assert.deepEqual(totals.rowTotals, [190, 30]);
  assert.deepEqual(totals.columnTotals, [120, 100, 0]);
  assert.equal(totals.grandTotal, 220);
});
