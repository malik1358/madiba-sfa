import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPotentialSalesTargetsSection,
  daysSincePotentialSalesTargetInvoice,
  filterPotentialSalesTargetsForProfile,
  isPotentialSalesTarget,
} from "../app/lib/potentialSalesTargets.js";
import { loadPotentialSalesTargetCustomers } from "../app/lib/potentialSalesTargetsServer.js";
import { runDailyVisitReportEmailCycle } from "../app/lib/dailyVisitReportEmailServer.js";

const options = { todayKey: "2026-10-07" };
const customer = {
  customer_code: "C1", customer_name: "Shop <One>", is_active: true,
  total_outstanding: 14999.99, outstanding_0_30: 14999.99,
  last_invoice_date: "2026-09-21", invoices: [{ pending_amount: 14999.99, invoice_day: 16 }],
};

test("potential sales targets require positive outstanding strictly below SAR 15000", () => {
  assert.equal(isPotentialSalesTarget(customer, options), true);
  for (const total_outstanding of [0, -1, 15000, 15001, undefined, "bad"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, total_outstanding }, options), false);
  }
});

test("potential sales targets exclude inactive customers and recent or missing invoices", () => {
  assert.equal(isPotentialSalesTarget({ ...customer, is_active: false }, options), false);
  for (const last_invoice_date of ["2026-09-22", "2026-10-07", "2026-10-08", "", "bad"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, last_invoice_date }, options), false);
  }
});

test("all outstanding must be under 60 days including the strict day-60 boundary", () => {
  assert.equal(isPotentialSalesTarget({ ...customer, invoices: [{ pending_amount: 100, invoice_day: 59 }] }, options), true);
  for (const invoice_day of [60, 61, 120]) {
    assert.equal(isPotentialSalesTarget({ ...customer, invoices: [...customer.invoices, { pending_amount: 1, invoice_day }] }, options), false);
  }
  for (const bucket of ["outstanding_61_90", "outstanding_91_120", "outstanding_above_120"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, [bucket]: 1 }, options), false);
  }
  assert.equal(isPotentialSalesTarget({ ...customer, invoices: [] }, options), false);
});

test("potential target section renders escaped customer details and totals in both email formats", () => {
  const section = buildPotentialSalesTargetsSection({ rows: [customer, { ...customer, is_active: false }], ...options });
  assert.equal(section.customerCount, 1);
  assert.equal(section.totalOutstanding, 14999.99);
  assert.match(section.html, /Shop &lt;One&gt;/);
  assert.match(section.html, /#0f4c5c/);
  assert.match(section.text, /2026-09-21 \| 16 \| 14,999.99/);
  assert.match(section.text, /Total \| 1 customers/);
  assert.match(buildPotentialSalesTargetsSection({ ...options }).text, /No qualifying customers/);
});

test("loader uses active customers and latest actual invoice, not credit notes or only open invoices", async () => {
  const queries = [];
  const admin = { from(table) {
    const filters = [];
    const query = {
      select(fields) { queries.push({ table, fields, filters }); return this; },
      eq(...args) { filters.push(args); return this; },
      gt() { return this; }, lte() { return this; }, in() { return this; }, order() { return this; },
      async range() {
        return { data: table === "customers" ? [
          { customer_code: "C1", customer_name: "Shop", current_salesman_code: "SM001", is_active: true, latest_transaction_date: "2026-09-01" },
        ] : [
          { customer_code: "C1", transaction_date: "2026-10-01", sales_amount: 50, voucher_number: "CN/1", quantity: 1 },
          { customer_code: "C1", transaction_date: "2026-09-30", sales_amount: 50, voucher_type: "Credit Note", quantity: 1 },
          { customer_code: "C1", transaction_date: "2026-09-29", sales_amount: 50, voucher_type: "Sales", quantity: -1 },
          { customer_code: "C1", transaction_date: "2026-09-25", sales_amount: 100, voucher_type: "Sales", quantity: 1 },
        ], error: null };
      },
    };
    return query;
  } };
  const { total_outstanding, ...collectionRecord } = customer;
  const rows = await loadPotentialSalesTargetCustomers(admin, { records: [collectionRecord], ...options });
  assert.deepEqual(queries[0].filters, [["is_active", true]]);
  assert.match(queries[1].fields, /voucher_type/);
  assert.equal(rows[0].total_outstanding, total_outstanding);
  assert.equal(rows[0].last_invoice_date, "2026-09-25");
  assert.equal(isPotentialSalesTarget(rows[0], options), false);
});

test("daily emails carry salesman-specific potential targets into the company digest", async () => {
  const sent = [];
  const profiles = [
    { id: "u1", role: "salesman", salesman_code: "SM001", salesman_name: "Sales One", email: "one@example.com" },
    { id: "u2", role: "salesman", salesman_code: "SM002", salesman_name: "Sales Two", email: "two@example.com" },
  ];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-10-06", now: new Date("2026-10-06T21:10:00Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@example.com", DAILY_VISIT_REPORT_TO: "manager@example.com" },
    send: async (message) => { sent.push(message); return { provider: "test" }; },
    loadReport: async () => ({ users: [], thresholdKm: 0.5 }),
    loadProfiles: async () => profiles,
    loadAuthUsers: async () => [],
    loadSummary: async () => ({ daySummary: {} }),
    loadKpis: async () => [], loadTeamTargets: async () => new Map(),
    loadDueCollectionCustomers: async () => [],
    loadPotentialSalesTargets: async () => [
      { ...customer, current_salesman_code: "SM001" },
      { ...customer, customer_code: "C2", current_salesman_code: "SM002" },
      { ...customer, customer_code: "INACTIVE", current_salesman_code: "SM001", is_active: false },
    ],
  });
  assert.equal(result.sentCount, 3);
  const one = sent.find((message) => message.to.includes("one@example.com"));
  const two = sent.find((message) => message.to.includes("two@example.com"));
  const digest = sent.find((message) => message.to.includes("manager@example.com"));
  assert.match(one.text, /Potential Sales Target Customers/);
  assert.match(one.text, /C1 \|/);
  assert.doesNotMatch(one.text, /C2 \||INACTIVE/);
  assert.match(two.text, /C2 \|/);
  assert.doesNotMatch(two.text, /C1 \|/);
  assert.match(digest.text, /C1 \|/);
  assert.match(digest.text, /C2 \|/);
  assert.match(digest.html, /Potential Sales Target Customers/);
});

test("browser target scope includes current and previous assignments but not another salesman's customers", () => {
  const rows = [
    { customer_code: "CURRENT", current_salesman_code: "sm001" },
    { customer_code: "PREVIOUS", previous_salesman_code: "SM001" },
    { customer_code: "UPLOAD", salesman_name: "Sales One (SM001)" },
    { customer_code: "OTHER", current_salesman_code: "SM002", salesman_name: "Sales Two" },
  ];
  assert.deepEqual(
    filterPotentialSalesTargetsForProfile(rows, { salesman_code: "SM001", salesman_name: "Sales One" })
      .map((row) => row.customer_code),
    ["CURRENT", "PREVIOUS", "UPLOAD"],
  );
});

test("browser target invoice age is calculated on KSA report date keys", () => {
  assert.equal(daysSincePotentialSalesTargetInvoice({ last_invoice_date: "2026-09-21" }, "2026-10-07"), 16);
  assert.equal(daysSincePotentialSalesTargetInvoice({ last_invoice_date: "bad" }, "2026-10-07"), null);
});