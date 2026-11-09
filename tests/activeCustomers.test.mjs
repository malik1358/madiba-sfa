import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CUSTOMERS_WINDOW_DAYS,
  buildActiveCustomersReport,
  countActiveInDateWindow,
  monthEndDateKey,
  purchaseCountsTowardActive,
  resolveMonthAsOfDate,
  rollingWindowBounds,
  shiftDateKey,
} from "../app/lib/activeCustomers.js";

test("rolling window is 120 inclusive days ending at as-of", () => {
  assert.equal(ACTIVE_CUSTOMERS_WINDOW_DAYS, 120);
  assert.equal(monthEndDateKey("2026-10"), "2026-10-31");
  assert.deepEqual(rollingWindowBounds("2026-10-31"), {
    start: "2026-07-04",
    end: "2026-10-31",
  });
  assert.equal(shiftDateKey("2026-10-31", -119), "2026-07-04");
  assert.equal(resolveMonthAsOfDate("2026-10", "2026-11-09"), "2026-10-31");
  assert.equal(resolveMonthAsOfDate("2026-11", "2026-11-09"), "2026-11-09");
});

test("credit notes and non-positive amounts do not count as a purchase", () => {
  assert.equal(purchaseCountsTowardActive({
    sales_amount: 100,
    voucher_type: "Sales",
  }), true);
  assert.equal(purchaseCountsTowardActive({
    sales_amount: 100,
    voucher_type: "Credit Note",
  }), false);
  assert.equal(purchaseCountsTowardActive({
    sales_amount: -50,
    voucher_type: "Sales",
  }), false);
  assert.equal(purchaseCountsTowardActive({
    sales_amount: 0,
    voucher_type: "Sales",
  }), false);
});

test("countActiveInDateWindow keeps a customer once when they bought in the window", () => {
  const customers = new Map([
    ["A", new Set(["2026-08-05", "2026-10-01"])],
    ["B", new Set(["2026-07-01"])],
    ["C", new Set(["2026-07-10"])],
    ["D", new Set(["2026-11-01"])],
  ]);
  // Window 2026-07-04 … 2026-10-31: A and C only (B is before start; D is after end).
  assert.equal(
    countActiveInDateWindow(customers, "2026-07-04", "2026-10-31"),
    2,
  );
});

test("company count and sales use the same 120-day window ending month-end", () => {
  const rows = [
    {
      transaction_date: "2026-05-10",
      customer_code: "1001",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 200,
    },
    {
      transaction_date: "2026-08-05",
      customer_code: "1001",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 150,
    },
    {
      transaction_date: "2026-09-12",
      customer_code: "1002",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 80,
    },
    {
      transaction_date: "2026-10-01",
      customer_code: "1003",
      salesman_code: "SM02",
      salesman_name: "Omar",
      voucher_type: "Sales",
      sales_amount: 90,
    },
    {
      transaction_date: "2026-10-15",
      customer_code: "1001",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Credit Note",
      sales_amount: 40,
    },
  ];

  const report = buildActiveCustomersReport(rows, { asOfDate: "2026-10-31" });
  assert.equal(report.windowDays, 120);
  assert.equal(report.currentMonth, "2026-10");
  // Aug 31 window starts 2026-05-04 → includes May + Aug for customer 1001.
  assert.equal(report.company.monthValues["2026-08"], 1);
  assert.equal(report.company.monthSales["2026-08"], 350);
  // Sep 30 window starts 2026-06-03 → May falls out; Aug + Sep remain.
  assert.equal(report.company.monthValues["2026-09"], 2);
  assert.equal(report.company.monthSales["2026-09"], 230);
  // Oct 31 window starts 2026-07-04 → Aug/Sep/Oct activity for 3 customers.
  assert.equal(report.company.monthValues["2026-10"], 3);
  assert.equal(report.company.monthSales["2026-10"], 280);
  assert.equal(report.summary.currentActive, 3);
  assert.equal(report.summary.currentSales, 280);
  assert.equal(report.summary.change > 0, true);

  const ali = report.salesmanRows.find((row) => row.label.includes("Ali"));
  const omar = report.salesmanRows.find((row) => row.label.includes("Omar"));
  assert.ok(ali);
  assert.ok(omar);
  assert.equal(ali.monthValues["2026-10"], 2);
  assert.equal(ali.monthSales["2026-10"], 190);
  assert.equal(omar.monthValues["2026-10"], 1);
  assert.equal(omar.monthSales["2026-10"], 90);
});

test("team view unions distinct customers across members", () => {
  const rows = [
    {
      transaction_date: "2026-09-01",
      customer_code: "2001",
      salesman_code: "SM10",
      salesman_name: "Nabil",
      voucher_type: "Sales",
      sales_amount: 50,
    },
    {
      transaction_date: "2026-09-20",
      customer_code: "2002",
      salesman_code: "SM11",
      salesman_name: "Sami",
      voucher_type: "Sales",
      sales_amount: 60,
    },
    {
      transaction_date: "2026-10-05",
      customer_code: "2001",
      salesman_code: "SM11",
      salesman_name: "Sami",
      voucher_type: "Sales",
      sales_amount: 70,
    },
  ];
  const teamMembers = [
    {
      id: "u1",
      salesmanCode: "SM10",
      salesmanName: "Nabil",
      teamKey: "leader-1",
      teamLeaderUserId: "leader-1",
      teamLeaderCode: "SM10",
      teamLeaderName: "Nabil",
      teamLabel: "Team — Nabil · SM10",
      matchers: {
        codes: new Set(["SM10"]),
        comparableNames: new Set(["NABIL"]),
      },
    },
    {
      id: "u2",
      salesmanCode: "SM11",
      salesmanName: "Sami",
      teamKey: "leader-1",
      teamLeaderUserId: "leader-1",
      teamLeaderCode: "SM10",
      teamLeaderName: "Nabil",
      teamLabel: "Team — Nabil · SM10",
      matchers: {
        codes: new Set(["SM11"]),
        comparableNames: new Set(["SAMI"]),
      },
    },
  ];

  const report = buildActiveCustomersReport(rows, {
    asOfDate: "2026-10-31",
    teamMembers,
  });
  const team = report.teamRows.find((row) => row.key === "leader-1");
  assert.ok(team);
  assert.equal(team.monthValues["2026-10"], 2);
  // Sep window still includes both Sep sales; Oct window includes Sep + Oct.
  assert.equal(team.monthSales["2026-09"], 110);
  assert.equal(team.monthSales["2026-10"], 180);
});
