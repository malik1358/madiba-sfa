import test from "node:test";
import assert from "node:assert/strict";

import {
  bossCodeFromTeamTarget,
  filterKpiTargetRows,
  hasExplicitTargets,
  isKpiTargetProfile,
  isTeamTargetSalesmanCode,
  mergeKpiTargetProfiles,
  rowMatchesKpiFilters,
  sumFilteredKpiColumns,
  sumFilteredKpiPaceEstimates,
  teamMemberRows,
  teamRowLabel,
  teamTargetSalesmanCode,
  uniqueBossesFromRows,
} from "../app/lib/kpiTargetsTable.js";
import {
  achievementPercent,
  consolidatePerformanceSnapshots,
  buildPerformanceKpi,
  buildPerformanceSnapshot,
  estimateFromPaceGap,
  formatKpiTargetInput,
  monthEndPaceEstimate,
  parseKpiTargetInput,
  resolveExpectedPacePercent,
} from "../app/lib/performanceKpis.js";
import { isCollectionOnlyAccess } from "../app/lib/moduleAccess.js";

test("KPI roster includes Zia and Asrar without changing collection-only access", () => {
  for (const profile of [
    { salesman_code: "CL01", salesman_name: " Zia ", role: "collector" },
    { salesman_code: "CL02", salesman_name: "asrar   ahmed", role: "collector" },
    { salesman_code: "CL03", salesman_name: "Asrar", role: "salesman" },
  ]) {
    assert.equal(isKpiTargetProfile(profile), true);
    assert.equal(isCollectionOnlyAccess({ role: profile.role, salesmanCode: profile.salesman_code }), true);
  }
});

test("KPI roster still excludes other collectors and profiles without a code", () => {
  assert.equal(isKpiTargetProfile({ salesman_code: "SM01", salesman_name: "Ali", role: "salesman" }), true);
  assert.equal(isKpiTargetProfile({ salesman_code: "SM02", salesman_name: "Other collector", role: "collector" }), false);
  assert.equal(isKpiTargetProfile({ salesman_code: "CL04", salesman_name: "Other collector", role: "salesman" }), false);
  assert.equal(isKpiTargetProfile({ salesman_code: " ", salesman_name: "Zia", role: "collector" }), false);
  assert.equal(isKpiTargetProfile(null), false);
});

test("inactive KPI exceptions stay visible without admitting other inactive profiles", () => {
  assert.equal(isKpiTargetProfile({ salesman_code: "CL01", salesman_name: "Zia", role: "collector", is_active: false }), true);
  assert.equal(isKpiTargetProfile({ salesman_code: "CL02", salesman_name: "Asrar Ahmed", role: "collector", is_active: false }), true);
  assert.equal(isKpiTargetProfile({ salesman_code: "SM03", salesman_name: "Inactive salesman", role: "salesman", is_active: false }), false);
  assert.equal(isKpiTargetProfile({ salesman_code: "CL05", salesman_name: "Inactive collector", role: "collector", is_active: false }), false);
});

test("KPI roster merges Thamer aliases and keeps the canonical profile and boss", () => {
  const profiles = mergeKpiTargetProfiles([
    { id: "legacy-short", salesman_code: "THAMER", salesman_name: "THAMER", bossCode: "" },
    { id: "legacy-full", salesman_code: "THAMER MOHAMMAD AHMED QASEM", salesman_name: "THAMER MOHAMMAD AHMED QASEM", bossCode: "" },
    { id: "canonical", salesman_code: "SM002", salesman_name: "Thamer", bossCode: "ABDUL REHMAN" },
    { id: "other", salesman_code: "SM003", salesman_name: "Other", bossCode: "MANAGER" },
  ]);

  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles[0], {
    id: "canonical",
    salesman_code: "SM002",
    salesman_name: "Thamer",
    bossCode: "ABDUL REHMAN",
  });
  assert.equal(profiles[1].salesman_code, "SM003");
});

const ahmed = {
  salesmanCode: "AHMED",
  salesmanName: "Ahmed",
  bossCode: "DIRECTOR",
  bossName: "Director",
  officeSupplies: "100",
  localItemSales: "40",
  otherSales: "50",
  totalSales: "150",
  collection: "20",
  newCustomers: "2",
  repeatCustomers: "4",
  kpis: [
    { key: "officeSupplies", actual: 40 },
    { key: "localItemSales", actual: 10 },
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
  localItemSales: "20",
  otherSales: "20",
  totalSales: "100",
  collection: "10",
  newCustomers: "1",
  repeatCustomers: "3",
  kpis: [
    { key: "officeSupplies", actual: 30 },
    { key: "localItemSales", actual: 5 },
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
  assert.equal(totals.totalSales.target, 310);
  assert.equal(totals.officeSupplies.achievement, (70 / 180) * 100);
  assert.equal(totals.localItemSales.actual, 15);
  assert.equal(totals.localItemSales.target, 60);
});

test("estimate from pace gap applies ahead/behind points to the target", () => {
  assert.equal(estimateFromPaceGap(4_550_000, -21), 3_594_500);
  assert.equal(estimateFromPaceGap(1_000_000, 10), 1_100_000);
  assert.equal(estimateFromPaceGap(1_000_000, 0), 1_000_000);
  assert.equal(estimateFromPaceGap(0, -21), null);
  assert.equal(estimateFromPaceGap(100, null), null);
});

test("target inputs round-trip through thousand separators", () => {
  assert.equal(parseKpiTargetInput("1,200,000"), "1200000");
  assert.equal(parseKpiTargetInput("12a00"), "1200");
  assert.match(formatKpiTargetInput("1200000"), /1.?200.?000/);
  assert.equal(parseKpiTargetInput(formatKpiTargetInput("4550000")), "4550000");
});

test("total cash collected pace estimate is collection plus cash collection", () => {
  const rows = [
    {
      ...ahmed,
      collection: "2000000",
      kpis: [
        ...ahmed.kpis.filter((kpi) => !["collection", "cashCollection", "totalCashCollected"].includes(kpi.key)),
        { key: "collection", actual: 1_277_176 },
        { key: "cashCollection", actual: 262_557 },
        { key: "totalCashCollected", actual: 1_539_733 },
      ],
    },
  ];
  const estimates = sumFilteredKpiPaceEstimates(
    rows,
    ["collection", "cashCollection", "totalCashCollected"],
    { reportDate: "2026-10-01", todayIso: "2026-10-10" },
  );
  assert.equal(
    estimates.totalCashCollected.estimate,
    (Number(estimates.collection.estimate) || 0) + (Number(estimates.cashCollection.estimate) || 0),
  );
  assert.notEqual(
    estimates.totalCashCollected.estimate,
    monthEndPaceEstimate({
      actual: 1_539_733,
      target: 0,
      expected: resolveExpectedPacePercent("totalCashCollected", {
        reportDate: "2026-10-01",
        todayIso: "2026-10-10",
      }),
      paceGap: null,
    }),
  );
});

test("month-end pace estimate keeps untarged actual and never falls below actual", () => {
  assert.equal(monthEndPaceEstimate({ actual: 40, target: 100, expected: 50, paceGap: -10 }), 90);
  assert.equal(monthEndPaceEstimate({ actual: 14882, target: 0, expected: 50, paceGap: null }), 29764);
  assert.equal(monthEndPaceEstimate({ actual: 14882, target: 0, expected: null, paceGap: null }), 14882);
  assert.equal(monthEndPaceEstimate({ actual: 0, target: 0, expected: 50, paceGap: null }), null);
});

test("pace estimate footer stays at or above the filtered actual total", () => {
  // Pace share 100% by day 10 makes each targeted estimate equal that salesman's actual.
  // Untarged sales with actual used to be dropped, so the footer (1,262,294) fell below Actual (1,277,176).
  const rows = [
    {
      ...ahmed,
      paceShares: { 10: 1 },
      kpis: ahmed.kpis.map((kpi) => (
        kpi.key === "officeSupplies" ? { ...kpi, actual: 1_262_294 } : kpi
      )),
    },
    {
      salesmanCode: "ZIAD",
      salesmanName: "Ziad",
      bossCode: "DIRECTOR",
      bossName: "Director",
      officeSupplies: "0",
      localItemSales: "0",
      otherSales: "0",
      totalSales: "0",
      collection: "0",
      newCustomers: "0",
      repeatCustomers: "0",
      paceShares: { 10: 1 },
      kpis: [
        { key: "officeSupplies", actual: 14_882 },
        { key: "localItemSales", actual: 0 },
        { key: "otherSales", actual: 0 },
        { key: "totalSales", actual: 14_882 },
        { key: "collection", actual: 0 },
        { key: "newCustomers", actual: 0 },
        { key: "repeatCustomers", actual: 0 },
      ],
    },
  ];
  const estimates = sumFilteredKpiPaceEstimates(rows, ["officeSupplies"], {
    reportDate: "2026-10-01",
    todayIso: "2026-10-10",
  });
  const actualTotal = sumFilteredKpiColumns(rows, ["officeSupplies"]).officeSupplies.actual;
  assert.equal(actualTotal, 1_277_176);
  assert.ok(estimates.officeSupplies.estimate >= actualTotal);
  assert.equal(estimates.officeSupplies.estimate, 1_277_176);
  const ahmedLive = buildPerformanceKpi("officeSupplies", {
    actual: 1_262_294,
    target: 100,
    reportDate: "2026-10-01",
    todayIso: "2026-10-10",
    paceShares: { 10: 1 },
  });
  assert.equal(estimateFromPaceGap(100, ahmedLive.paceGap), 1_262_294);
  assert.equal(
    monthEndPaceEstimate({
      actual: 14_882,
      target: 0,
      expected: 100,
      paceGap: null,
    }),
    14_882,
  );
});

test("pace estimate footer sums each salesman's own pace gap", () => {
  const rows = [
    { ...ahmed, paceShares: { 10: 0.5 } },
    { ...ali, paceShares: { 10: 0.8 } },
    teamAhmed,
  ];
  const estimates = sumFilteredKpiPaceEstimates(rows, ["officeSupplies", "totalSales"], {
    reportDate: "2026-10-01",
    todayIso: "2026-10-10",
  });
  const ahmedOffice = buildPerformanceKpi("officeSupplies", {
    actual: 40,
    target: 100,
    reportDate: "2026-10-01",
    todayIso: "2026-10-10",
    paceShares: { 10: 0.5 },
  });
  const aliOffice = buildPerformanceKpi("officeSupplies", {
    actual: 30,
    target: 80,
    reportDate: "2026-10-01",
    todayIso: "2026-10-10",
    paceShares: { 10: 0.8 },
  });
  const officeEstimate = monthEndPaceEstimate({
    actual: 40,
    target: 100,
    expected: ahmedOffice.expected,
    paceGap: ahmedOffice.paceGap,
  }) + monthEndPaceEstimate({
    actual: 30,
    target: 80,
    expected: aliOffice.expected,
    paceGap: aliOffice.paceGap,
  });
  assert.equal(estimates.officeSupplies.estimate, officeEstimate);
  assert.notEqual(
    estimates.officeSupplies.estimate,
    estimateFromPaceGap(180, buildPerformanceKpi("officeSupplies", {
      actual: 70,
      target: 180,
      reportDate: "2026-10-01",
      todayIso: "2026-10-10",
    }).paceGap),
  );
  assert.equal(estimates.officeSupplies.target, 180);
  assert.equal(
    estimates.officeSupplies.achievement,
    achievementPercent(officeEstimate, 180),
  );
  assert.equal(estimates.totalSales.estimate, (
    monthEndPaceEstimate({
      actual: 50,
      target: 190,
      expected: buildPerformanceKpi("totalSales", {
        actual: 50,
        target: 190,
        reportDate: "2026-10-01",
        todayIso: "2026-10-10",
        paceShares: { 10: 0.5 },
      }).expected,
      paceGap: buildPerformanceKpi("totalSales", {
        actual: 50,
        target: 190,
        reportDate: "2026-10-01",
        todayIso: "2026-10-10",
        paceShares: { 10: 0.5 },
      }).paceGap,
    })
    + monthEndPaceEstimate({
      actual: 50,
      target: 120,
      expected: buildPerformanceKpi("totalSales", {
        actual: 50,
        target: 120,
        reportDate: "2026-10-01",
        todayIso: "2026-10-10",
        paceShares: { 10: 0.8 },
      }).expected,
      paceGap: buildPerformanceKpi("totalSales", {
        actual: 50,
        target: 120,
        reportDate: "2026-10-01",
        todayIso: "2026-10-10",
        paceShares: { 10: 0.8 },
      }).paceGap,
    })
  ));
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
