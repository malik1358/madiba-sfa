import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailyWorkingHoursRow,
  buildDailyWorkingHoursRows,
  summarizeDailyWorkingHours,
} from "../app/lib/dailyWorkingHoursReport.js";

test("buildDailyWorkingHoursRow uses near-visit lunch segments for hours", () => {
  const row = buildDailyWorkingHoursRow({
    userId: "u1",
    userName: "OSAMA (OSAMA)",
    salesmanCode: "OSAMA",
    role: "salesman",
    entries: [
      { savedAt: "2026-09-07T06:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T09:00:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
      { savedAt: "2026-09-07T10:47:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-09-07T12:14:00.000Z", transactionType: "LUNCH_BREAK_IN" },
      { savedAt: "2026-09-07T13:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "COLLECTION_VISIT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T15:40:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: true },
      { savedAt: "2026-09-07T16:10:00.000Z", transactionType: "END_OF_DAY", logoutAutoClosed: true },
    ],
  });

  assert.equal(row.workingHoursMinutes, 206);
  assert.equal(row.workingHoursLabel, "3h 26m");
  assert.equal(row.nearStopCount, 4);
  assert.equal(row.farStopCount, 1);
  assert.equal(row.visitReports, 2);
  assert.equal(row.ordersSubmitted, 2);
  assert.equal(row.collections, 1);
  assert.equal(row.logoutAutoClosed, true);
  assert.ok(row.loginAt);
  assert.ok(row.lunchOutAt);
  assert.ok(row.lunchInAt);
  assert.ok(row.logoutAt);
});

test("buildDailyWorkingHoursRows sorts by name and summarize totals", () => {
  const rows = buildDailyWorkingHoursRows([
    {
      userId: "b",
      userName: "Belal",
      entries: [
        { savedAt: "2026-09-07T07:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
        { savedAt: "2026-09-07T16:00:00.000Z", transactionType: "END_OF_DAY" },
      ],
    },
    {
      userId: "a",
      userName: "Ahmed",
      entries: [
        { savedAt: "2026-09-07T08:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
        { savedAt: "2026-09-07T11:00:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
      ],
    },
  ]);

  assert.equal(rows[0].userName, "Ahmed");
  assert.equal(rows[1].userName, "Belal");
  assert.equal(rows[0].workingHoursLabel, "3h");

  const totals = summarizeDailyWorkingHours(rows);
  assert.equal(totals.userCount, 2);
  assert.equal(totals.loggedInCount, 1);
  assert.equal(totals.withHoursCount, 2);
  assert.equal(totals.totalWorkingMinutes, 3 * 60 + 9 * 60);
});
