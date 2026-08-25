import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProspectScheduleRows,
  buildRecentSalesByCustomer,
  filterAndRankVisitCustomers,
  splitVisitCustomersByOutstanding,
} from "../app/management/my-day/visitPriority.js";

test("prospect follow-ups become scheduled visits", () => {
  const rows = buildProspectScheduleRows([
    { id: 5, company_name: "New Shop", city: "Riyadh", area: "Al Mashael", follow_up_date: "2026-08-15", salesman_code: "S1" },
    { id: 6, company_name: "No Follow-up", follow_up_date: null },
  ]);

  assert.deepEqual(rows, [{
    customer_code: "PROSPECT-5",
    customer_name: "New Shop",
    city: "Riyadh",
    area: "Al Mashael",
    next_visit_at: "2026-08-15T00:00:00",
    schedule_date: "2026-08-15",
    salesman_code: "S1",
    is_prospect: true,
  }]);
});

test("recent customer sales are aggregated by normalized code", () => {
  const result = buildRecentSalesByCustomer([
    { customer_code: " c001 ", sales_amount: 100 },
    { customer_code: "C001", sales_amount: 250 },
  ]);

  assert.deepEqual(result.get("C001"), { salesValue: 350, transactionCount: 2 });
});

test("visit customers rank high-value due opportunities before completed visits", () => {
  const ranked = filterAndRankVisitCustomers([
    { customer_code: "LOW", customer_name: "Low", recent_sales_value: 100, days_since_last_invoice: 30, status: "Planned" },
    { customer_code: "HIGH", customer_name: "High", recent_sales_value: 1000, days_since_last_invoice: 45, status: "Planned" },
    { customer_code: "DONE", customer_name: "Done", recent_sales_value: 5000, days_since_last_invoice: 5, status: "Visited" },
  ]);

  assert.deepEqual(ranked.map((row) => row.customer_code), ["HIGH", "DONE", "LOW"]);
});

test("visit customer search matches name and code", () => {
  const rows = [
    { customer_code: "1173C", customer_name: "Rawaa Trading", recent_sales_value: 100 },
    { customer_code: "2000A", customer_name: "Other Customer", recent_sales_value: 200 },
  ];

  assert.deepEqual(filterAndRankVisitCustomers(rows, "rawaa").map((row) => row.customer_code), ["1173C"]);
  assert.deepEqual(filterAndRankVisitCustomers(rows, "1173").map((row) => row.customer_code), ["1173C"]);
});

test("visit customers are grouped by outstanding balance or a visit without invoice", () => {
  const groups = splitVisitCustomersByOutstanding([
    { customer_code: "CURRENT", outstanding_0_30: 100, outstanding_above_90: 0 },
    { customer_code: "AGING_61_90", outstanding_61_90: 250, outstanding_above_90: 0 },
    { customer_code: "OVERDUE", outstanding_30_60: 100, outstanding_above_90: 1 },
    { customer_code: "CLEAR", outstanding_above_90: 0 },
    { customer_code: "VISITED_NO_INVOICE", last_visit_date: "2026-08-10", last_invoice_date: null },
    { customer_code: "NEW_UNVISITED", last_visit_date: null, last_invoice_date: null },
  ]);

  assert.deepEqual(groups.under90.map((row) => row.customer_code), ["CURRENT", "AGING_61_90"]);
  assert.deepEqual(groups.above90.map((row) => row.customer_code), ["OVERDUE"]);
  assert.deepEqual(groups.withoutInvoice.map((row) => row.customer_code), ["VISITED_NO_INVOICE"]);
  assert.deepEqual(groups.noOutstanding.map((row) => row.customer_code), ["CLEAR", "NEW_UNVISITED"]);
});