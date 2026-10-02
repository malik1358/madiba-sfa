import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerCohortReport, formatCustomerCohortCell } from "../app/lib/customerCohorts.js";
import { loadCategoryGrowthReport } from "../app/lib/categoryGrowthServer.js";

const sale = (code, date, extra = {}) => ({ customer_code: code, transaction_date: date, sales_amount: 100, ...extra });

test("retention display always includes the customer count", () => {
  assert.equal(formatCustomerCohortCell(70, 100, "retention"), "70 (70.0%)");
  assert.equal(formatCustomerCohortCell(0, 100, "retention"), "0 (0.0%)");
  assert.equal(formatCustomerCohortCell(110, 140, "retention"), "110 (78.6%)");
  assert.equal(formatCustomerCohortCell(null, 100, "retention"), "-");
  assert.equal(formatCustomerCohortCell(70, 100), "70");
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
  assert.deepEqual(report.rows[0], { quarter: "2025-Q3", customerCount: 2, counts: { "2025-Q3": 2, "2025-Q4": 1, "2026-Q1": 1 } });
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
});