import test from "node:test";
import assert from "node:assert/strict";

import {
  averageMomPercent,
  buildSalesmanMomRows,
  classifySalesmanMom,
  monthOverMonthSeries,
  trailingToneStreak,
} from "../app/lib/salesmanMom.js";

test("month-on-month series skips the current partial month", () => {
  const series = monthOverMonthSeries(
    { "2026-06": 100, "2026-07": 120, "2026-08": 90, "2026-09": 40 },
    ["2026-06", "2026-07", "2026-08", "2026-09"],
    "2026-09",
  );

  assert.equal(series.length, 3);
  assert.equal(series[1].tone, "up");
  assert.equal(series[2].tone, "down");
  assert.equal(series[2].percent, -25);
});

test("improving and not-improving trajectories follow streaks and latest month", () => {
  assert.equal(trailingToneStreak([
    { tone: "up" },
    { tone: "up" },
    { tone: "down" },
    { tone: "down" },
    { tone: "down" },
  ], "down"), 3);
  assert.equal(averageMomPercent([{ percent: 10 }, { percent: -10 }]), 0);
  assert.equal(classifySalesmanMom({ comparedMonths: 1 }).code, "new");
  assert.equal(classifySalesmanMom({ comparedMonths: 6, decliningStreak: 3, momPercent: -4 }).code, "not_improving");
  assert.equal(classifySalesmanMom({ comparedMonths: 6, improvingStreak: 2, momPercent: 3 }).code, "improving");
  assert.equal(classifySalesmanMom({ comparedMonths: 6, momPercent: 8, upMonths: 3 }).code, "improving");
  assert.equal(classifySalesmanMom({ comparedMonths: 6, momPercent: -6, improvingStreak: 0, decliningStreak: 1 }).code, "slipping");
});

test("salesman scorecard ranks people who are not improving first", () => {
  const rows = buildSalesmanMomRows({
    currentMonth: "2026-09",
    latestCompleteMonth: "2026-08",
    recentMonths: ["2026-06", "2026-07", "2026-08", "2026-09"],
    groups: [
      {
        label: "Ali",
        lifetime: 400,
        momPercent: 20,
        monthValues: { "2026-06": 100, "2026-07": 120, "2026-08": 150, "2026-09": 30 },
      },
      {
        label: "Omar",
        lifetime: 300,
        momPercent: -40,
        monthValues: { "2026-06": 100, "2026-07": 80, "2026-08": 48, "2026-09": 10 },
      },
    ],
  });

  assert.equal(rows[0].label, "Omar");
  assert.equal(rows[0].trajectory.code, "not_improving");
  assert.equal(rows[0].decliningStreak, 2);
  assert.equal(rows[1].trajectory.code, "improving");
  assert.equal(rows[1].improvingStreak, 2);
});
