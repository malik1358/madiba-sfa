import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPotentialSalesTargetsSection,
  buildPotentialSalesTargetsDigest,
  buildPotentialSalesTargetLastVisitMap,
  daysSincePotentialSalesTargetInvoice,
  filterPotentialSalesTargetsForProfile,
  isPotentialSalesTarget,
  potentialSalesTargetMatchesSalesman,
  potentialSalesTargetExpectedSale,
  potentialSalesTargetMonthKeys,
  potentialSalesTargetSalesMonthKeys,
  potentialSalesTargetVisitedWithinDays,
  sumPotentialSalesByCustomerAndMonth,
} from "../app/lib/potentialSalesTargets.js";
import { loadPotentialSalesTargetCustomers } from "../app/lib/potentialSalesTargetsServer.js";
import { runDailyVisitReportEmailCycle } from "../app/lib/dailyVisitReportEmailServer.js";

const options = { todayKey: "2026-10-07" };
const customer = {
  customer_code: "C1", customer_name: "Shop <One>", is_active: true,
  total_outstanding: 14999.99, outstanding_0_30: 14999.99,
  last_invoice_date: "2026-09-21", invoices: [{ pending_amount: 14999.99, invoice_day: 16, invoice_date: "2026-09-21" }],
};
const potentialSalesTargetsRoute = readFileSync(
  new URL("../app/api/potential-sales-targets/route.js", import.meta.url),
  "utf8",
);

test("potential target API builds salesman options from the loaded allProfiles variable", () => {
  assert.match(potentialSalesTargetsRoute, /const \[allProfiles, records\] = await Promise\.all\(/);
  assert.match(potentialSalesTargetsRoute, /salesmanOptionsForTargets\(\s*eligibleTargets,\s*allProfiles,/);
  assert.doesNotMatch(potentialSalesTargetsRoute, /salesmanOptionsForTargets\(\s*eligibleTargets,\s*profiles,/);
});

test("potential sales targets require positive outstanding strictly below SAR 15000", () => {
  assert.equal(isPotentialSalesTarget(customer, options), true);
  for (const total_outstanding of [0, -1, 15000, 15001, undefined, "bad"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, total_outstanding }, options), false);
  }
});

test("outstanding at or above SAR 15000 qualifies only below highest completed-month sales", () => {
  const sales_by_month = { "2026-07": 18000, "2026-08": 12000, "2026-09": 14000, "2026-10": 99000 };
  assert.equal(isPotentialSalesTarget({ ...customer, total_outstanding: 17999, sales_by_month }, options), true);
  assert.equal(isPotentialSalesTarget({ ...customer, total_outstanding: 18000, sales_by_month }, options), false);
  assert.equal(isPotentialSalesTarget({ ...customer, total_outstanding: 18001, sales_by_month }, options), false);
});

test("potential sales targets exclude inactive customers and recent or missing invoices", () => {
  assert.equal(isPotentialSalesTarget({ ...customer, is_active: false }, options), false);
  assert.equal(isPotentialSalesTarget({ ...customer, last_order_invoice_date: "2026-10-07" }, options), false);
  for (const last_invoice_date of ["2026-09-22", "2026-10-07", "2026-10-08", "", "bad"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, last_invoice_date }, options), false);
  }
});

test("potential target recent-date cutoff uses the same last order or invoice date displayed", () => {
  assert.equal(isPotentialSalesTarget({
    ...customer,
    last_invoice_date: "2026-09-21",
    last_order_invoice_date: "2026-10-07",
  }, options), false);
  assert.equal(isPotentialSalesTarget({
    ...customer,
    last_invoice_date: "2026-09-21",
    last_order_invoice_date: "2026-09-21",
  }, options), true);
});

test("all open invoices must be under 60 days from invoice date regardless of uploaded aging fields", () => {
  assert.equal(isPotentialSalesTarget({
    ...customer,
    invoices: [{ pending_amount: 100, invoice_date: "2026-08-09", invoice_day: 120, overdue_days: 120, due_date: "2026-06-01" }],
  }, options), true);
  for (const invoice_date of ["2026-08-08", "2026-08-07"]) {
    assert.equal(isPotentialSalesTarget({
      ...customer,
      invoices: [{ pending_amount: 1, invoice_date, invoice_day: 1, overdue_days: 1, due_date: "2026-10-01" }],
    }, options), false);
  }
  assert.equal(isPotentialSalesTarget({
    ...customer,
    invoices: [{ pending_amount: 100, invoice_day: 1, overdue_days: 1 }],
  }, options), false);
  for (const bucket of ["outstanding_61_90", "outstanding_91_120", "outstanding_above_120"]) {
    assert.equal(isPotentialSalesTarget({ ...customer, [bucket]: 1 }, options), false);
  }
  assert.equal(isPotentialSalesTarget({ ...customer, invoices: [] }, options), false);
});

test("potential target section renders escaped customer details and totals in both email formats", () => {
  const section = buildPotentialSalesTargetsSection({
    rows: [{
      ...customer,
      potential_sale_expected: 20000,
      salesman_code: "SM001",
      last_visit_by_salesman: { SM001: "2026-10-03" },
    }, { ...customer, is_active: false }],
    ...options,
  });
  assert.equal(section.customerCount, 1);
  assert.equal(section.totalOutstanding, 14999.99);
  assert.match(section.html, /Shop &lt;One&gt;/);
  assert.match(section.html, /#0f4c5c/);
  assert.match(section.text, /Last Visit Date/);
  assert.match(section.text, /Shop <One> \| - \| 2026-10-03 \| 2026-09-21/);
  assert.match(section.text, /Potential Sale Expected \(SAR\)/);
  assert.match(section.text, /2026-09-21 \| 16 \| 14,999\.99 \| 20,000\.00/);
  assert.match(section.text, /Potential Sale Expected 20,000\.00 SAR/);
  assert.doesNotMatch(buildPotentialSalesTargetsSection({ rows: [customer], ...options }).text, /NaN/);
  assert.match(buildPotentialSalesTargetsSection({ ...options }).text, /No qualifying customers/);
});

test("expected sale uses the recent three-month peak then falls back to six completed months", () => {
  assert.deepEqual(potentialSalesTargetSalesMonthKeys("2026-10-07"), [
    "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
  ]);
  assert.equal(potentialSalesTargetExpectedSale({
    "2026-04": 40000, "2026-05": 25000, "2026-06": 10000,
    "2026-07": 18000, "2026-08": 12000, "2026-09": 14000, "2026-10": 99000,
  }, "2026-10-07"), 18000);
  assert.equal(potentialSalesTargetExpectedSale({
    "2026-04": 40000, "2026-05": 25000, "2026-06": 10000,
    "2026-07": 0, "2026-08": -50, "2026-09": 0, "2026-10": 99000,
  }, "2026-10-07"), 40000);
  assert.equal(potentialSalesTargetExpectedSale({}, "2026-10-07"), 0);
});

test("loader uses active customers and latest actual invoice, not credit notes or only open invoices", async () => {
  const queries = [];
  const admin = { from(table) {
    const filters = [];
    const query = {
      select(fields) { queries.push({ table, fields, filters }); return this; },
      eq(...args) { filters.push(args); return this; },
      gt() { return this; }, lte() { return this; }, in() { return this; }, order() { return this; },
      gte(...args) { filters.push(["gte", ...args]); return this; },
      lt(...args) { filters.push(["lt", ...args]); return this; },
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

test("target loader collapses dirty customer-master twins and retains the canonical row and visit", async () => {
  const dataByTable = {
    customers: [
      { customer_code: "1457", customer_name: "Hayat Al Shabab Trading company", current_salesman_code: "SM001", is_active: true, latest_transaction_date: "2026-09-17" },
      { customer_code: "1457_Hayat Al Shabab Trading company", customer_name: "1457_Hayat Al Shabab Trading company", current_salesman_code: "SM001", is_active: true, latest_transaction_date: "2026-09-17" },
    ],
    active_sales: [],
    collection_visits: [{ customer_code: "1457", created_by: "u1", saved_at: "2026-10-02T08:00:00+03:00" }],
    daily_activity_logs: [],
  };
  const admin = { from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, gt() { return this; }, lte() { return this; },
      in() { return this; }, order() { return this; }, gte() { return this; }, lt() { return this; },
      async range() { return { data: dataByTable[table] || [], error: null }; },
    };
    return query;
  } };
  const invoice = { pending_amount: 13014.78, invoice_date: "2026-09-17" };
  const rows = await loadPotentialSalesTargetCustomers(admin, {
    records: [
      { customer_code: "1457", salesman_code: "SM001", invoices: [invoice] },
      { customer_code: "1457_Hayat Al Shabab Trading company", salesman_code: "SM001", invoices: [invoice] },
    ],
    includeVisitDetails: true,
    profiles: [{ id: "u1", salesman_code: "SM001" }],
    ...options,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_code, "1457");
  assert.equal(rows[0].customer_name, "Hayat Al Shabab Trading company");
  assert.equal(rows[0].total_outstanding, 13014.78);
  assert.equal(rows[0].last_visit_by_salesman.SM001, "2026-10-02");
});

test("email target loader uses net sales from the three completed months for higher balances", async () => {
  const dataByTable = {
    customers: [{
      customer_code: "C1", customer_name: "Shop", current_salesman_code: "SM001",
      is_active: true, latest_transaction_date: "2026-09-21",
    }],
    active_sales: [
      { customer_code: "C1", transaction_date: "2026-07-15", sales_amount: 25000, voucher_type: "Sales" },
      { customer_code: "C1", transaction_date: "2026-07-20", sales_amount: 3000, voucher_type: "Credit Note" },
      { customer_code: "C1", transaction_date: "2026-08-18", sales_amount: 19000, voucher_type: "Sales" },
      { customer_code: "C1", transaction_date: "2026-09-18", sales_amount: 20000, voucher_type: "Sales" },
      { customer_code: "C1", transaction_date: "2026-10-02", sales_amount: 50000, voucher_type: "Sales" },
    ],
  };
  const admin = { from(table) {
    const filters = [];
    const query = {
      select() { return this; }, eq() { return this; }, gt() { return this; }, lte() { return this; },
      in() { return this; }, order() { return this; }, gte(...args) { filters.push(["gte", ...args]); return this; },
      lt(...args) { filters.push(["lt", ...args]); return this; },
      async range() {
        const rows = dataByTable[table] || [];
        if (table === "customers") return { data: rows, error: null };
        const startDate = filters.find(([operator]) => operator === "gte")?.[2];
        const endDate = filters.find(([operator]) => operator === "lt")?.[2];
        return {
          data: startDate && endDate
            ? rows.filter((row) => row.transaction_date >= startDate && row.transaction_date < endDate)
            : [],
          error: null,
        };
      },
    };
    return query;
  } };
  const { total_outstanding, ...collectionRecord } = customer;
  const rows = await loadPotentialSalesTargetCustomers(admin, {
    records: [{
      ...collectionRecord,
      total_outstanding: 21000,
      invoices: [{ pending_amount: 21000, invoice_day: 16, invoice_date: "2026-09-21" }],
    }],
    ...options,
  });
  assert.deepEqual(rows[0].sales_by_month, { "2026-07": 22000, "2026-08": 19000, "2026-09": 20000, "2026-10": 0 });
  assert.equal(rows[0].potential_sale_expected, 22000);
  assert.equal(isPotentialSalesTarget(rows[0], options), true);
});

test("browser target loader returns order date, salesperson visit, three completed sales months and current MTD", async () => {
  const dataByTable = {
    customers: [{
      customer_code: "1001", customer_name: "Shop One", current_salesman_code: "SM001",
      is_active: true, latest_transaction_date: "2026-09-20", city: "Riyadh", area: "Olaya",
    }],
    active_sales: [
      { customer_code: "1001C", transaction_date: "2026-07-15", sales_amount: 100 },
      { customer_code: "1001", transaction_date: "2026-07-20", sales_amount: 10, voucher_type: "Credit Note" },
      { customer_code: "1001", transaction_date: "2026-08-18", sales_amount: 200 },
    ],
    sales_orders: [{ customer_code: "1001", submitted_at: "2026-10-06T08:00:00Z", created_at: "2026-10-05T08:00:00Z" }],
    collection_visits: [{ customer_code: "1001", created_by: "u1", saved_at: "2026-10-02T08:00:00Z" }],
    daily_activity_logs: [{
      user_id: "u1", entry_type: "VISIT_REPORT", created_at: "2026-10-03T08:00:00Z",
      note: JSON.stringify({ customer_code: "1001", captured_at: "2026-10-03T08:00:00Z" }),
    }],
  };
  const admin = { from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, gt() { return this; }, lte() { return this; },
      in() { return this; }, order() { return this; },
      async range() { return { data: dataByTable[table] || [], error: null }; },
    };
    return query;
  } };
  const rows = await loadPotentialSalesTargetCustomers(admin, {
    records: [{
      customer_code: "1001", customer_name: "Shop One", salesman_code: "SM001", salesman_name: "Sales One",
      invoices: [{ pending_amount: 500, invoice_day: 20, invoice_date: "2026-09-20" }],
      outstanding_0_30: 500, outstanding_30_60: 0, outstanding_61_90: 0,
      outstanding_91_120: 0, outstanding_above_120: 0,
    }],
    todayKey: "2026-10-09",
    includeBrowserDetails: true,
    profiles: [{ id: "u1", salesman_code: "SM001", salesman_name: "Sales One" }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].last_order_invoice_date, "2026-10-06");
  assert.equal(rows[0].last_visit_by_salesman.SM001, "2026-10-03");
  assert.deepEqual(rows[0].sales_by_month, { "2026-07": 90, "2026-08": 200, "2026-09": 0, "2026-10": 0 });
  assert.equal(rows[0].potential_sale_expected, 200);
  assert.equal(isPotentialSalesTarget(rows[0], { todayKey: "2026-10-09" }), false);
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

test("standalone target report shows three completed KSA months and the current month", () => {
  assert.deepEqual(potentialSalesTargetMonthKeys("2026-01-04"), ["2025-10", "2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(potentialSalesTargetMonthKeys("bad"), []);
});

test("monthly customer sales net credit notes and returns, including current month", () => {
  const totals = sumPotentialSalesByCustomerAndMonth([
    { customer_code: "1001C", transaction_date: "2026-08-03", sales_amount: 500 },
    { customer_code: "1001", transaction_date: "2026-08-04", sales_amount: 70, voucher_type: "Credit Note" },
    { customer_code: "1001", transaction_date: "2026-10-02", sales_amount: 120 },
    { customer_code: "OTHER", transaction_date: "2026-10-02", sales_amount: 900 },
  ], ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(totals.get("1001"), { "2026-08": 430, "2026-09": 0, "2026-10": 120 });
});

test("last visit dates are keyed by customer and the visiting salesman's profile", () => {
  const dates = buildPotentialSalesTargetLastVisitMap({
    profiles: [{ id: "u1", salesman_code: "SM001" }, { id: "u2", salesman_code: "SM002" }],
    collectionVisits: [{ customer_code: "1001C", created_by: "u1", saved_at: "2026-09-02T10:00:00Z" }],
    activityLogs: [
      { entry_type: "VISIT_REPORT", user_id: "u1", created_at: "2026-10-01T10:00:00Z", note: JSON.stringify({ customer_code: "1001", captured_at: "2026-10-01T10:00:00Z" }) },
      { entry_type: "VISIT_REPORT", user_id: "u2", created_at: "2026-10-03T10:00:00Z", note: JSON.stringify({ customer_code: "1001", captured_at: "2026-10-03T10:00:00Z" }) },
      { entry_type: "NOTE", user_id: "u1", created_at: "2026-10-05T10:00:00Z", note: JSON.stringify({ customer_code: "1001" }) },
    ],
  });
  assert.equal(dates.get("1001::SM001"), "2026-10-01");
  assert.equal(dates.get("1001::SM002"), "2026-10-03");
  assert.equal(potentialSalesTargetMatchesSalesman({ current_salesman_code: "SM001" }, "SM001"), true);
  assert.equal(potentialSalesTargetMatchesSalesman({ salesman_code: "SM002" }, "SM001"), false);
});

test("standalone targets exclude visits today through eight days ago by the same salesman", () => {
  const row = {
    salesman_code: "SM001",
    last_visit_by_salesman: {
      SM001: "2026-10-01",
      SM002: "2026-10-09",
    },
  };
  assert.equal(potentialSalesTargetVisitedWithinDays(row, { todayKey: "2026-10-09" }), true);
  assert.equal(potentialSalesTargetVisitedWithinDays({
    ...row,
    last_visit_by_salesman: { ...row.last_visit_by_salesman, SM001: "2026-09-30" },
  }, { todayKey: "2026-10-09" }), false);
  assert.equal(potentialSalesTargetVisitedWithinDays(row, { todayKey: "2026-10-09", salesmanCode: "SM002" }), true);
  assert.equal(potentialSalesTargetVisitedWithinDays({
    salesman_code: "SM001",
    last_visit_by_salesman: { SM001: "2026-10-09" },
  }, { todayKey: "2026-10-09", salesmanCode: "SM002" }), false);
});

test("standalone target last visits ignore GPS-confirmed FAR visits and retain near visits", () => {
  const dates = buildPotentialSalesTargetLastVisitMap({
    customers: [
      { customer_code: "2001", latitude: 24, longitude: 46 },
      { customer_code: "2002", latitude: 24, longitude: 46 },
      { customer_code: "2003", latitude: 24, longitude: 46 },
    ],
    profiles: [{ id: "u1", salesman_code: "SM001" }],
    collectionVisits: [
      { customer_code: "2001", created_by: "u1", saved_at: "2026-10-02T09:00:00+03:00", latitude: 25, longitude: 46 },
      { customer_code: "2002", created_by: "u1", saved_at: "2026-10-03T09:00:00+03:00", latitude: 24.001, longitude: 46 },
      { customer_code: "2003", created_by: "u1", saved_at: "2026-10-04T09:00:00+03:00" },
    ],
    activityLogs: [
      {
        user_id: "u1",
        entry_type: "VISIT_REPORT",
        created_at: "2026-10-01T09:00:00+03:00",
        note: JSON.stringify({ customer_code: "2001", location: { latitude: 26, longitude: 46 } }),
      },
    ],
  });
  assert.equal(dates.has("2001::SM001"), false);
  assert.equal(dates.get("2002::SM001"), "2026-10-03");
  assert.equal(dates.get("2003::SM001"), "2026-10-04");
});

test("full potential target digest separates every salesman and their customer rows", () => {
  const digest = buildPotentialSalesTargetsDigest({
    rows: [
      { ...customer, salesman_code: "SM001", salesman_name: "Sales One", customer_code: "C1", potential_sale_expected: 20000 },
      { ...customer, salesman_code: "SM001", salesman_name: "Sales One", customer_code: "C3", customer_name: "Highest Shop", potential_sale_expected: 25000 },
      { ...customer, salesman_code: "SM002", salesman_name: "Sales Two", customer_code: "C2", customer_name: "Second Shop", potential_sale_expected: 18000 },
    ],
    ...options,
  });
  assert.equal(digest.customerCount, 3);
  assert.equal(digest.totalOutstanding, 44999.97);
  assert.equal(digest.totalExpectedSale, 63000);
  assert.match(digest.html, /Sales One \(SM001\)/);
  assert.match(digest.html, /Sales Two \(SM002\)/);
  assert.match(digest.text, /C1 \| Shop <One>/);
  assert.match(digest.text, /C2 \| Second Shop/);
  assert.ok(digest.text.indexOf("C3 | Highest Shop") < digest.text.indexOf("C1 | Shop <One>"));
});