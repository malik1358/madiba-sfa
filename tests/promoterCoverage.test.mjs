import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromoterCoverageReport,
  filterPromoterCoverageSalesRows,
  promoterCoverageCustomerCodeVariants,
  promoterCoverageMonthKeys,
  promoterCoverageSalesmanMatches,
} from "../app/lib/promoterCoverage.js";

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

test("month range is inclusive and rejects invalid ranges", () => {
  assert.deepEqual(promoterCoverageMonthKeys("2026-09", "2026-11"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(promoterCoverageMonthKeys("2026-12", "2027-02"), ["2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(promoterCoverageMonthKeys("2026-13", "2027-02"), []);
  assert.deepEqual(promoterCoverageMonthKeys("2026-10", "2026-09"), []);
});

test("team customer trend includes September invoice sales credited outside the team", () => {
  const salesRows = filterPromoterCoverageSalesRows([
    {
      customer_code: "1273c",
      salesman_code: "OUTSIDE_TEAM",
      transaction_date: "2026-09-29",
      sales_amount: 9141,
      item_code: "SKU-1",
    },
    {
      customer_code: "OTHER",
      salesman_code: "OUTSIDE_TEAM",
      transaction_date: "2026-09-29",
      sales_amount: 4000,
      item_code: "SKU-2",
    },
  ], ["1273C"]);
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "1273C", customer_name: "Tawfeer" }],
    salesRows,
    monthKeys: ["2026-09"],
  });

  assert.equal(report.rows[0].monthSales["2026-09"], 9141);
  assert.equal(report.rows[0].monthSkuCount["2026-09"], 1);
});

test("credit notes reduce sales without adding a sold SKU", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "C1" }],
    salesRows: [
      { customer_code: "C1", transaction_date: "2026-09-01", sales_amount: 500, item_code: "A" },
      { customer_code: "C1", transaction_date: "2026-09-15", sales_amount: -100, net_sales_amount: -100, item_code: "B", is_credit_note: true },
    ],
    monthKeys: ["2026-09"],
  });

  assert.equal(report.rows[0].monthSales["2026-09"], 400);
  assert.equal(report.rows[0].monthSkuCount["2026-09"], 1);
});

test("aggregate trend follows the latest completed month and excludes current/future months", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "C1" }],
    salesRows: [
      { customer_code: "C1", transaction_date: "2026-08-10", sales_amount: 800, item_code: "A" },
      { customer_code: "C1", transaction_date: "2026-08-15", sales_amount: 200, item_code: "B" },
      { customer_code: "C1", transaction_date: "2026-09-10", sales_amount: 200, item_code: "C" },
      { customer_code: "C1", transaction_date: "2026-10-01", sales_amount: 10000, item_code: "D" },
    ],
    monthKeys: ["2026-08", "2026-09", "2026-10", "2026-11"],
    currentMonth: "2026-10",
  });

  assert.equal(report.rows[0].monthSalesChange["2026-09"].trend, "decreasing");
  assert.equal(report.rows[0].monthSkuChange["2026-09"].trend, "decreasing");
  assert.equal(report.rows[0].monthSalesChange["2026-10"], null);
  assert.equal(report.rows[0].monthSkuChange["2026-11"], null);
  assert.equal(report.rows[0].trend, "decreasing");
  assert.equal(report.rows[0].changePercent, -80);
  assert.equal(report.rows[0].skuTrend, "decreasing");
  assert.equal(report.rows[0].skuChangePercent, -50);
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

test("customer sales trend compares the latest two completed months", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "C1", customer_name: "Growing" }],
    salesRows: [
      ...months.slice(0, 3).map((transaction_date) => ({ customer_code: "C1", transaction_date: `${transaction_date}-15`, sales_amount: 100 })),
      ...months.slice(3, 5).map((transaction_date) => ({ customer_code: "C1", transaction_date: `${transaction_date}-15`, sales_amount: 200 })),
      { customer_code: "C1", transaction_date: "2026-06-15", sales_amount: 300 },
    ],
    monthKeys: months,
  });

  assert.equal(report.rows[0].previousSales, 200);
  assert.equal(report.rows[0].recentSales, 300);
  assert.equal(report.rows[0].changePercent, 50);
  assert.equal(report.rows[0].trend, "increasing");
  assert.equal(report.increasingCustomerCount, 1);
});

test("trend treats zero-base sales as new and negative sales as decreasing", () => {
  const salesRows = [
    { customer_code: "NEW", transaction_date: "2026-06-01", sales_amount: 250 },
    ...months.slice(0, 3).map((transaction_date) => ({ customer_code: "DOWN", transaction_date: `${transaction_date}-15`, sales_amount: 100 })),
    ...months.slice(3, 5).map((transaction_date) => ({ customer_code: "DOWN", transaction_date: `${transaction_date}-15`, sales_amount: 50 })),
    { customer_code: "DOWN", transaction_date: "2026-06-15", sales_amount: 25 },
  ];
  const report = buildPromoterCoverageReport({ salesRows, monthKeys: months });

  assert.equal(report.rows.find((row) => row.customerCode === "NEW").trend, "new_sales");
  assert.equal(report.rows.find((row) => row.customerCode === "DOWN").trend, "decreasing");
  assert.equal(report.decreasingCustomerCount, 1);
});

test("team salesman matching ignores imported casing and repeated spaces", () => {
  assert.equal(promoterCoverageSalesmanMatches(" team   seller ", ["TEAM SELLER"]), true);
  assert.equal(promoterCoverageSalesmanMatches("OTHER", ["TEAM SELLER"]), false);
});

test("team customer 1553 matches active-sales account-code variants", () => {
  const variants = promoterCoverageCustomerCodeVariants("1553");
  assert.ok(variants.includes("1553C"));
  assert.ok(variants.includes("01553C"));

  const salesRows = filterPromoterCoverageSalesRows([
    { customer_code: "01553C", transaction_date: "2026-09-23", sales_amount: 500, item_code: "SKU-1553" },
    { customer_code: "OTHER", transaction_date: "2026-09-23", sales_amount: 900, item_code: "SKU-OTHER" },
  ], ["1553"]);
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "1553", customer_name: "Ahla Al Tawfeer Company" }],
    salesRows,
    monthKeys: ["2026-09"],
  });

  assert.equal(report.rows[0].monthSales["2026-09"], 500);
  assert.equal(report.rows[0].monthSkuCount["2026-09"], 1);
});

test("aggregate trend uses the latest two completed months in a short selected range", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "SHORT", customer_name: "Short range" }],
    salesRows: [
      { customer_code: "SHORT", transaction_date: "2026-07-10", sales_amount: 100, item_code: "A" },
      { customer_code: "SHORT", transaction_date: "2026-08-10", sales_amount: 200, item_code: "A" },
      { customer_code: "SHORT", transaction_date: "2026-09-10", sales_amount: 600, item_code: "B" },
      { customer_code: "SHORT", transaction_date: "2026-09-15", sales_amount: 100, item_code: "C" },
      { customer_code: "SHORT", transaction_date: "2026-10-10", sales_amount: 10000, item_code: "C" },
    ],
    monthKeys: ["2026-07", "2026-08", "2026-09", "2026-10"],
    currentMonth: "2026-10",
  });

  assert.equal(report.rows[0].trend, "increasing");
  assert.equal(report.rows[0].changePercent, 250);
  assert.equal(report.rows[0].skuTrend, "increasing");
  assert.equal(report.rows[0].skuChangePercent, 100);
});

test("aggregate trend uses the latest pair even in a longer selected range", () => {
  const report = buildPromoterCoverageReport({
    customers: [{ customer_code: "ODD" }],
    salesRows: [
      { customer_code: "ODD", transaction_date: "2026-06-01", sales_amount: 100 },
      { customer_code: "ODD", transaction_date: "2026-07-01", sales_amount: 100 },
      { customer_code: "ODD", transaction_date: "2026-08-01", sales_amount: 400 },
      { customer_code: "ODD", transaction_date: "2026-09-01", sales_amount: 400 },
      { customer_code: "ODD", transaction_date: "2026-10-01", sales_amount: 9999 },
    ],
    monthKeys: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    currentMonth: "2026-10",
  });

  assert.equal(report.rows[0].trend, "stable");
  assert.equal(report.rows[0].changePercent, 0);
});