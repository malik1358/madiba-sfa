import test from "node:test";
import assert from "node:assert/strict";

import { buildPromoterCoverageReport, promoterCoverageSalesmanMatches } from "../app/lib/promoterCoverage.js";

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

test("salesman identity matching ignores case and repeated whitespace", () => {
  assert.equal(promoterCoverageSalesmanMatches(" sm001 ", ["SM001"]), true);
  assert.equal(promoterCoverageSalesmanMatches("Team   Sales", ["team sales"]), true);
  assert.equal(promoterCoverageSalesmanMatches("SM002", ["SM001"]), false);
});

test("coverage includes unvisited team customers and separates repeat visits", () => {
  const report = buildPromoterCoverageReport({
    customers: [
      { customer_code: "A1", customer_name: "Visited once" },
      { customer_code: "A2", customer_name: "Not visited" },
      { customer_code: "A3", customer_name: "Visited twice" },
    ],
    visits: [
      { customerCode: "A1", savedAt: "2026-06-01T10:00:00Z", outcome: "NO_ORDER" },
      { customerCode: "a1", savedAt: "2026-06-01T10:01:00Z", outcome: "NO_ORDER" },
      { customerCode: "A3", savedAt: "2026-05-01T10:00:00Z", outcome: "NO_ORDER" },
      { customerCode: "A3", savedAt: "2026-06-01T10:00:00Z", outcome: "ORDER" },
    ],
    monthKeys: months,
  });

  assert.equal(report.customerCount, 3);
  assert.equal(report.visitedCustomerCount, 2);
  assert.equal(report.notVisitedCustomerCount, 1);
  assert.equal(report.repeatedCustomerCount, 1);
  assert.equal(report.rows.find((row) => row.customerCode === "A1").visitCount, 1);
  assert.equal(report.rows.find((row) => row.customerCode === "A2").visitStatus, "not_visited");
  assert.equal(report.rows.find((row) => row.customerCode === "A3").visitStatus, "repeated");
});

test("customer sales trend compares last three completed months with prior three", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "C1", customer_name: "Growing" }],
    salesRows: [
      ...months.slice(0, 3).map((transaction_date) => ({ customer_code: "C1", transaction_date: `${transaction_date}-15`, sales_amount: 100 })),
      ...months.slice(3).map((transaction_date) => ({ customer_code: "C1", transaction_date: `${transaction_date}-15`, sales_amount: 200 })),
    ],
    monthKeys: months,
  });

  assert.equal(report.rows[0].previousSales, 300);
  assert.equal(report.rows[0].recentSales, 600);
  assert.equal(report.rows[0].changePercent, 100);
  assert.equal(report.rows[0].trend, "increasing");
  assert.equal(report.increasingCustomerCount, 1);
});

test("trend treats zero-base sales as new and negative sales as decreasing", () => {
  const salesRows = [
    { customer_code: "NEW", transaction_date: "2026-06-01", sales_amount: 250 },
    ...months.slice(0, 3).map((transaction_date) => ({ customer_code: "DOWN", transaction_date: `${transaction_date}-15`, sales_amount: 100 })),
    ...months.slice(3).map((transaction_date) => ({ customer_code: "DOWN", transaction_date: `${transaction_date}-15`, sales_amount: 50 })),
  ];
  const report = buildPromoterCoverageReport({ salesRows, monthKeys: months });

  assert.equal(report.rows.find((row) => row.customerCode === "NEW").trend, "new_sales");
  assert.equal(report.rows.find((row) => row.customerCode === "DOWN").trend, "decreasing");
  assert.equal(report.decreasingCustomerCount, 1);
});