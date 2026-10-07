import test from "node:test";
import assert from "node:assert/strict";

import {
  achievementPercent,
  averageCumulativeDayShares,
  buyingCustomerCodesFromSales,
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
  pickSalesmanPaceShares,
  resolveKpiPaceDate,
  splitCollectionActualsByInvoice,
  splitSalesActuals,
  TEAM_PERFORMANCE_VIEW,
} from "../app/lib/performanceKpis.js";
import { buildUserVisitReportEmail } from "../app/lib/dailyVisitReportEmail.js";
import { loadSalesActuals, loadSalesPaceShares } from "../app/lib/performanceKpisServer.js";

function activeSalesAdmin(rows) {
  return {
    from: () => ({
      select: () => {
        const filters = [];
        const query = {
          range: () => query,
          in: (column, values) => { filters.push((row) => values.includes(row[column])); return query; },
          gte: (column, value) => { filters.push((row) => row[column] >= value); return query; },
          lte: (column, value) => { filters.push((row) => row[column] <= value); return query; },
          lt: (column, value) => { filters.push((row) => row[column] < value); return query; },
          then: (resolve) => resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }),
        };
        return query;
      },
    }),
  };
}

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
  const completedMonthStatus = kpiStatus({
    actual: 89.8,
    target: 100,
    reportDate: "2026-09-30",
    todayIso: "2026-10-01",
    paceShares: { 30: 0.694 },
  });
  assert.equal(completedMonthStatus.key, "behind");
  assert.equal(completedMonthStatus.expected, 100);
  assert.match(completedMonthStatus.label, /10\.2% behind pace/);
  assert.equal(kpiStatus({
    actual: 100,
    target: 100,
    reportDate: "2026-09-30",
    todayIso: "2026-10-01",
    paceShares: { 30: 0.694 },
  }).key, "achieved");
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

test("pace shares use that salesman only, not the company average", () => {
  const abdul = { 9: 0.12 };
  const pace = {
    company: { 9: 0.45 },
    bySalesman: new Map([
      ["ABDUL", abdul],
    ]),
  };
  assert.deepEqual(pickSalesmanPaceShares(pace, "abdul"), abdul);
  assert.equal(pickSalesmanPaceShares(pace, "ABADALLA"), null);
  assert.equal(expectedPacePercent("2026-09-09", pickSalesmanPaceShares(pace, "ABDUL")), 12);
  assert.equal(expectedPacePercent("2026-09-09", pickSalesmanPaceShares(pace, "NEWGUY")), ksaWorkdayProgressRatio("2026-09-09") * 100);
});

test("nets signed sales and positive or negative credit notes by category", () => {
  assert.equal(isOfficeSuppliesSale({ category: "Office" }), true);
  assert.equal(isOfficeSuppliesSale({ category: "Stationery" }), true);
  assert.equal(isOfficeSuppliesSale({ category: "Electronics" }), false);
  assert.deepEqual(
    splitSalesActuals([
      { category: "Office Supplies", sales_amount: 80 },
      { category: "Fridge", sales_amount: 20 },
      { item_name: "A4 paper", category: "Stationery", sales_amount: 10 },
      { category: "Office Supplies", sales_amount: -5 },
      { category: "Office Supplies", voucher_type: "Credit Note", sales_amount: 12 },
      { category: "Fridge", voucher_type: "Sales Return", sales_amount: -4 },
    ]),
    { officeSupplies: 73, otherSales: 16 },
  );
});

test("credit notes do not count as buying customers", () => {
  assert.deepEqual(
    buyingCustomerCodesFromSales([
      { customer_code: "SALE", sales_amount: 100 },
      { customer_code: "RETURN", voucher_type: "Credit Note", sales_amount: 20 },
      { customer_code: "NEGATIVE", sales_amount: -5 },
    ]),
    ["SALE"],
  );
});

test("KPI actuals and pace merge Thamer's legacy sales codes", async () => {
  const actualRows = [
    { transaction_date: "2026-09-02", salesman_code: "SM002", customer_code: "A", category: "Office Supplies", sales_amount: 100 },
    { transaction_date: "2026-09-03", salesman_code: "THAMER", customer_code: "B", category: "Office Supplies", sales_amount: 200 },
    { transaction_date: "2026-09-04", salesman_code: "THAMER MOHAMMAD AHMED QASEM", customer_code: "C", category: "Office Supplies", sales_amount: 300 },
  ];
  const actuals = await loadSalesActuals(activeSalesAdmin(actualRows), {
    salesmanCode: "SM002",
    reportDate: "2026-09-01",
  });
  assert.equal(actuals.officeSupplies, 600);

  const paceRows = [
    { transaction_date: "2026-08-01", salesman_code: "SM002", sales_amount: 100 },
    { transaction_date: "2026-08-08", salesman_code: "THAMER", sales_amount: 100 },
    { transaction_date: "2026-08-15", salesman_code: "THAMER MOHAMMAD AHMED QASEM", sales_amount: 100 },
  ];
  const pace = await loadSalesPaceShares(activeSalesAdmin(paceRows), { reportDate: "2026-09-01" });
  assert.equal(pace.bySalesman.get("SM002")[1], 1 / 3);
  assert.equal(pace.bySalesman.get("SM002")[8], 2 / 3);
  assert.equal(pace.bySalesman.get("SM002")[15], 1);
  assert.equal(pace.bySalesman.has("THAMER"), false);
});

test("splits monthly collection visits between FIFO credit and cash invoices", () => {
  const actuals = splitCollectionActualsByInvoice([
    {
      transaction_date: "2026-09-01",
      voucher_number: "RC/100",
      sales_amount: 100,
      quantity: 1,
      rate: 100,
    },
    {
      transaction_date: "2026-09-02",
      voucher_number: "NFD/200",
      sales_amount: 200,
      quantity: 1,
      rate: 200,
    },
  ], [
    { id: 1, saved_at: "2026-09-03T10:00:00Z", amount_received: 115 },
    { id: 2, saved_at: "2026-09-04T10:00:00Z", amount_received: 230 },
  ], { fromDate: "2026-09-01", toDate: "2026-09-30" });

  assert.deepEqual(actuals, { collection: 230, cashCollection: 115 });
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

  assert.equal(snapshot.kpis.length, 7);
  assert.equal(snapshot.kpis[0].label, "Sales of office supplies");
  assert.equal(snapshot.kpis[1].label, "Others");
  assert.equal(snapshot.kpis[2].label, "Total sales");
  assert.equal(snapshot.kpis[2].actual, 55);
  assert.equal(snapshot.kpis[2].target, 150);
  const cashCollection = snapshot.kpis.find((kpi) => kpi.key === "cashCollection");
  assert.equal(cashCollection.actual, 0);
  assert.equal(cashCollection.target, 0);
  assert.equal(cashCollection.achievement, null);
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
    actuals: { officeSupplies: 25000, otherSales: 5000, collection: 8000, cashCollection: 2500, newCustomers: 1, repeatCustomers: 3 },
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
  assert.match(message.text, /Cash collection \(info\): 2,500/);
  assert.match(message.text, /New customers:/);
  assert.match(message.text, /Repeat customers:/);
  assert.match(message.html, /Monthly KPI status/);
  assert.match(message.html, /Achievement/);
  assert.match(message.html, /Cash collection \(info\)/);
  assert.match(message.text, /Boss/);
});
