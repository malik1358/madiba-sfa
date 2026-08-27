import test from "node:test";
import assert from "node:assert/strict";

import { buildSalesmanScopeMatchers } from "../app/lib/mutualSalesmanGroups.js";
import {
  combineOutstandingHeaderRows,
  customerAccountCodesMatch,
  customerCodeCandidates,
  detectOutstandingPendingAmountColumn,
  detectOutstandingSalesmanColumn,
  extractLeadingCustomerCodeAndName,
  applyOutstandingRowSalesman,
  buildOutstandingRowSalesmanByCode,
  isPlaceholderSalesmanValue,
  pickOutstandingSalesmanName,
  pickLongestCustomerName,
  findOutstandingForCustomer,
  findOutstandingHeaderRow,
  isSameOutstandingCustomer,
  findOutstandingCustomerCodesForSalesmen,
  findOutstandingInvoiceDayColumn,
  hydrateOutstandingInvoices,
  isOutstandingInvoiceDayHeader,
  normalizeOutstandingHeader,
  prioritizeOutstandingSheets,
  repairOutstandingInvoice,
  resolveOutstandingCustomerOwnership,
  resolveInvoiceAgingDays,
  resolveOutstandingInvoiceCustomerCode,
  resolveOverdueDaysFromDueDate,
  sanitizeStoredOverdueDays,
  summarizeOutstandingBuckets,
  summarizeOutstandingBucketsForVisitStatus,
  visibleOutstandingBucketLabels,
  mapOutstandingBucketsToCollectionFields,
  buildCollectionOutstandingBucketsFromInvoices,
  resolveCollectionOutstandingBuckets,
} from "../app/lib/outstanding.js";

test("detectOutstandingSalesmanColumn prefers Salesman over Sales Person", () => {
  const header = ["Date", "Ref. No.", "Party's Name", "Sales Person", "City Name", "State Name", "Pending", "Due on", "Overdue", "Invoice Days", "Salesman"];

  assert.equal(detectOutstandingSalesmanColumn(header), 10);
});

test("isPlaceholderSalesmanValue detects voucher placeholders", () => {
  assert.equal(isPlaceholderSalesmanValue("NOT ADDED IN VOUCHER"), true);
  assert.equal(isPlaceholderSalesmanValue(""), true);
  assert.equal(isPlaceholderSalesmanValue("N/A"), true);
  assert.equal(isPlaceholderSalesmanValue("UNASSIGNED"), true);
  assert.equal(isPlaceholderSalesmanValue("Osama"), false);
});

test("pickOutstandingSalesmanName prefers real salesman over empty and placeholders", () => {
  const invoices = [
    { salesman: "" },
    { salesman: "NOT ADDED IN VOUCHER" },
    { salesman: "Osama" },
    { salesman: "Osama" },
    { salesman: "" },
  ];

  assert.equal(pickOutstandingSalesmanName(invoices), "Osama");
});

test("applyOutstandingRowSalesman backfills invoice salesman from aggregate rows", () => {
  const rows = [{
    customer_code: "1134C",
    customer_name: "Golden Top Company",
    salesman: "Osama",
    buckets: { ">120": 11850.52 },
    total_outstanding: 11850.52,
  }];
  const invoices = [{
    customer_code: "1134C",
    customer_name: "Golden Top Company",
    pending_amount: 11850.52,
    salesman: "",
  }];

  assert.deepEqual(buildOutstandingRowSalesmanByCode(rows), new Map([["1134C", "Osama"]]));
  assert.equal(applyOutstandingRowSalesman(invoices, rows)[0].salesman, "Osama");
});

test("findOutstandingCustomerCodesForSalesmen matches normalized salesman identity", () => {
  const dataset = {
    invoices: [
      {
        customer_code: "1173C LOULOAT AL NILE TRADING CO.",
        customer_name: "1173C LOULOAT AL NILE TRADING CO.",
        salesman: "Ahmed Nabil",
      },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("findOutstandingCustomerCodesForSalesmen does not widen unrelated scope", () => {
  const dataset = {
    invoices: [
      { customer_code: "1173C", salesman: "Ahmed Nabil" },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("outstanding ownership records other salesman assignments as authoritative", () => {
  const ownership = resolveOutstandingCustomerOwnership({
    invoices: [
      { customer_code: "1173C", salesman: "Ahmed Nabil" },
      { customer_code: "1114C", salesman: "Junaid" },
    ],
  }, ["AHMED NABIL"]);

  assert.deepEqual([...ownership.assignedCustomerCodes], ["1173C", "1114C"]);
  assert.deepEqual([...ownership.ownedCustomerCodes], ["1173C"]);
});

test("outstanding ownership uses scope matchers for parenthetical salesman labels", () => {
  const dataset = {
    invoices: [
      { customer_code: "1542", salesman: "Parvez (PARVEZ)" },
      { customer_code: "1290", salesman: "Junaid" },
    ],
  };
  const parvezScope = buildSalesmanScopeMatchers([
    { salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" },
    { salesman_code: "JUNAID", salesman_name: "Junaid (JUNAID)" },
    { salesman_code: "SOYEB", salesman_name: "Soyeb (SOYEB)" },
  ]);

  const ownership = resolveOutstandingCustomerOwnership(
    dataset,
    ["PARVEZ", "JUNAID", "SOYEB"],
    parvezScope,
  );

  assert.deepEqual([...ownership.ownedCustomerCodes].sort(), ["1290", "1542"]);
});

test("customerCodeCandidates extracts code from a combined customer master value", () => {
  assert.deepEqual(
    customerCodeCandidates("1173C LOULOAT AL NILE TRADING CO."),
    ["1173C LOULOAT AL NILE TRADING CO.", "1173C"]
  );
});

test("extractLeadingCustomerCodeAndName only splits real customer codes", () => {
  assert.deepEqual(
    extractLeadingCustomerCodeAndName("1542 RENEWABLE TECHNOLOGY FOR TRADING EST"),
    { customer_code: "1542", customer_name: "RENEWABLE TECHNOLOGY FOR TRADING EST" },
  );
  assert.deepEqual(
    extractLeadingCustomerCodeAndName("RENEWABLE TECHNOLOGY FOR TRADING EST"),
    { customer_code: "", customer_name: "RENEWABLE TECHNOLOGY FOR TRADING EST" },
  );
  assert.deepEqual(
    extractLeadingCustomerCodeAndName("TECHNOLOGY FOR TRADING EST"),
    { customer_code: "", customer_name: "TECHNOLOGY FOR TRADING EST" },
  );
});

test("repairOutstandingInvoice keeps the longest available party label", () => {
  const repaired = repairOutstandingInvoice({
    customer_code: "1542",
    customer_name: "FOR TRADING EST",
  });

  assert.equal(repaired.customer_code, "1542");
  assert.equal(repaired.customer_name, "1542 FOR TRADING EST");
});

test("pickLongestCustomerName prefers the fullest available label", () => {
  assert.equal(
    pickLongestCustomerName("FOR TRADING EST", "RENEWABLE TECHNOLOGY FOR TRADING EST", "1542"),
    "RENEWABLE TECHNOLOGY FOR TRADING EST",
  );
});

test("customerAccountCodesMatch treats numeric suffix variants as the same account", () => {
  assert.equal(customerAccountCodesMatch("1199", "1199C"), true);
  assert.equal(customerAccountCodesMatch("1199C", "1199 NASSER HAMAD AL-MALEK TRADING EST"), true);
  assert.equal(customerAccountCodesMatch("1173C", "1174C"), false);
});

test("findOutstandingHeaderRow accepts Open Balance and Aging invoice detail headers", () => {
  const rows = [
    ["Outstanding Report"],
    ["Date", "Ref No", "Customer Account", "Open Balance", "Due Date", "Aging", "Salesman"],
    ["10/08/2026", "INV-1", "1173C Customer", 250, "20/08/2026", 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 1);
});

test("findOutstandingHeaderRow accepts Pending Amount and Overdue Days without Invoice Day", () => {
  const rows = [
    ["Date", "Ref No", "Customer Name", "Pending Amount", "Due Date", "Overdue Days", "Salesman"],
    ["10/08/2026", "INV-1", "1173C Customer", 250, "20/08/2026", 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 0);
});

test("Invoice Day is distinguished from Overdue Days", () => {
  assert.equal(isOutstandingInvoiceDayHeader("Overdue Days"), false);
  assert.equal(isOutstandingInvoiceDayHeader("Invoice Day"), true);
  assert.equal(isOutstandingInvoiceDayHeader("Invoice Days"), true);
});

test("Invoice Day falls back to the distinct column after Overdue Days", () => {
  const headers = ["Date", "Ref. No.", "Party's Name", "Pending Amount", "Due Date", "Overdue Days", "Invoice Da", "Salesman"];

  assert.equal(findOutstandingInvoiceDayColumn(headers, 5, 7), 6);
});

test("findOutstandingHeaderRow accepts short Party, Balance, and Days headers", () => {
  const rows = [
    ["Party", "Voucher", "Balance", "Days", "Sales Person"],
    ["1173C Customer", "INV-1", 250, 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 0);
});

test("combined outstanding headers preserve parent and child labels", () => {
  const rows = [
    ["Customer", "", "Outstanding", "Aging"],
    ["Code", "Name", "Balance", "Days"],
  ];

  assert.deepEqual(combineOutstandingHeaderRows(rows, 1), [
    "Customer Code",
    "Name",
    "Outstanding Balance",
    "Aging Days",
  ]);
  assert.equal(findOutstandingHeaderRow(rows), 1);
});

test("pending bills banner rows do not merge into bills receivable detail headers", () => {
  const rows = [
    ["Pending Bills", "", "", "", "", "", 46252, "Overdue Above 90 Days"],
    ["Date", "Ref. No.", "Party's Name", "Sales Person", "City Name", "State Name", "Pending", "Due on", "Overdue", "Invoice Days", "Salesman"],
    [46053, 2825, "1126C  Five Trend Trading Company", "Osama", "", "Riyadh", 4362.23, 46083, 169, 199, "Osama"],
  ];

  const header = combineOutstandingHeaderRows(rows, 1);
  assert.deepEqual(header.slice(0, 8), [
    "Date",
    "Ref. No.",
    "Party's Name",
    "Sales Person",
    "City Name",
    "State Name",
    "Pending",
    "Due on",
  ]);
  assert.equal(detectOutstandingPendingAmountColumn(header), 6);
});

test("single-cell report titles are not merged into detail headers", () => {
  const rows = [
    ["Pending Bills"],
    ["Date", "Ref. No.", "Party's Name", "Pending Amount", "Due Date", "Overdue Days", "Invoice Day", "Salesman"],
  ];

  assert.deepEqual(combineOutstandingHeaderRows(rows, 1), rows[1]);
});

test("Pending Bills is preferred over an older Bills Receivable sheet", () => {
  assert.deepEqual(
    prioritizeOutstandingSheets(["Bills Receivable", "Summary", "Pending Bills"]),
    ["Pending Bills", "Bills Receivable", "Summary"]
  );
});

test("visible outstanding buckets keep empty gaps through the oldest balance", () => {
  assert.deepEqual(
    visibleOutstandingBucketLabels(
      ["0-30", "31-60", "61-90", "91-120", ">120"],
      { "0-30": 61312.25, "31-60": 0, "61-90": 14795.35, "91-120": 0, ">120": 0 }
    ),
    ["0-30", "31-60", "61-90"]
  );
});

test("outstanding buckets collapse into the three Visit Status age bands", () => {
  assert.deepEqual(
    summarizeOutstandingBuckets({
      "0-30": 100,
      "31-60": 200,
      "61-90": 300,
      "91-120": 400,
      ">120": 500,
    }),
    { days0To30: 100, days30To60: 200, daysAbove60: 1200 }
  );
});

test("visit status outstanding buckets split at 90 days", () => {
  assert.deepEqual(
    summarizeOutstandingBucketsForVisitStatus({
      "0-30": 100,
      "31-60": 200,
      "61-90": 300,
      "91-120": 400,
      ">120": 500,
    }),
    { days0To30: 100, days30To60: 200, days61To90: 300, daysAbove90: 900 }
  );
});

test("findOutstandingHeaderRow scans beyond the old 25-row report preamble", () => {
  const rows = Array.from({ length: 30 }, () => [""]);
  rows.push(["Customer Name", "0-30", "31-60", "Open Invoices"]);

  assert.equal(findOutstandingHeaderRow(rows), 30);
});

test("resolveInvoiceAgingDays prefers invoice day over excel serial overdue values", () => {
  const invoice = {
    invoice_day: 41,
    overdue_days: 46241,
    due_date: "2026-08-07",
    pending_amount: 46211,
  };

  assert.equal(resolveInvoiceAgingDays(invoice, "2026-08-18T12:00:00"), 41);
  assert.equal(resolveOverdueDaysFromDueDate(invoice, "2026-08-18T12:00:00"), 11);
});

test("sanitizeStoredOverdueDays drops excel serial values from uploads", () => {
  assert.equal(sanitizeStoredOverdueDays(46241, 41), 0);
  assert.equal(sanitizeStoredOverdueDays(15, 41), 15);
});

test("normalizeOutstandingHeader strips curly apostrophes from Party Name headers", () => {
  assert.equal(normalizeOutstandingHeader("Party\u2019s Name"), "partys name");
});

test("repairOutstandingInvoice extracts 1119C from party name text", () => {
  const repaired = repairOutstandingInvoice({
    customer_code: "",
    customer_name: "1119C  Fahd Ali Sulaiman Al Subaie Trading Est",
    pending_amount: 2805538,
    ref_no: "SI/9901",
  });

  assert.equal(resolveOutstandingInvoiceCustomerCode(repaired), "1119C");
  assert.equal(repaired.customer_code, "1119C");
});

test("hydrateOutstandingInvoices synthesizes missing invoice rows from aggregate rows", () => {
  const invoices = hydrateOutstandingInvoices({
    invoices: [],
    rows: [{
      customer_code: "1119C  Fahd Ali Sulaiman Al Subaie Trading Est",
      customer_name: "1119C  Fahd Ali Sulaiman Al Subaie Trading Est",
      buckets: { ">120": 2805538 },
      total_outstanding: 2805538,
    }],
  });

  assert.equal(invoices.length, 1);
  assert.equal(resolveOutstandingInvoiceCustomerCode(invoices[0]), "1119C");
  assert.equal(invoices[0].pending_amount, 2805538);
});

test("prospect customers do not inherit outstanding from similar customer names", () => {
  const dataset = {
    rows: [{
      customer_code: "1098",
      customer_name: "Al Tawfeer Trading Company",
      open_invoices: 1,
      buckets: { ">120": 2224 },
      total_outstanding: 2224,
    }],
    invoices: [{
      customer_code: "1098",
      customer_name: "Al Tawfeer Trading Company",
      ref_no: "1098",
      pending_amount: 2224,
      overdue_days: 328,
      salesman: "Abdul Rehman",
    }],
  };

  const customer = findOutstandingForCustomer(
    dataset,
    "PROSPECT-126",
    "Raed Al Tawfeer Trading Company, Al Shifa Branch",
  );

  assert.equal(customer, null);
  assert.equal(
    isSameOutstandingCustomer(
      "1098",
      "Al Tawfeer Trading Company",
      "PROSPECT-126",
      "Raed Al Tawfeer Trading Company, Al Shifa Branch",
    ),
    false,
  );
});

test("mapOutstandingBucketsToCollectionFields mirrors customer audit bucket layout", () => {
  assert.deepEqual(
    mapOutstandingBucketsToCollectionFields({
      "0-30": 0,
      "31-60": 1160,
      "61-90": 2244,
      "91-120": 2906,
    }),
    {
      outstanding_0_30: 0,
      outstanding_30_60: 1160,
      outstanding_61_90: 2244,
      outstanding_91_120: 2906,
      outstanding_above_120: 0,
    },
  );
});

test("buildCollectionOutstandingBucketsFromInvoices prefers invoice day over overdue days", () => {
  const withInvoiceDay = buildCollectionOutstandingBucketsFromInvoices([
    { pending_amount: 1159.89, invoice_day: 35, overdue_days: 5 },
    { pending_amount: 2243.94, invoice_day: 65, overdue_days: 35 },
    { pending_amount: 2906, invoice_day: 117, overdue_days: 89 },
  ]);

  assert.deepEqual(withInvoiceDay, {
    outstanding_cash: 0,
    outstanding_0_30: 0,
    outstanding_30_60: 1159.89,
    outstanding_61_90: 2243.94,
    outstanding_91_120: 2906,
    outstanding_above_120: 0,
  });

  const overdueOnly = buildCollectionOutstandingBucketsFromInvoices([
    { pending_amount: 1159.89, overdue_days: 5 },
    { pending_amount: 2243.94, overdue_days: 35 },
    { pending_amount: 2906, overdue_days: 89 },
  ]);

  assert.deepEqual(overdueOnly, {
    outstanding_cash: 0,
    outstanding_0_30: 1159.89,
    outstanding_30_60: 2243.94,
    outstanding_61_90: 2906,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  });
});

test("resolveCollectionOutstandingBuckets prefers uploaded row buckets", () => {
  const fromRows = resolveCollectionOutstandingBuckets({
    rowBuckets: {
      "0-30": 0,
      "31-60": 1160,
      "61-90": 2244,
      "91-120": 2906,
    },
    invoices: [
      { pending_amount: 1159.89, invoice_day: 35, overdue_days: 5 },
      { pending_amount: 2243.94, invoice_day: 65, overdue_days: 35 },
      { pending_amount: 2906, invoice_day: 117, overdue_days: 89 },
    ],
  });

  assert.equal(fromRows.outstanding_30_60, 1160);
  assert.equal(fromRows.outstanding_61_90, 2244);
  assert.equal(fromRows.outstanding_91_120, 2906);
  assert.equal(fromRows.outstanding_0_30, 0);
});