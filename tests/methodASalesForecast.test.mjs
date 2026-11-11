import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  averageCumulativeDayShares,
  expectedPacePercent,
  resolveExpectedPacePercent,
  monthEndPaceEstimate,
  ksaWorkdayProgressRatio,
} from "../app/lib/performanceKpis.js";
import { sumFilteredKpiPaceEstimates } from "../app/lib/kpiTargetsTable.js";
import { normalizeReportSalesmanCode } from "../app/lib/salesmanReportIdentity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY_SALES_PATH = path.join(ROOT, "scripts", "analysis", "daily-sales.json");

const EXCLUDE = new Set([
  "ADMIN", "NOT IN VOUCHER", "NOT ADDED IN VOUCHER", "NOON", "TRENDYOL", "",
]);

test("collection KPIs still use workday pace only (Method A does not apply)", () => {
  const salesCurve = { 9: 0.55 };
  const workday = ksaWorkdayProgressRatio("2026-11-10") * 100;
  assert.equal(
    resolveExpectedPacePercent("collection", {
      reportDate: "2026-11-01",
      todayIso: "2026-11-10",
      paceShares: salesCurve,
      receiptAsOfDate: "2026-11-10",
    }),
    workday,
  );
  assert.equal(
    resolveExpectedPacePercent("cashCollection", {
      reportDate: "2026-11-01",
      todayIso: "2026-11-10",
      paceShares: salesCurve,
      receiptAsOfDate: "2026-11-10",
    }),
    workday,
  );
  assert.ok(expectedPacePercent("2026-11-10", salesCurve) > workday);
});

test("Method A: zero MTD does not invent a positive sales forecast", () => {
  assert.equal(monthEndPaceEstimate({ actual: 0, expected: 35 }), null);
  assert.equal(monthEndPaceEstimate({ actual: -500, expected: 35 }), -500);
  assert.equal(monthEndPaceEstimate({ actual: 1000, expected: 50 }), 2000);
  assert.equal(monthEndPaceEstimate({ actual: 1000, expected: 200 }), 1000); // never below booked
});

test("Method A: month-end expected pace forces forecast equal to actual", () => {
  assert.equal(expectedPacePercent("2026-11-30", { 30: 0.4 }), 100);
  assert.equal(
    monthEndPaceEstimate({
      actual: 1_206_045,
      expected: expectedPacePercent("2026-11-30", { 30: 0.4 }),
    }),
    1_206_045,
  );
});

test("Method A: median curve ignores sparse extreme month versus mean", () => {
  const rows = [
    // Three normal months: 50% by day 10
    { transaction_date: "2026-05-10", sales_amount: 50 },
    { transaction_date: "2026-05-20", sales_amount: 50 },
    { transaction_date: "2026-06-10", sales_amount: 50 },
    { transaction_date: "2026-06-20", sales_amount: 50 },
    { transaction_date: "2026-07-10", sales_amount: 50 },
    { transaction_date: "2026-07-20", sales_amount: 50 },
    // Extreme early booking month
    { transaction_date: "2026-08-01", sales_amount: 95 },
    { transaction_date: "2026-08-20", sales_amount: 5 },
  ];
  const medianCurve = averageCumulativeDayShares(rows, { aggregator: "median", maxMonths: 6 });
  const meanCurve = averageCumulativeDayShares(rows, { aggregator: "mean", maxMonths: 6 });
  assert.equal(medianCurve.shares[10], 0.5);
  assert.ok(meanCurve.shares[10] > 0.5);
});

test("Method A: filtered Total sales estimate equals sum of salesman forecasts", () => {
  const rows = [
    {
      salesmanCode: "A",
      isTeam: false,
      paceShares: { 9: 0.5 },
      kpis: [
        { key: "totalSales", actual: 100_000 },
        { key: "officeSupplies", actual: 100_000 },
      ],
      totalSales: "0",
      officeSupplies: "0",
      localItemSales: "0",
      otherSales: "0",
      collection: "0",
      newCustomers: "0",
      repeatCustomers: "0",
    },
    {
      salesmanCode: "B",
      isTeam: false,
      paceShares: { 9: 0.25 },
      kpis: [
        { key: "totalSales", actual: 50_000 },
        { key: "officeSupplies", actual: 50_000 },
      ],
      totalSales: "0",
      officeSupplies: "0",
      localItemSales: "0",
      otherSales: "0",
      collection: "0",
      newCustomers: "0",
      repeatCustomers: "0",
    },
    {
      salesmanCode: "TEAM",
      isTeam: true,
      paceShares: { 9: 0.5 },
      kpis: [{ key: "totalSales", actual: 999_999 }],
      totalSales: "0",
      officeSupplies: "0",
      localItemSales: "0",
      otherSales: "0",
      collection: "0",
      newCustomers: "0",
      repeatCustomers: "0",
    },
    {
      salesmanCode: "ZERO",
      isTeam: false,
      paceShares: { 9: 0.4 },
      kpis: [{ key: "totalSales", actual: 0 }],
      totalSales: "0",
      officeSupplies: "0",
      localItemSales: "0",
      otherSales: "0",
      collection: "0",
      newCustomers: "0",
      repeatCustomers: "0",
    },
  ];
  const estimates = sumFilteredKpiPaceEstimates(rows, ["totalSales"], {
    reportDate: "2026-11-01",
    todayIso: "2026-11-10",
    salesAsOfDate: "2026-11-10",
  });
  const workday = ksaWorkdayProgressRatio("2026-11-10") * 100;
  const expectedA = Math.max(50, workday);
  const expectedB = Math.max(25, workday);
  const forecastA = 100_000 * (100 / expectedA);
  const forecastB = 50_000 * (100 / expectedB);
  assert.ok(Math.abs(estimates.totalSales.estimate - (forecastA + forecastB)) < 0.01);
});

test("November 10 snapshot Method A company total is approximately SAR 1,206,045", () => {
  if (!fs.existsSync(DAILY_SALES_PATH)) {
    // Snapshot fixture is optional outside analysis workspaces.
    return;
  }
  const raw = JSON.parse(fs.readFileSync(DAILY_SALES_PATH, "utf8"));
  const bySalesman = new Map();
  for (const row of raw) {
    const code = normalizeReportSalesmanCode(row.salesman);
    if (!code || EXCLUDE.has(code)) continue;
    const d = String(row.d).slice(0, 10);
    const net = Number(row.net_sales) || 0;
    if (!bySalesman.has(code)) bySalesman.set(code, []);
    bySalesman.get(code).push({
      transaction_date: d,
      sales_amount: net,
    });
  }

  const asOf = "2026-11-10";
  const reportMonth = "2026-11";
  let company = 0;
  let mtd = 0;
  for (const [, rows] of bySalesman) {
    const history = rows.filter((r) => String(r.transaction_date).slice(0, 7) < reportMonth);
    const current = rows.filter((r) => {
      const d = String(r.transaction_date);
      return d >= "2026-11-01" && d <= asOf;
    });
    const actual = current.reduce((sum, r) => sum + Number(r.sales_amount || 0), 0);
    mtd += actual;
    const curve = averageCumulativeDayShares(history, { aggregator: "median", maxMonths: 6 });
    const expected = expectedPacePercent(asOf, curve.shares);
    const forecast = monthEndPaceEstimate({ actual, expected });
    if (forecast != null) company += forecast;
  }

  assert.ok(mtd > 400_000 && mtd < 450_000, `unexpected MTD ${mtd}`);
  // Must match the approved backtest (workday-indexed Method A) within rounding.
  assert.ok(
    Math.abs(company - 1_206_045) < 2,
    `November Method A company forecast ${company} != 1,206,045`,
  );
});
