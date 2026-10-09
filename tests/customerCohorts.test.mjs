import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerCohortReport, customerCohortPeriodSummary, formatCustomerCohortCell } from "../app/lib/customerCohorts.js";
import { loadCategoryGrowthReport } from "../app/lib/categoryGrowthServer.js";

const sale = (code, date, extra = {}) => ({ customer_code: code, transaction_date: date, sales_amount: 100, ...extra });

test("retention display always includes the customer count", () => {
  assert.equal(formatCustomerCohortCell(70, 100, "retention"), "70 (70.0%)");
  assert.equal(formatCustomerCohortCell(0, 100, "retention"), "0 (0.0%)");
  assert.equal(formatCustomerCohortCell(110, 140, "retention"), "110 (78.6%)");
  assert.equal(formatCustomerCohortCell(null, 100, "retention"), "-");
  assert.equal(formatCustomerCohortCell(12, 12, "retention", { isNew: true }), "12 (New)");
  assert.equal(formatCustomerCohortCell(0, 0, "retention"), "0 (N/A)");
  assert.equal(formatCustomerCohortCell(70, 100), "70");
});

test("retention footer excludes customers acquired in the current period", () => {
  const cohorts = [
    { quarter: "2025-Q3", customerCount: 100, counts: { "2025-Q3": 100, "2025-Q4": 70, "2026-Q1": 50 } },
    { quarter: "2025-Q4", customerCount: 40, counts: { "2025-Q3": null, "2025-Q4": 40, "2026-Q1": 20 } },
    { quarter: "2026-Q1", customerCount: 30, counts: { "2025-Q3": null, "2025-Q4": null, "2026-Q1": 30 } },
  ];
  assert.deepEqual(customerCohortPeriodSummary(cohorts, "2025-Q3"), { retained: 0, retainedEligible: 0, new: 100, total: 100 });
  assert.deepEqual(customerCohortPeriodSummary(cohorts, "2026-Q1"), { retained: 70, retainedEligible: 140, new: 30, total: 100 });
  assert.deepEqual(customerCohortPeriodSummary(cohorts, "2025-Q4"), { retained: 70, retainedEligible: 100, new: 40, total: 110 });
});

test("first invoice cohorts count distinct customers per purchase quarter, including gaps and returns", () => {
  const report = buildCustomerCohortReport([
    sale(" a ", "2025-07-01"), sale("A", "2025-07-02"), sale("A", "2026-01-10"),
    sale("B", "2025-08-01"), sale("B", "2025-11-01"),
    sale("C", "2025-10-01"), sale("C", "2026-01-01", { voucher_type: "Credit Note" }),
    sale("D", "2025-06-01", { sales_amount: -100 }), sale("D", "2026-01-01"),
    sale("E", "2026-04-01"), sale("", "2025-01-01"),
  ].reverse(), { asOfDate: "2026-03-15" });
  assert.deepEqual(report.quarters, ["2025-Q3", "2025-Q4", "2026-Q1"]);
  assert.deepEqual(report.rows[0], {
    quarter: "2025-Q3",
    customerCount: 2,
    counts: { "2025-Q3": 2, "2025-Q4": 1, "2026-Q1": 1 },
    salesValues: { "2025-Q3": 300, "2025-Q4": 100, "2026-Q1": 100 },
  });
  assert.deepEqual(report.rows[1].counts, { "2025-Q3": null, "2025-Q4": 1, "2026-Q1": 0 });
  assert.equal(report.customerCount, 4);
  assert.deepEqual(report.totals, { "2025-Q3": 2, "2025-Q4": 2, "2026-Q1": 2 });
});

test("date and product filters never reset the first invoice quarter or drop inactive cohort members", () => {
  const report = buildCustomerCohortReport([
    sale("A", "2025-07-01", { category: "Old" }),
    sale("A", "2025-10-01", { category: "New" }),
    sale("A", "2026-01-01", { category: "New" }),
    sale("B", "2025-07-01", { category: "New" }),
  ], { asOfDate: "2026-03-15", filters: { dateFrom: "2026-01-01", values: { category: ["New"] } } });
  assert.deepEqual(report.quarters, ["2026-Q1"]);
  assert.equal(report.rows[0].quarter, "2025-Q3");
  assert.equal(report.rows[0].customerCount, 2);
  assert.equal(report.rows[0].counts["2026-Q1"], 1);
});

test("prepared cube purchase measures retain activity even when signed sales net to zero", () => {
  const report = buildCustomerCohortReport([
    sale("A", "2025-07-01", { sales_amount: 0, cash_sales_amount: 100, credit_sales_amount: 0 }),
    sale("B", "2025-07-01", { cash_sales_amount: 0, credit_sales_amount: 0 }),
  ], { asOfDate: "2025-09-30" });
  assert.equal(report.customerCount, 1);
  assert.equal(report.rows[0].counts["2025-Q3"], 1);
  assert.deepEqual(buildCustomerCohortReport([], { asOfDate: "2026-03-15" }).rows, []);
});

test("protected report loader attaches cohorts from live sales with full history and missing-profit fallback", async () => {
  const selections = [];
  const sales = [sale("A", "2025-07-01", { voucher_number: "R1" }), sale("A", "2026-01-01", { voucher_number: "R2" }), sale("B", "2025-07-01", { voucher_number: "R1" })];
  const admin = {
    from(table) {
      let select = "";
      const query = {
        select(value) { select = value; if (table === "active_sales") selections.push(value); return query; },
        order() { return query; },
        range() { return query; },
        then(resolve) {
          return Promise.resolve(table === "active_sales"
            ? select.includes("profit_amount")
              ? { data: null, error: { code: "42703", message: "column profit_amount does not exist" } }
              : { data: sales, error: null }
            : { data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const report = await loadCategoryGrowthReport(admin, { asOfDate: "2026-03-15", filters: { groupBy: "customer", dateFrom: "2026-01-01", values: { voucher_number: ["R2"] } } });
  assert.equal(report.meta.source, "active_sales");
  assert.equal(selections.length, 2);
  assert.ok(selections.every((select) => select.includes("customer_code") && select.includes("voucher_number")));
  assert.equal(report.customerCohorts.rows[0].quarter, "2025-Q3");
  assert.equal(report.customerCohorts.rows[0].counts["2026-Q1"], 1);
  assert.equal(report.customerMonthlyCohorts.rows[0].quarter, "2025-07");
  assert.equal(report.customerMonthlyCohorts.rows[0].counts["2026-01"], 1);
  assert.equal(report.customerBimonthlyCohorts.rows[0].quarter, "2025-B4");
  assert.equal(report.customerBimonthlyCohorts.rows[0].counts["2026-B1"], 1);
});

test("partial-quarter date filters count the full displayed acquisition quarter", () => {
  const report = buildCustomerCohortReport([
    sale("A", "2025-04-02"), sale("B", "2025-05-02"), sale("A", "2026-01-02"),
  ], { filters: { dateFrom: "2025-06-15", dateTo: "2026-01-15" }, asOfDate: "2026-02-01" });
  assert.equal(report.rows[0].customerCount, 2);
  assert.equal(report.rows[0].counts["2025-Q2"], 2);
  assert.equal(report.rows[0].counts["2026-Q1"], 1);
});

test("monthly cohorts deduplicate buyers and keep acquisition months before date filtering", () => {
  const report = buildCustomerCohortReport([
    sale("A", "2025-07-02"), sale("A", "2025-07-03"), sale("A", "2025-09-02"),
    sale("B", "2025-08-02"), sale("B", "2025-09-02", { voucher_type: "Credit Note" }),
  ], { period: "month", filters: { dateFrom: "2025-07-15", dateTo: "2025-09-15" }, asOfDate: "2025-09-20" });
  assert.deepEqual(report.quarters, ["2025-07", "2025-08", "2025-09"]);
  assert.deepEqual(report.rows[0], {
    quarter: "2025-07",
    customerCount: 1,
    counts: { "2025-07": 1, "2025-08": 0, "2025-09": 1 },
    salesValues: { "2025-07": 200, "2025-08": 0, "2025-09": 100 },
  });
  assert.deepEqual(report.rows[1].counts, { "2025-07": null, "2025-08": 1, "2025-09": 0 });
  assert.equal(report.currentQuarter, "2025-09");
});

test("bimonthly cohorts aggregate Jan-Feb, Mar-Apr, and sales values", () => {
  const report = buildCustomerCohortReport([
    sale("A", "2025-01-05", { sales_amount: 100 }),
    sale("A", "2025-02-05", { sales_amount: 50 }),
    sale("A", "2025-03-05", { sales_amount: 25 }),
    sale("B", "2025-02-10", { sales_amount: 200 }),
    sale("B", "2025-04-10", { sales_amount: 80 }),
    sale("C", "2025-03-10", { sales_amount: 500, voucher_type: "Credit Note" }),
    sale("D", "2025-05-10", { sales_amount: 300 }),
  ], { period: "bimonth", asOfDate: "2025-06-15", filters: { dateFrom: "2025-02-20", dateTo: "2025-05-15" } });
  assert.deepEqual(report.quarters, ["2025-B1", "2025-B2", "2025-B3"]);
  assert.deepEqual(report.rows[0], {
    quarter: "2025-B1",
    customerCount: 2,
    counts: { "2025-B1": 2, "2025-B2": 2, "2025-B3": 0 },
    salesValues: { "2025-B1": 350, "2025-B2": 105, "2025-B3": 0 },
  });
  assert.deepEqual(report.rows[1].counts, { "2025-B1": null, "2025-B2": null, "2025-B3": 1 });
  assert.deepEqual(report.valueTotals, { "2025-B1": 350, "2025-B2": 105, "2025-B3": 300 });
  assert.equal(customerCohortPeriodSummary(report.rows, "2025-B1").total, 2);
  assert.equal(customerCohortPeriodSummary(report.rows, "2025-B3").total, 1);
});