import test from "node:test";
import assert from "node:assert/strict";

import {
  bossCodeFromTeamTarget,
  filterKpiTargetRows,
  hasExplicitTargets,
  isTeamTargetSalesmanCode,
  rowMatchesKpiFilters,
  sumFilteredKpiColumns,
  teamMemberRows,
  teamRowLabel,
  teamTargetSalesmanCode,
  uniqueBossesFromRows,
} from "../app/lib/kpiTargetsTable.js";
import { consolidatePerformanceSnapshots, buildPerformanceSnapshot } from "../app/lib/performanceKpis.js";

const ahmed = {
  salesmanCode: "AHMED",
  salesmanName: "Ahmed",
  bossCode: "DIRECTOR",
  bossName: "Director",
  officeSupplies: "100",
  otherSales: "50",
  totalSales: "150",
  collection: "20",
  newCustomers: "2",
  repeatCustomers: "4",
  kpis: [
    { key: "officeSupplies", actual: 40 },
    { key: "otherSales", actual: 10 },
    { key: "totalSales", actual: 50 },
    { key: "collection", actual: 5 },
    { key: "newCustomers", actual: 1 },
    { key: "repeatCustomers", actual: 2 },
  ],
};

const ali = {
  salesmanCode: "ALI",
  salesmanName: "Ali",
  bossCode: "AHMED",
  bossName: "Ahmed",
  officeSupplies: "80",
  otherSales: "20",
  totalSales: "100",
  collection: "10",
  newCustomers: "1",
  repeatCustomers: "3",
  kpis: [
    { key: "officeSupplies", actual: 30 },
    { key: "otherSales", actual: 20 },
    { key: "totalSales", actual: 50 },
    { key: "collection", actual: 8 },
    { key: "newCustomers", actual: 0 },
    { key: "repeatCustomers", actual: 1 },
  ],
};

const teamAhmed = {
  salesmanCode: "TEAM:AHMED",
  salesmanName: "Ahmed — team",
  bossCode: "AHMED",
  bossName: "Ahmed",
  isTeam: true,
  officeSupplies: "200",
  otherSales: "0",
  totalSales: "200",
  collection: "0",
  newCustomers: "0",
  repeatCustomers: "0",
  kpis: [{ key: "officeSupplies", actual: 70 }],
};

test("team target codes stay separate from salesman codes", () => {
  assert.equal(teamTargetSalesmanCode("ahmed"), "TEAM:AHMED");
  assert.equal(isTeamTargetSalesmanCode("TEAM:AHMED"), true);
  assert.equal(bossCodeFromTeamTarget("TEAM:AHMED"), "AHMED");
  assert.equal(isTeamTargetSalesmanCode("AHMED"), false);
});

test("boss filter also keeps the boss's own row", () => {
  const visible = filterKpiTargetRows([ahmed, ali], { selectedBosses: ["AHMED"] });
  assert.deepEqual(visible.map((row) => row.salesmanCode).sort(), ["AHMED", "ALI"]);
});

test("boss filter still shows the boss when a salesman filter is also set", () => {
  const visible = filterKpiTargetRows([ahmed, ali], {
    selectedSalesmen: ["ALI"],
    selectedBosses: ["AHMED"],
  });
  assert.deepEqual(visible.map((row) => row.salesmanCode).sort(), ["AHMED", "ALI"]);
});

test("team row appears when that boss is filtered", () => {
  assert.equal(rowMatchesKpiFilters(teamAhmed, { selectedBosses: ["AHMED"] }), true);
  assert.equal(rowMatchesKpiFilters(teamAhmed, { selectedBosses: ["DIRECTOR"] }), false);
});

test("filtered totals skip team rows so they are not double counted", () => {
  const totals = sumFilteredKpiColumns([ahmed, ali, teamAhmed]);
  assert.equal(totals.officeSupplies.actual, 70);
  assert.equal(totals.officeSupplies.target, 180);
  assert.equal(totals.totalSales.actual, 100);
  assert.equal(totals.totalSales.target, 250);
  assert.equal(totals.officeSupplies.achievement, (70 / 180) * 100);
});

test("unique bosses and team members include the boss", () => {
  assert.deepEqual(uniqueBossesFromRows([ahmed, ali]).map((row) => row.bossCode), ["AHMED", "DIRECTOR"]);
  assert.deepEqual(teamMemberRows([ahmed, ali, teamAhmed], "AHMED").map((row) => row.salesmanCode).sort(), ["AHMED", "ALI"]);
  assert.equal(teamRowLabel("Ahmed", "team"), "Ahmed — team");
  assert.equal(hasExplicitTargets({ officeSupplies: 0, otherSales: 0 }), false);
  assert.equal(hasExplicitTargets({ officeSupplies: 10 }), true);
});

test("team snapshot uses an explicit team target instead of summed individuals", () => {
  const team = consolidatePerformanceSnapshots([
    buildPerformanceSnapshot({
      reportDate: "2026-09-10",
      salesmanCode: "ALI",
      actuals: { officeSupplies: 30, otherSales: 0, collection: 0, newCustomers: 0, repeatCustomers: 0 },
      targets: { officeSupplies: 0, otherSales: 0, collection: 0, newCustomers: 0, repeatCustomers: 0 },
    }),
  ], {
    reportDate: "2026-09-10",
    teamTargets: { officeSupplies: 200, otherSales: 0 },
  });
  assert.equal(team.usesTeamTarget, true);
  assert.equal(team.targets.officeSupplies, 200);
  assert.equal(team.kpis[0].actual, 30);
  assert.equal(team.kpis[0].target, 200);
});
