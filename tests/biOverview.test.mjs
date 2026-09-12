import test from "node:test";
import assert from "node:assert/strict";

import { buildBiOverviewModel, overviewKpiTone } from "../app/lib/biOverview.js";

test("overview model rolls category, contribution, salesman, and team snapshots", () => {
  const model = buildBiOverviewModel({
    growth: {
      lifetimeTotal: 1000,
      currentYtd: 400,
      priorYtd: 200,
      yoyPercent: 100,
      currentMonth: "2026-09",
      recentMonths: ["2026-08", "2026-09"],
      meta: { growingCount: 2, decliningCount: 1, warningCount: 0 },
      groups: [
        { label: "Building", lifetime: 700, sharePercent: 70, yoyPercent: 10, momPercent: 5, status: "green", monthValues: { "2026-08": 300, "2026-09": 200 } },
        { label: "Office", lifetime: 300, sharePercent: 30, yoyPercent: -8, momPercent: -4, status: "red", monthValues: { "2026-08": 100, "2026-09": 50 } },
      ],
    },
    salesman: {
      currentMonth: "2026-09",
      latestCompleteMonth: "2026-08",
      recentMonths: ["2026-07", "2026-08", "2026-09"],
      groups: [
        { label: "Ali · ALI", lifetime: 250, monthValues: { "2026-07": 100, "2026-08": 150 } },
      ],
      teamGroups: [
        { label: "Team — JUNAID", lifetime: 250, monthValues: { "2026-07": 100, "2026-08": 150 } },
      ],
    },
  });

  assert.equal(model.categoryCount, 2);
  assert.equal(model.topCategories[0].label, "Building");
  assert.equal(model.contributionRows[0].contributionValues["2026-08"], 75);
  assert.equal(model.salesmanSummary.salesmanCount, 1);
  assert.equal(model.teams[0].label, "Team — JUNAID");
  assert.equal(overviewKpiTone(100), "up");
  assert.equal(overviewKpiTone(-8), "down");
});
