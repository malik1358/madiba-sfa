import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExpectedStockedSalesReport,
  detectSeasonalCalendarMonths,
  isLocalProductItemCode,
  pickSecondHighestMonth,
} from "../app/lib/expectedStockedSales.js";

test("LP item codes are local products", () => {
  assert.equal(isLocalProductItemCode("LP00318"), true);
  assert.equal(isLocalProductItemCode("lp100"), true);
  assert.equal(isLocalProductItemCode("A004101"), false);
});

test("detects seasonal calendar months from company peaks above median", () => {
  const season = detectSeasonalCalendarMonths([
    { month: "2026-04", sales: 400 },
    { month: "2026-05", sales: 420 },
    { month: "2026-06", sales: 450 },
    { month: "2026-07", sales: 480 },
    { month: "2026-08", sales: 900 },
    { month: "2026-09", sales: 1100 },
    { month: "2026-10", sales: 950 },
    { month: "2026-11", sales: 200 },
  ], { incompleteMonth: "2026-11" });

  assert.deepEqual(season.calendarMonths, ["08", "09", "10"]);
  assert.deepEqual(season.peakYearMonths, ["2026-09", "2026-10", "2026-08"]);
});

test("second highest month is used when at least two eligible months exist", () => {
  const picked = pickSecondHighestMonth([
    { month: "2026-01", sales: 100, qty: 10 },
    { month: "2026-03", sales: 250, qty: 25 },
    { month: "2026-04", sales: 180, qty: 18 },
  ]);
  assert.equal(picked.expectedMonth, "2026-04");
  assert.equal(picked.expectedSales, 180);
  assert.equal(picked.expectedQty, 18);
  assert.equal(picked.peakMonth, "2026-03");
  assert.equal(picked.eligibleMonthCount, 3);
});

test("buildExpectedStockedSalesReport applies GP, LP, and seasonal filters", () => {
  const now = new Date("2026-11-14T08:00:00+03:00");
  const rows = [
    // Company peaks in Aug/Sep/Oct so those calendar months drop.
    { transaction_date: "2026-05-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 10, sales_amount: 100, profit_amount: 20 },
    { transaction_date: "2026-06-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 20, sales_amount: 200, profit_amount: 40 },
    { transaction_date: "2026-07-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 30, sales_amount: 300, profit_amount: 60 },
    { transaction_date: "2026-08-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 80, sales_amount: 800, profit_amount: 160 },
    { transaction_date: "2026-09-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 90, sales_amount: 900, profit_amount: 180 },
    { transaction_date: "2026-10-10", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 85, sales_amount: 850, profit_amount: 170 },

    { transaction_date: "2026-05-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 5, sales_amount: 50, profit_amount: 12 },
    { transaction_date: "2026-06-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 8, sales_amount: 80, profit_amount: 20 },
    { transaction_date: "2026-07-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 6, sales_amount: 60, profit_amount: 15 },
    { transaction_date: "2026-08-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 40, sales_amount: 400, profit_amount: 100 },
    { transaction_date: "2026-09-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 50, sales_amount: 500, profit_amount: 125 },
    { transaction_date: "2026-10-12", item_code: "A200", item_name: "Soap", category: "Personal Care", quantity: 45, sales_amount: 450, profit_amount: 110 },

    // Low GP item — excluded.
    { transaction_date: "2026-05-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 10, sales_amount: 100, profit_amount: 5 },
    { transaction_date: "2026-06-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 10, sales_amount: 100, profit_amount: 5 },
    { transaction_date: "2026-07-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 10, sales_amount: 100, profit_amount: 5 },
    { transaction_date: "2026-08-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 40, sales_amount: 400, profit_amount: 20 },
    { transaction_date: "2026-09-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 50, sales_amount: 500, profit_amount: 25 },
    { transaction_date: "2026-10-15", item_code: "A300", item_name: "Cheap", category: "Sundry", quantity: 45, sales_amount: 450, profit_amount: 22 },

    // LP local product — excluded.
    { transaction_date: "2026-05-20", item_code: "LP001", item_name: "Local", category: "Building Material", quantity: 10, sales_amount: 1000, profit_amount: 300 },
    { transaction_date: "2026-09-20", item_code: "LP001", item_name: "Local", category: "Building Material", quantity: 50, sales_amount: 5000, profit_amount: 1500 },

    // Current incomplete month — ignored.
    { transaction_date: "2026-11-02", item_code: "A100", item_name: "Pen", category: "Stationery", quantity: 5, sales_amount: 50, profit_amount: 10 },
  ];

  const report = buildExpectedStockedSalesReport(rows, { now });
  assert.deepEqual(report.season.calendarMonths, ["08", "09", "10"]);
  assert.equal(report.incompleteMonth, "2026-11");
  assert.equal(report.summary.itemCount, 2);
  assert.equal(report.rows.some((row) => row.itemCode === "A300"), false);
  assert.equal(report.rows.some((row) => row.itemCode.startsWith("LP")), false);

  const pen = report.rows.find((row) => row.itemCode === "A100");
  assert.equal(pen.expectedMonth, "2026-06");
  assert.equal(pen.expectedSales, 200);
  assert.equal(pen.peakMonth, "2026-07");
  assert.equal(pen.peakSales, 300);
  assert.ok(pen.gpPercent > 10);

  const soap = report.rows.find((row) => row.itemCode === "A200");
  assert.equal(soap.expectedMonth, "2026-07");
  assert.equal(soap.expectedSales, 60);
  assert.equal(soap.peakMonth, "2026-06");

  assert.equal(report.summary.expectedSales, 260);
  const stationery = report.categoryRows.find((row) => row.category === "Stationery");
  const personal = report.categoryRows.find((row) => row.category === "Personal Care");
  assert.equal(stationery.expectedSales, 200);
  assert.equal(personal.expectedSales, 60);
  assert.equal(stationery.sharePercent, 76.92);
});
