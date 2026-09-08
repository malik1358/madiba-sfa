import test from "node:test";
import assert from "node:assert/strict";

import {
  achievementPercent,
  averageCumulativeDayShares,
  buildPerformanceSnapshot,
  expectedPacePercent,
  ksaWorkdayProgressRatio,
  isMissingSchemaColumn,
  classifyBuyingCustomers,
  consolidatePerformanceSnapshots,
  formatPerformanceKpiLine,
  isOfficeSuppliesSale,
  kpiStatus,
  normalizePerformanceTargets,
  performanceUpdatedStatusLabel,
  resolveKpiPaceDate,
  splitSalesActuals,
  TEAM_PERFORMANCE_VIEW,
} from "../app/lib/performanceKpis.js";
import { buildUserVisitReportEmail } from "../app/lib/dailyVisitReportEmail.js";

test("detects PostgREST schema-cache missing column errors", () => {
  assert.equal(isMissingSchemaColumn({
    code: "PGRST204",
    message: "Could not find the 'collection_target' column of 'kpi_targets' in the schema cache",
  }), true);
  assert.equal(isMissingSchemaColumn({ message: "Unable to load KPI targets." }), false);
});

test("achievement percent is actual over target", () => {
  assert.equal(achievementPercent(50, 100), 50);
  assert.equal(achievementPercent(120, 100), 120);
  assert.equal(achievementPercent(10, 0), null);
});

test("classifies new and repeat buying customers", () => {
  assert.deepEqual(
    classifyBuyingCustomers(["A", "B", "a", "C"], ["A", "D"]),
    { newCustomers: 2, repeatCustomers: 1 },
  );
});

test("KPI status compares actual/target with expected pace by today", () => {
  assert.equal(kpiStatus({ actual: 100, target: 100, reportDate: "2026-09-10" }).key, "achieved");
  assert.equal(
    kpiStatus({ actual: 25174, target: 10, reportDate: "2026-09-01", todayIso: "2026-09-08" }).key,
    "achieved",
  );
  assert.equal(
    resolveKpiPaceDate("2026-09-01", "2026-09-08"),
    "2026-09-08",
  );
  assert.equal(
    kpiStatus({ actual: 40, target: 100, reportDate: "2026-09-30", todayIso: "2026-09-30" }).key,
    "behind",
  );
  assert.match(
    kpiStatus({ actual: 40, target: 100, reportDate: "2026-09-30", todayIso: "2026-09-30" }).label,
    /behind pace/,
  );
  assert.equal(kpiStatus({ actual: 10, target: 0, reportDate: "2026-09-06" }).key, "no_target");
});

test("expected pace uses historical share of month sales by that date", () => {
  const curve = averageCumulativeDayShares([
    { transaction_date: "2026-07-08", sales_amount: 70 },
    { transaction_date: "2026-07-20", sales_amount: 30 },
    { transaction_date: "2026-08-08", sales_amount: 70 },
    { transaction_date: "2026-08-20", sales_amount: 30 },
  ]);
  assert.equal(curve.monthCount, 2);
  assert.equal(expectedPacePercent("2026-09-08", curve.shares), 70);
  const status = kpiStatus({
    actual: 20,
    target: 100,
    reportDate: "2026-09-01",
    todayIso: "2026-09-08",
    paceShares: curve.shares,
  });
  assert.equal(status.key, "behind");
  assert.equal(status.expected, 70);
  assert.match(status.label, /50\.0% behind pace/);
});

test("expected pace ignores a 0% historical start and uses working days instead", () => {
  const workday = ksaWorkdayProgressRatio("2026-09-08") * 100;
  assert.ok(workday > 0);
  assert.equal(expectedPacePercent("2026-09-08", { 1: 0, 8: 0 }), workday);
  const status = kpiStatus({
    actual: 25174,
    target: 1048916,
    reportDate: "2026-09-01",
    todayIso: "2026-09-08",
    paceShares: { 1: 0, 8: 0 },
  });
  assert.notEqual(status.expected, 0);
  assert.ok(status.expected > 1);
});

test("splits office supplies sales from other sales", () => {
  assert.equal(isOfficeSuppliesSale({ category: "Office" }), true);
  assert.equal(isOfficeSuppliesSale({ category: "Stationery" }), true);
  assert.equal(isOfficeSuppliesSale({ category: "Electronics" }), false);
  assert.deepEqual(
    splitSalesActuals([
      { category: "Office Supplies", sales_amount: 80 },
      { category: "Fridge", sales_amount: 20 },
      { item_name: "A4 paper", category: "Stationery", sales_amount: 10 },
    ]),
    { officeSupplies: 90, otherSales: 20 },
  );
});

test("does not move Others target into office supplies after save", () => {
  const saved = normalizePerformanceTargets({
    salesmanCode: "SM001",
    office_supplies_sales_target: 0,
    other_sales_target: 250,
    sales_target: 250,
  });
  assert.equal(saved.officeSupplies, 0);
  assert.equal(saved.otherSales, 250);
  assert.equal(saved.totalSales, 250);

  const nested = normalizePerformanceTargets({
    officeSupplies: 0,
    otherSales: 180,
  });
  assert.equal(nested.officeSupplies, 0);
  assert.equal(nested.otherSales, 180);
  assert.equal(nested.totalSales, 180);
});

test("legacy sales_target becomes total sales, not office supplies", () => {
  const legacy = normalizePerformanceTargets({ sales_target: 400 });
  assert.equal(legacy.officeSupplies, 0);
  assert.equal(legacy.otherSales, 0);
  assert.equal(legacy.totalSales, 400);

  const nestedTotal = normalizePerformanceTargets({
    officeSupplies: 0,
    otherSales: 0,
    totalSales: 400,
  });
  assert.equal(nestedTotal.totalSales, 400);
});

test("updated status explains when admin last saved targets", () => {
  const snapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-04",
    salesmanCode: "SM001",
    actuals: { officeSupplies: 40, otherSales: 15, collection: 10, newCustomers: 1, repeatCustomers: 2 },
    targets: { officeSupplies: 100, otherSales: 50, collection: 50, newCustomers: 2, repeatCustomers: 4 },
    updatedAt: "2026-09-01T08:00:00.000Z",
    updatedByName: "Admin User",
  });

  assert.equal(snapshot.kpis.length, 6);
  assert.equal(snapshot.kpis[0].label, "Sales of office supplies");
  assert.equal(snapshot.kpis[1].label, "Others");
  assert.equal(snapshot.kpis[2].label, "Total sales");
  assert.equal(snapshot.kpis[2].actual, 55);
  assert.equal(snapshot.kpis[2].target, 150);
  assert.match(performanceUpdatedStatusLabel(snapshot), /Admin User/);
  assert.match(formatPerformanceKpiLine(snapshot.kpis[0]), /Sales of office supplies:/);
  assert.match(formatPerformanceKpiLine(snapshot.kpis[0]), /40\.0%/);
});

test("consolidates member KPIs into a team snapshot", () => {
  const team = consolidatePerformanceSnapshots([
    buildPerformanceSnapshot({
      reportDate: "2026-09-04",
      salesmanCode: "SM001",
      actuals: { officeSupplies: 40, otherSales: 10, collection: 5, newCustomers: 1, repeatCustomers: 2 },
      targets: { officeSupplies: 100, otherSales: 20, collection: 10, newCustomers: 2, repeatCustomers: 4 },
    }),
    buildPerformanceSnapshot({
      reportDate: "2026-09-04",
      salesmanCode: "SM002",
      actuals: { officeSupplies: 60, otherSales: 30, collection: 15, newCustomers: 1, repeatCustomers: 3 },
      targets: { officeSupplies: 100, otherSales: 80, collection: 30, newCustomers: 2, repeatCustomers: 6 },
    }),
  ], { reportDate: "2026-09-04", salesmanName: "Ahmed — team" });

  assert.equal(team.salesmanCode, TEAM_PERFORMANCE_VIEW);
  assert.equal(team.isTeam, true);
  assert.equal(team.memberCount, 2);
  assert.equal(team.actuals.officeSupplies, 100);
  assert.equal(team.targets.otherSales, 100);
  assert.equal(team.kpis[0].achievement, 50);
});

test("daily visit email includes monthly KPI status", () => {
  const snapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-02",
    salesmanCode: "SM001",
    actuals: { officeSupplies: 25000, otherSales: 5000, collection: 8000, newCustomers: 1, repeatCustomers: 3 },
    targets: { officeSupplies: 50000, otherSales: 10000, collection: 10000, newCustomers: 2, repeatCustomers: 6 },
    updatedAt: "2026-09-01T08:00:00.000Z",
    updatedByName: "Boss",
  });

  const message = buildUserVisitReportEmail({
    date: "2026-09-02",
    user: {
      userName: "Ahmed (SM001)",
      visitCount: 1,
      farFromCustomerCount: 0,
      totalRouteDistanceKm: 2,
      performance: snapshot,
      entries: [],
    },
  });

  assert.match(message.text, /Monthly KPI status/);
  assert.match(message.text, /Sales of office supplies:/);
  assert.match(message.text, /Others:/);
  assert.match(message.text, /Total sales:/);
  assert.match(message.text, /Collection:/);
  assert.match(message.text, /New customers:/);
  assert.match(message.text, /Repeat customers:/);
  assert.match(message.html, /Monthly KPI status/);
  assert.match(message.html, /Achievement/);
  assert.match(message.text, /Boss/);
});
