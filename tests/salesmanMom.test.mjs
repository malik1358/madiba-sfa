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

test("scorecard last complete month is the month before MTD, not two months back", () => {
  const rows = buildSalesmanMomRows({
    currentMonth: "2026-09",
    latestCompleteMonth: "2026-08",
    recentMonths: ["2026-06", "2026-07", "2026-08", "2026-09"],
    groups: [{
      label: "Ali · A01",
      lifetime: 400,
      monthValues: {
        "2026-06": 100,
        "2026-07": 120,
        "2026-08": 150,
        "2026-09": 30,
      },
    }],
  });
  assert.equal(rows[0].latestCompleteMonth, "2026-08");
  assert.equal(rows[0].priorCompleteMonth, "2026-07");
  assert.equal(rows[0].latestCompleteAmount, 150);
  assert.equal(rows[0].priorMonthAmount, 120);
  assert.equal(rows[0].mtdAmount, 30);
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
  assert.equal(rows[0].latestCompleteAmount, 48);
  assert.equal(rows[0].priorMonthAmount, 80);
  assert.equal(rows[0].priorCompleteMonth, "2026-07");
  assert.equal(rows[1].trajectory.code, "improving");
  assert.equal(rows[1].improvingStreak, 2);
  assert.equal(rows[1].latestCompleteAmount, 150);
  assert.equal(rows[1].priorMonthAmount, 120);
});

test("scorecard drops placeholder and duplicated salesman names", () => {
  const rows = buildSalesmanMomRows({
    currentMonth: "2026-09",
    latestCompleteMonth: "2026-08",
    recentMonths: ["2026-08", "2026-09"],
    groups: [
      { label: "Ali · A01", lifetime: 200, momPercent: 10, monthValues: { "2026-08": 100 } },
      { label: "RAHID · RAHID", lifetime: 80, momPercent: -20, monthValues: { "2026-08": 40 } },
      { label: "NOT ADDED IN VOUCHER · NOT ADDED IN VOUCHER", lifetime: 50, momPercent: -30, monthValues: { "2026-08": 20 } },
      { label: "NOON · NOON", lifetime: 10, momPercent: 5, monthValues: { "2026-08": 10 } },
      { label: "TRENDYOL · TRENDYOL", lifetime: 12, momPercent: 8, monthValues: { "2026-08": 12 } },
    ],
  });
  assert.deepEqual(rows.map((row) => row.label), ["Ali · A01"]);
});
