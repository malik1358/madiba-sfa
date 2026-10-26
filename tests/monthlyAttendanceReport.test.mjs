import test from "node:test";
import assert from "node:assert/strict";

import {
  averageMonthlyAttendance,
  buildMonthlyAttendanceDayRow,
  buildMonthlyAttendanceReport,
  canOpenMonthlyAttendance,
  countCustomerVisits,
  isMonthlyAttendanceSubject,
  listKsaMonthDates,
  resolveMonthlyAttendanceDates,
  sumCollectionAmount,
  sumOrderAmount,
} from "../app/lib/monthlyAttendanceReport.js";

test("month dates stop on the current KSA day and reject a future month", () => {
  assert.equal(listKsaMonthDates("2026-02").length, 28);
  assert.deepEqual(
    resolveMonthlyAttendanceDates("2026-10", "2026-10-26").dates.slice(-1),
    ["2026-10-26"],
  );
  assert.equal(resolveMonthlyAttendanceDates("2026-09", "2026-10-26").dates.length, 30);
  assert.throws(
    () => resolveMonthlyAttendanceDates("2026-11", "2026-10-26"),
    /current month or an earlier month/,
  );
});

test("monthly attendance uses near-visit working hours and distinct customer visits", () => {
  const row = buildMonthlyAttendanceDayRow({
    date: "2026-09-07",
    entries: [
      { savedAt: "2026-09-07T06:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", customerCode: "C1", isFarFromCustomer: false },
      { savedAt: "2026-09-07T09:00:00.000Z", transactionType: "ORDER_SUBMITTED", customerCode: "C1", orderId: 11, orderValue: 400, isFarFromCustomer: false },
      { savedAt: "2026-09-07T10:47:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-09-07T12:14:00.000Z", transactionType: "LUNCH_BREAK_IN" },
      { savedAt: "2026-09-07T13:00:00.000Z", transactionType: "VISIT_REPORT", customerCode: "C2", isFarFromCustomer: false },
      { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "COLLECTION_VISIT", customerCode: "C3", amountReceived: 1500, isFarFromCustomer: false },
      { savedAt: "2026-09-07T15:40:00.000Z", transactionType: "ORDER_SUBMITTED", customerCode: "C4", orderId: 12, orderValue: 250, isFarFromCustomer: true },
      { savedAt: "2026-09-07T16:10:00.000Z", transactionType: "END_OF_DAY" },
    ],
  });

  assert.equal(row.attended, true);
  assert.equal(row.workingHoursMinutes, 206);
  assert.equal(row.workingHoursLabel, "3h 26m");
  assert.equal(row.customerVisits, 4);
  assert.equal(row.collectionAmount, 1500);
  assert.equal(row.orderAmount, 650);
});

test("long unlogged gaps are removed and duplicate money is counted once", () => {
  const row = buildMonthlyAttendanceDayRow({
    date: "2026-09-07",
    entries: [
      { id: "a", savedAt: "2026-09-07T06:40:00.000Z", transactionType: "VISIT_REPORT", customerCode: "A1", isFarFromCustomer: false },
      { id: "b", savedAt: "2026-09-07T08:43:00.000Z", transactionType: "ORDER_SUBMITTED", customerCode: "A2", orderId: 9, orderValue: 500, isFarFromCustomer: false },
      { id: "b2", savedAt: "2026-09-07T08:44:00.000Z", transactionType: "ORDER_SUBMITTED", customerCode: "A2", orderId: 9, orderValue: 500, isFarFromCustomer: false },
      { id: "c", savedAt: "2026-09-07T14:18:00.000Z", transactionType: "COLLECTION_VISIT", customerCode: "A3", amountReceived: 100, isFarFromCustomer: false },
      { id: "c2", savedAt: "2026-09-07T14:19:00.000Z", transactionType: "COLLECTION_VISIT", customerCode: "A3", amountReceived: 100, isFarFromCustomer: false },
      { id: "d", savedAt: "2026-09-07T15:46:00.000Z", transactionType: "VISIT_REPORT", customerCode: "A3", isFarFromCustomer: false },
    ],
  });

  assert.equal(row.workingHoursMinutes, 89);
  assert.equal(row.workingHoursLabel, "1h 29m");
  assert.equal(row.customerVisits, 3);
  assert.equal(row.collectionAmount, 100);
  assert.equal(row.orderAmount, 500);
  assert.equal(row.attended, false);
});

test("a month report keeps empty days and totals the columns", () => {
  const report = buildMonthlyAttendanceReport({
    month: "2026-10",
    dates: ["2026-10-01", "2026-10-02"],
    entriesByDate: {
      "2026-10-02": [
        { savedAt: "2026-10-02T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
        { savedAt: "2026-10-02T06:00:00.000Z", transactionType: "VISIT_REPORT", customerCode: "C9", isFarFromCustomer: false },
        { savedAt: "2026-10-02T08:00:00.000Z", transactionType: "COLLECTION_VISIT", customerCode: "C9", amountReceived: 25.5, isFarFromCustomer: false },
      ],
    },
  });

  assert.equal(report.rows[0].workingHoursMinutes, 0);
  assert.equal(report.rows[0].customerVisits, 0);
  assert.equal(report.rows[1].customerVisits, 1);
  assert.equal(report.rows[1].collectionAmount, 25.5);
  assert.equal(report.rows[1].workingHoursMinutes, 120);
  assert.equal(report.totals.dayCount, 2);
  assert.equal(report.totals.attendedDays, 1);
  assert.equal(report.totals.totalCustomerVisits, 1);
  assert.equal(report.totals.totalCollectionAmount, 25.5);
  assert.equal(report.totals.totalWorkingMinutes, 120);
});

test("login without customer stops is zero working hours", () => {
  const row = buildMonthlyAttendanceDayRow({
    date: "2026-10-03",
    entries: [
      { savedAt: "2026-10-03T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-10-03T15:00:00.000Z", transactionType: "END_OF_DAY" },
    ],
  });
  assert.equal(row.attended, true);
  assert.equal(row.workingHoursMinutes, 0);
  assert.equal(row.customerVisits, 0);
  assert.equal(countCustomerVisits([]), 0);
  assert.equal(sumCollectionAmount([]), 0);
  assert.equal(sumOrderAmount([]), 0);
});

test("average is the total divided by every listed day, including zeros", () => {
  assert.deepEqual(averageMonthlyAttendance({
    minutes: 130,
    visits: 5,
    collection: 100,
    orders: 50,
  }, 2), {
    workingMinutes: 65,
    customerVisits: 2.5,
    collectionAmount: 50,
    orderAmount: 25,
  });
  assert.deepEqual(averageMonthlyAttendance({ minutes: 10 }, 0), {
    workingMinutes: 0,
    customerVisits: 0,
    collectionAmount: 0,
    orderAmount: 0,
  });
});

test("salesmen and collectors can open monthly attendance; promoters cannot", () => {
  assert.equal(canOpenMonthlyAttendance({ role: "salesman", salesman_code: "PARVEZ" }), true);
  assert.equal(canOpenMonthlyAttendance({ role: "collector", salesman_code: "CL01" }), true);
  assert.equal(canOpenMonthlyAttendance({ role: "salesman", salesman_code: "CL02" }), true);
  assert.equal(canOpenMonthlyAttendance({ role: "manager" }), true);
  assert.equal(canOpenMonthlyAttendance({ role: "invoice-maker" }), true);
  assert.equal(canOpenMonthlyAttendance({ role: "product-promoter" }), false);
  assert.equal(isMonthlyAttendanceSubject({ role: "salesman", salesman_code: "PARVEZ" }), true);
  assert.equal(isMonthlyAttendanceSubject({ role: "collector", salesman_code: "CL01" }), true);
  assert.equal(isMonthlyAttendanceSubject({ role: "manager" }), false);
  assert.equal(isMonthlyAttendanceSubject({ role: "product-promoter" }), false);
});
