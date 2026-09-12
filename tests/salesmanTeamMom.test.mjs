import test from "node:test";
import assert from "node:assert/strict";

import { buildSalesmanScopeMatchers } from "../app/lib/mutualSalesmanGroups.js";
import {
  assignSalesmanRowToTeam,
  buildTeamDirectoryMembers,
  buildTeamMomRows,
  ECOM_SALES_LABEL,
  resolveTeamBucket,
  rollupTeamGrowthFromRows,
  rollupTeamGrowthGroups,
  STORE_SALES_LABEL,
  teamMomLabel,
} from "../app/lib/salesmanTeamMom.js";

test("mapped inactive salesmen stay on their team instead of No team", () => {
  const members = buildTeamDirectoryMembers([
    { id: "p1", salesman_code: "ZIA", salesman_name: "Zia", is_active: false },
    { id: "p2", salesman_code: "ALI", salesman_name: "Ali", is_active: true },
  ], () => ({
    teamKey: "ahmed",
    teamLeaderUserId: "ahmed",
    teamLeaderCode: "AHMED NABIL",
    teamLeaderName: "AHMED NABIL",
  }));

  const groups = rollupTeamGrowthGroups(
    [
      { label: "Zia · ZIA", lifetime: 40, monthValues: { "2026-08": 40 } },
      { label: "Ali · ALI", lifetime: 100, monthValues: { "2026-08": 100 } },
    ],
    members,
    { latestCompleteMonth: "2026-08" },
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Team — AHMED NABIL");
  assert.equal(groups[0].memberCount, 2);
  assert.equal(groups[0].monthValues["2026-08"], 140);
});

test("people without a boss stay as their own team row", () => {
  const groups = rollupTeamGrowthGroups(
    [
      { label: "Zia · ZIA", lifetime: 40, monthValues: { "2026-08": 40 } },
      { label: "Ali · ALI", lifetime: 100, monthValues: { "2026-08": 100 } },
    ],
    [],
    { latestCompleteMonth: "2026-08" },
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((row) => row.label).sort(), ["Ali · ALI", "Zia · ZIA"]);
  assert.equal(groups.some((row) => row.label === "No team"), false);
});

test("TRENDYOL and NOON roll into Ecom sales and store vouchers roll into Store sales", () => {
  assert.equal(resolveTeamBucket({ label: "TRENDYOL · TRENDYOL" }).teamLabel, ECOM_SALES_LABEL);
  assert.equal(resolveTeamBucket({ label: "NOON" }).teamLabel, ECOM_SALES_LABEL);
  assert.equal(resolveTeamBucket({
    salesman_name: "Ali",
    salesman_code: "ALI",
    voucher_type: "RIYADH STORE SALES",
  }).teamLabel, STORE_SALES_LABEL);

  const groups = rollupTeamGrowthFromRows(
    [
      { transaction_date: "2026-08-04", salesman_name: "TRENDYOL", salesman_code: "TRENDYOL", sales_amount: 80 },
      { transaction_date: "2026-08-08", salesman_name: "NOON", salesman_code: "NOON", sales_amount: 20 },
      { transaction_date: "2026-08-10", salesman_name: "Ali", salesman_code: "ALI", voucher_type: "RIYADH STORE SALES", sales_amount: 50 },
      { transaction_date: "2026-08-12", salesman_name: "Ali", salesman_code: "ALI", voucher_type: "SALES", sales_amount: 30 },
    ],
    [],
    { asOfDate: "2026-09-01", measure: "sales" },
  );
  const byLabel = Object.fromEntries(groups.map((row) => [row.label, row.lifetime]));
  assert.equal(byLabel[ECOM_SALES_LABEL], 100);
  assert.equal(byLabel[STORE_SALES_LABEL], 50);
  assert.equal(byLabel["Ali · ALI"], 30);
});

test("team labels use the first-level leader name", () => {
  assert.equal(teamMomLabel({
    teamLeaderName: "Junaid",
    teamLeaderCode: "JUNAID",
  }), "Team — Junaid");
});

test("sales rows match a team member by code or name", () => {
  const members = [{
    teamKey: "leader-1",
    teamLabel: "Team — Junaid",
    matchers: buildSalesmanScopeMatchers([{ salesman_code: "PARVEZ", salesman_name: "Parvez" }]),
  }];
  assert.equal(assignSalesmanRowToTeam({ label: "Parvez · PARVEZ" }, members).teamKey, "leader-1");
  assert.equal(assignSalesmanRowToTeam({ label: "Ali · A01" }, members), null);
});

test("team MoM rolls salesman months together and keeps the same trajectory rules", () => {
  const members = buildTeamDirectoryMembers([
    { id: "p1", salesman_code: "ALI", salesman_name: "Ali" },
    { id: "p2", salesman_code: "OMAR", salesman_name: "Omar" },
  ], (profile) => ({
    teamKey: "leader-1",
    teamLeaderUserId: "leader-1",
    teamLeaderCode: "JUNAID",
    teamLeaderName: "Junaid",
  }));

  const groups = rollupTeamGrowthGroups(
    [
      {
        label: "Ali · ALI",
        lifetime: 250,
        monthValues: { "2026-07": 100, "2026-08": 150 },
        quarterValues: { "2026-Q3": 250 },
      },
      {
        label: "Omar · OMAR",
        lifetime: 130,
        monthValues: { "2026-07": 80, "2026-08": 50 },
        quarterValues: { "2026-Q3": 130 },
      },
      {
        label: "RAHID · RAHID",
        lifetime: 40,
        monthValues: { "2026-08": 40 },
      },
    ],
    members,
    { latestCompleteMonth: "2026-08" },
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Team — Junaid");
  assert.equal(groups[0].memberCount, 2);
  assert.equal(groups[0].monthValues["2026-07"], 180);
  assert.equal(groups[0].monthValues["2026-08"], 200);
  assert.equal(Math.round(groups[0].momPercent * 10) / 10, 11.1);

  const rows = buildTeamMomRows({
    currentMonth: "2026-09",
    latestCompleteMonth: "2026-08",
    recentMonths: ["2026-07", "2026-08", "2026-09"],
    teamGroups: groups,
  });
  assert.equal(rows[0].trajectory.status, "green");
  assert.equal(rows[0].latestCompleteAmount, 200);
});
