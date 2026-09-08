import test from "node:test";
import assert from "node:assert/strict";

import {
  appendMonthlyPerformanceToPdf,
  buildMonthlyPerformancePdfModel,
  measureMonthlyPerformancePdfHeight,
  monthTrend,
} from "../app/lib/orderPdfMonthlyPerformance.js";
import { numberFormat } from "../app/management/customer-audit/lib/format.js";

test("monthTrend matches the on-screen green/red rules", () => {
  assert.equal(monthTrend(10, 4, true), "up");
  assert.equal(monthTrend(3, 9, true), "down");
  assert.equal(monthTrend(5, 5, true), "same");
  assert.equal(monthTrend(12, 0, false), "none");
});

test("buildMonthlyPerformancePdfModel builds year groups, trends, and totals", () => {
  const model = buildMonthlyPerformancePdfModel({
    months: ["2025-12", "2026-01", "2026-03"],
    yearGroups: [
      { year: "2025", months: ["2025-12"] },
      { year: "2026", months: ["2026-01", "2026-03"] },
    ],
    monthlySummary: [
      { month: "2025-12", sales: -18026, skuCount: 6 },
      { month: "2026-01", sales: 48683, skuCount: 8 },
      { month: "2026-03", sales: 14941, skuCount: 17 },
    ],
    itemCount: 64,
  }, { currentMonthKey: "2026-09" });

  assert.equal(model.title, "Monthly Performance");
  assert.deepEqual(model.yearGroups, [
    { year: "2025", colSpan: 1 },
    { year: "2026", colSpan: 2 },
  ]);
  assert.deepEqual(model.months.map((month) => month.label), ["DEC", "JAN", "MAR"]);
  assert.equal(model.rows[0].label, "Sales");
  assert.equal(model.rows[0].cells[0].trend, "none");
  assert.equal(model.rows[0].cells[1].trend, "up");
  assert.equal(model.rows[0].cells[2].trend, "down");
  assert.equal(model.rows[1].cells[2].trend, "up");
  assert.equal(model.rows[1].total, "64");
  assert.ok(measureMonthlyPerformancePdfHeight(model) > 70);
});

test("buildMonthlyPerformancePdfModel returns null without monthly history", () => {
  assert.equal(buildMonthlyPerformancePdfModel(null), null);
  assert.equal(buildMonthlyPerformancePdfModel({ months: [], monthlySummary: [] }), null);
});

test("appendMonthlyPerformanceToPdf draws the table and advances Y", () => {
  const texts = [];
  const doc = {
    setFillColor() {},
    setDrawColor() {},
    setLineWidth() {},
    rect() {},
    setFont() {},
    setFontSize() {},
    setTextColor() {},
    text(value) {
      texts.push(String(value));
    },
  };

  const nextY = appendMonthlyPerformanceToPdf(doc, {
    analytics: {
      months: ["2026-01"],
      yearGroups: [{ year: "2026", months: ["2026-01"] }],
      monthlySummary: [{ month: "2026-01", sales: 1000, skuCount: 4 }],
      itemCount: 4,
    },
    x: 40,
    y: 200,
    maxWidth: 515,
  });

  assert.ok(nextY > 200);
  assert.ok(texts.includes("Monthly Performance"));
  assert.ok(texts.includes("Sales"));
  assert.ok(texts.includes("SKUs Sold"));
  assert.ok(texts.includes("JAN"));
});

test("buildMonthlyPerformancePdfModel includes the current month when it has values", () => {
  const model = buildMonthlyPerformancePdfModel({
    months: ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07", "2026-08", "2026-09"],
    monthlySummary: [
      { month: "2026-02", sales: 1131, skuCount: 1 },
      { month: "2026-03", sales: 2074, skuCount: 1 },
      { month: "2026-04", sales: 974, skuCount: 1 },
      { month: "2026-05", sales: 1457, skuCount: 1 },
      { month: "2026-07", sales: 2479, skuCount: 1 },
      { month: "2026-08", sales: 2642, skuCount: 1 },
      { month: "2026-09", sales: 880, skuCount: 2 },
    ],
    itemCount: 2,
  }, { currentMonthKey: "2026-09" });

  assert.deepEqual(model.months.map((month) => month.label), ["FEB", "MAR", "APR", "MAY", "JUL", "AUG", "SEPT"]);
  assert.equal(model.rows[0].cells.at(-1).text, numberFormat(880));
});
