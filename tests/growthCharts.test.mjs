import test from "node:test";
import assert from "node:assert/strict";

import {
  OTHERS_SERIES_KEY,
  TOTAL_SERIES_KEY,
  buildCompareChartItems,
  buildPeriodChartModel,
  buildShareChartItems,
  buildSignalMix,
  chartMonthPeriodLabel,
  chartOpenMonthEstimate,
  compactChartNumber,
  periodTotal,
  splitTopChartRows,
} from "../app/lib/growthCharts.js";
import { expectedPacePercent } from "../app/lib/performanceKpis.js";

const rows = [
  { label: "Fridge", lifetime: 900, monthValues: { "2026-01": 100, "2026-02": 200 }, status: "green" },
  { label: "Cooker", lifetime: 400, monthValues: { "2026-01": 50, "2026-02": 80 }, status: "orange" },
  { label: "Fan", lifetime: 200, monthValues: { "2026-01": 20, "2026-02": 10 }, status: "red" },
  { label: "Iron", lifetime: 80, monthValues: { "2026-01": 5, "2026-02": 5 }, status: "neutral" },
];

test("compact numbers keep charts readable", () => {
  assert.equal(compactChartNumber(1250000), "1.3M");
  assert.equal(compactChartNumber(12500), "13k");
  assert.equal(compactChartNumber(42), "42");
});

test("splitTopChartRows keeps the biggest rows and the rest", () => {
  const { top, rest } = splitTopChartRows(rows, { limit: 2 });
  assert.deepEqual(top.map((row) => row.label), ["Fridge", "Cooker"]);
  assert.equal(rest.length, 2);
});

test("period totals follow the requested months", () => {
  assert.equal(periodTotal(rows[0], ["2026-01", "2026-02"]), 300);
});

test("period chart model adds Others and Total series", () => {
  const model = buildPeriodChartModel(rows, ["2026-01", "2026-02"], (row) => row.monthValues, { limit: 2 });
  assert.equal(model.series.length, 4);
  assert.equal(model.series[2].key, OTHERS_SERIES_KEY);
  assert.deepEqual(model.series[2].values, [25, 15]);
  const total = model.series.find((item) => item.key === TOTAL_SERIES_KEY);
  assert.deepEqual(total.values, [175, 295]);
  assert.equal(model.max, 295);
});

test("open-month chart points use KPI pace estimates", () => {
  const expected = expectedPacePercent("2026-11-01", null);
  assert.ok(expected > 0 && expected < 100);
  const projected = chartOpenMonthEstimate(100_000, {
    openMonth: "2026-11",
    period: "2026-11",
    todayIso: "2026-11-01",
    salesAsOfDate: "2026-11-01",
  });
  assert.equal(Math.round(projected), Math.round(100_000 * (100 / expected)));
  assert.equal(chartOpenMonthEstimate(100_000, {
    openMonth: "2026-11",
    period: "2026-10",
    todayIso: "2026-11-01",
  }), 100_000);
  assert.equal(chartMonthPeriodLabel("2026-11", "2026-11", { estimated: true }), "Nov 26 est.");
  assert.equal(chartMonthPeriodLabel("2026-11", "2026-11", { estimated: false }), "Nov 26 MTD");

  const model = buildPeriodChartModel(rows, ["2026-01", "2026-02"], (row) => row.monthValues, {
    limit: 2,
    estimateOpenMonth: true,
    openMonth: "2026-02",
    todayIso: "2026-02-02",
    salesAsOfDate: "2026-02-02",
  });
  const total = model.series.find((item) => item.key === TOTAL_SERIES_KEY);
  const febExpected = expectedPacePercent("2026-02-02", null);
  assert.equal(Math.round(total.values[1]), Math.round(295 * (100 / febExpected)));
  assert.equal(total.values[0], 175);
  assert.equal(model.openMonthEstimated, true);
});

test("share and compare charts rank by the selected value", () => {
  const share = buildShareChartItems(rows, { limit: 2 });
  assert.equal(share[0].label, "Fridge");
  assert.equal(share.at(-1).key, OTHERS_SERIES_KEY);
  assert.equal(share.at(-1).value, 280);

  const compare = buildCompareChartItems([
    { label: "Ali", latestCompleteAmount: 80, priorMonthAmount: 50 },
    { label: "Sara", latestCompleteAmount: 20, priorMonthAmount: 40 },
  ], { limit: 1 });
  assert.equal(compare.length, 1);
  assert.equal(compare[0].label, "Ali");
  assert.equal(compare[0].latest, 80);
});

test("signal mix counts the current filtered rows", () => {
  assert.deepEqual(buildSignalMix(rows), {
    green: 1,
    orange: 1,
    red: 1,
    neutral: 1,
  });
});
