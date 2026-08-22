import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionPriority,
  buildCollectionQueues,
  buildExposureScore,
  buildExposureScoreFromInvoices,
  filterCollectionQueueInvoices,
  hasCollectionVisit,
  invoiceHasCashRef,
  isCashQueueCustomer,
  isExcludedCollectionQueueSalesman,
  isScheduledRevisitQueueCustomer,
  normalizeWhatsappNumber,
  sortCashQueueCustomers,
} from "../app/lib/paymentCollections.js";

test("invoiceHasCashRef matches C in Ref. No. only", () => {
  assert.equal(invoiceHasCashRef({ ref_no: "RC/056" }), true);
  assert.equal(invoiceHasCashRef({ ref_no: "DC/008" }), true);
  assert.equal(invoiceHasCashRef({ ref_no: "CNFD/001" }), true);
  assert.equal(invoiceHasCashRef({ ref_no: "CREDIT-123" }), true);
  assert.equal(invoiceHasCashRef({ ref_no: "INV-9283" }), false);
  assert.equal(invoiceHasCashRef({ ref_no: "SI/12345" }), false);
  assert.equal(invoiceHasCashRef({ ref_no: "1098", customer_code: "1119C" }), false);
  assert.equal(invoiceHasCashRef({ ref_no: "1098", reference: "RC/001" }), false);
});

test("buildCollectionQueues does not treat customer code ending in C as cash without C in ref_no", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1119C",
      customer_name: "Fahd Ali Sulaiman Al Subaie Trading Est",
      invoices: [{ pending_amount: 25000, due_date: "2026-08-10", overdue_days: 12, ref_no: "SI/4501" }],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(queues.dueCustomers[0].outstanding_cash, 0);
  assert.equal(isCashQueueCustomer(queues.dueCustomers[0], "2026-08-22"), false);
});

test("buildExposureScoreFromInvoices sums amount x days per invoice", () => {
  const exposure = buildExposureScoreFromInvoices([
    { pending_amount: 4132.68, overdue_days: 29 },
    { pending_amount: 3185.5, overdue_days: 75 },
    { pending_amount: 3811.45, overdue_days: 93 },
  ], "2026-08-22T00:00:00Z");

  assert.ok(exposure > 0);
  assert.notEqual(exposure, buildExposureScore(11129.63, 93));
});

test("buildExposureScore multiplies amount by overdue days for single-invoice shorthand", () => {
  assert.equal(buildExposureScore(13566.32, 195), 13566.32 * 195);
  assert.equal(buildExposureScore(5311, 241), 5311 * 241);
  assert.ok(buildExposureScore(13566.32, 195) > buildExposureScore(5311, 241));
});

test("normalizeWhatsappNumber converts local KSA mobile to country format", () => {
  assert.equal(normalizeWhatsappNumber("0551234567"), "966551234567");
  assert.equal(normalizeWhatsappNumber("966551234567"), "966551234567");
});

test("buildCollectionPriority favors recent due accounts over stale non-payment", () => {
  const high = buildCollectionPriority({ max_overdue_days: 2, total_due_amount: 4000, due_invoice_count: 1, latest_collection: { payment_status: "PROMISED" }, today: "2026-08-14" });
  const low = buildCollectionPriority({ max_overdue_days: 90, total_due_amount: 40000, due_invoice_count: 6, latest_collection: { payment_status: "NOT_PAID" }, today: "2026-08-14" });

  assert.equal(high.label, "Medium");
  assert.equal(low.label, "High");
  assert.ok(low.score > high.score);
});

test("buildCollectionQueues lists only past-due customers and routes legal ones separately", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "C1",
      customer_name: "Due Customer",
      invoices: [{ pending_amount: 200, due_date: "2026-08-10", overdue_days: 4 }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
    {
      customer_code: "C2",
      customer_name: "Future Due",
      invoices: [{ pending_amount: 200, due_date: "2026-08-20", overdue_days: 0 }],
      latest_collection: null,
      legal_transfer: null,
    },
    {
      customer_code: "C3",
      customer_name: "Legal Customer",
      invoices: [{ pending_amount: 200, due_date: "2026-08-01", overdue_days: 13 }],
      latest_collection: null,
      legal_transfer: { is_transferred: true, transferred_at: "2026-08-14T08:00:00Z" },
    },
  ], "2026-08-14T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["C1"]);
  assert.deepEqual(queues.notDueCustomers.map((row) => row.customer_code), ["C2"]);
  assert.deepEqual(queues.legalCustomers.map((row) => row.customer_code), ["C3"]);
});

test("buildCollectionQueues places not-yet-due customers in notDueCustomers queue", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1538",
      customer_name: "Eastern Fallcon Llc",
      outstanding_0_30: 1000,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
      invoices: [{ pending_amount: 1000, due_date: "2026-08-20", overdue_days: 0, ref_no: "INV-9283" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
  ], "2026-08-14T10:00:00Z");

  assert.deepEqual(queues.dueCustomers, []);
  assert.equal(queues.notDueCustomers.length, 1);
  assert.equal(queues.notDueCustomers[0].customer_code, "1538");
  assert.equal(queues.notDueCustomers[0].total_not_due_amount, 1000);
  assert.equal(queues.notDueCustomers[0].invoices.length, 1);
});

test("buildCollectionQueues ranks exposure before cash bucket tie-breaker", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "NONCASH",
      customer_name: "Non Cash Customer",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 800, due_date: "2026-08-10", overdue_days: 4, ref_no: "INV-100" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
    {
      customer_code: "CASH",
      customer_name: "Cash Customer",
      outstanding_cash: 500,
      invoices: [{ pending_amount: 500, due_date: "2026-08-12", overdue_days: 2, ref_no: "DC/008" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
  ], "2026-08-14T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["NONCASH", "CASH"]);
});

test("buildCollectionQueues treats cash ref invoices as immediately due even with zero overdue days", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1011C",
      customer_name: "Cash Customer",
      invoices: [{ pending_amount: 13185, due_date: "2026-08-24", overdue_days: 0, ref_no: "RC/056" }],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(queues.notDueCustomers.length, 0);
  assert.equal(queues.dueCustomers[0].outstanding_cash, 13185);
});

test("buildCollectionQueues ranks cash by exposure when cash exposure is higher", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "NONCASH",
      customer_name: "Non Cash Customer",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 500, due_date: "2026-08-10", overdue_days: 2, ref_no: "INV-100" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
    {
      customer_code: "CASH",
      customer_name: "Cash Customer",
      outstanding_cash: 5000,
      invoices: [{ pending_amount: 5000, due_date: "2026-08-12", overdue_days: 20, ref_no: "RC/001" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
  ], "2026-08-14T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["CASH", "NONCASH"]);
});

test("buildCollectionQueues ranks 1115C above 1416 when exposure is higher", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1416",
      customer_name: "Zuhour Al Madina Trading Company",
      invoices: [{ pending_amount: 6375, overdue_days: 12, ref_no: "SI/1416" }],
      latest_collection: {
        payment_status: "NOT_PAID",
        saved_at: "2026-08-20T10:00:00Z",
        next_visit_at: "2026-08-15",
      },
      legal_transfer: null,
    },
    {
      customer_code: "1115C",
      customer_name: "Ealam Almanzil Trading Establishment",
      invoices: [
        { pending_amount: 5416.5, overdue_days: 45, ref_no: "SI/2001" },
        { pending_amount: 5580, overdue_days: 154, ref_no: "SI/2002" },
      ],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.ok(queues.dueCustomers[0].exposure_score > queues.dueCustomers[1].exposure_score);
  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["1115C", "1416"]);
});

test("buildCollectionQueues keeps future scheduled revisit ahead of cash", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "CASHNOW",
      customer_name: "Cash Now",
      invoices: [{ pending_amount: 5000, due_date: "2026-08-24", overdue_days: 0, ref_no: "RC/001" }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
    {
      customer_code: "SCHEDULED",
      customer_name: "Scheduled Revisit",
      invoices: [{ pending_amount: 300, due_date: "2026-08-01", overdue_days: 17, ref_no: "INV-200" }],
      latest_collection: { payment_status: "PROMISED", next_visit_at: "2026-08-25" },
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["SCHEDULED", "CASHNOW"]);
});

test("buildCollectionQueues ranks higher exposure (amount x overdue days) first", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1164C",
      customer_name: "Khaled Waleed",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 5311, due_date: "2025-12-25", overdue_days: 241 }],
      latest_collection: { payment_status: "NOT_PAID", saved_at: "2026-08-20T10:00:00Z" },
      legal_transfer: null,
    },
    {
      customer_code: "1209C",
      customer_name: "NOON SAVING",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 13566.32, due_date: "2026-02-08", overdue_days: 195 }],
      latest_collection: { payment_status: "NOT_PAID", saved_at: "2026-08-20T10:00:00Z" },
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["1209C", "1164C"]);
});

test("buildCollectionQueues ranks 1162C above 1042 when invoice-level exposure is higher", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1042",
      customer_name: "Al-Khamsa Al-Mumayaza Trading Company",
      invoices: [
        { pending_amount: 4132.68, overdue_days: 29 },
        { pending_amount: 3185.5, overdue_days: 75 },
        { pending_amount: 3811.45, overdue_days: 93 },
      ],
      latest_collection: { payment_status: "NOT_PAID", saved_at: "2026-08-20T10:00:00Z" },
      legal_transfer: null,
    },
    {
      customer_code: "1162C",
      customer_name: "Kanooz Al-Rayan Trading Establishment",
      invoices: [
        { pending_amount: 3134.74, overdue_days: 160 },
        { pending_amount: 3134.74, overdue_days: 112 },
      ],
      latest_collection: { payment_status: "NOT_PAID", saved_at: "2026-08-20T10:00:00Z" },
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.ok(queues.dueCustomers[0].exposure_score > queues.dueCustomers[1].exposure_score);
  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["1162C", "1042"]);
});

test("buildCollectionQueues orders future scheduled revisits by exposure in backend list", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "LATE",
      customer_name: "No Schedule",
      invoices: [{ pending_amount: 900, due_date: "2026-08-01", overdue_days: 17 }],
      latest_collection: { payment_status: "NOT_PAID" },
      legal_transfer: null,
    },
    {
      customer_code: "SOON",
      customer_name: "Future Revisit",
      invoices: [{ pending_amount: 500, due_date: "2026-08-01", overdue_days: 17 }],
      latest_collection: { payment_status: "PROMISED", next_visit_at: "2026-08-25" },
      legal_transfer: null,
    },
    {
      customer_code: "NEXT",
      customer_name: "Earlier Future Revisit",
      invoices: [{ pending_amount: 300, due_date: "2026-08-05", overdue_days: 13 }],
      latest_collection: { payment_status: "PROMISED", next_visit_at: "2026-08-20" },
      legal_transfer: null,
    },
  ], "2026-08-18T10:00:00Z");

  assert.deepEqual(
    queues.dueCustomers.map((row) => row.customer_code),
    ["LATE", "SOON", "NEXT"],
  );
});

test("buildCollectionQueues prioritizes higher exposure over visit status", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "UNVISITED_LOW",
      customer_name: "Unvisited Customer",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 300, due_date: "2026-08-05", overdue_days: 13 }],
      latest_collection: null,
      legal_transfer: null,
    },
    {
      customer_code: "1423",
      customer_name: "Al-Haram Plaza Company Limited",
      outstanding_cash: 0,
      invoices: [
        { pending_amount: 45581.07, overdue_days: 91 },
        { pending_amount: 1695.5, overdue_days: 120 },
      ],
      latest_collection: {
        payment_status: "NOT_PAID",
        visit_outcome: "COME_LATER",
        saved_at: "2026-08-18T10:00:00Z",
      },
      legal_transfer: null,
    },
  ], "2026-08-19T10:00:00Z");

  assert.equal(hasCollectionVisit(queues.dueCustomers[0]), true);
  assert.equal(hasCollectionVisit(queues.dueCustomers[1]), false);
  assert.deepEqual(
    queues.dueCustomers.map((row) => row.customer_code),
    ["1423", "UNVISITED_LOW"],
  );
});

test("isCashQueueCustomer separates cash due customers from the normal due queue", () => {
  const today = "2026-08-22";
  const cashDue = {
    customer_code: "1011C",
    invoices: [{ pending_amount: 5000, ref_no: "RC/001" }],
    latest_collection: null,
  };
  const scheduledCash = {
    customer_code: "1011C",
    invoices: [{ pending_amount: 5000, ref_no: "RC/001" }],
    latest_collection: {
      payment_status: "PROMISED",
      saved_at: "2026-08-20T10:00:00Z",
      next_visit_at: "2026-08-25",
    },
  };
  const creditOnly = {
    customer_code: "1416",
    invoices: [{ pending_amount: 6375, ref_no: "SI/1416" }],
    latest_collection: null,
  };

  assert.equal(isCashQueueCustomer(cashDue, today), true);
  assert.equal(isCashQueueCustomer(scheduledCash, today), false);
  assert.equal(isCashQueueCustomer(creditOnly, today), false);
});

test("sortCashQueueCustomers ranks higher cash due amount first", () => {
  const sorted = sortCashQueueCustomers([
    { customer_code: "LOW", outstanding_cash: 500, exposure_score: 1000 },
    { customer_code: "HIGH", outstanding_cash: 5000, exposure_score: 100 },
  ]);

  assert.deepEqual(sorted.map((row) => row.customer_code), ["HIGH", "LOW"]);
});

test("isScheduledRevisitQueueCustomer moves visited partial visits with future revisit out of due queue", () => {
  const today = "2026-08-22";
  const scheduled = {
    customer_code: "1423",
    latest_collection: {
      payment_status: "PARTIAL",
      saved_at: "2026-08-20T10:00:00Z",
      next_visit_at: "2026-08-25",
    },
  };
  const missingRevisit = {
    customer_code: "1423",
    latest_collection: {
      payment_status: "NOT_PAID",
      saved_at: "2026-08-20T10:00:00Z",
      next_visit_at: null,
    },
  };
  const paid = {
    customer_code: "9999",
    latest_collection: {
      payment_status: "PAID",
      saved_at: "2026-08-20T10:00:00Z",
      next_visit_at: "2026-08-25",
    },
  };

  assert.equal(isScheduledRevisitQueueCustomer(scheduled, today), true);
  assert.equal(isScheduledRevisitQueueCustomer(missingRevisit, today), false);
  assert.equal(isScheduledRevisitQueueCustomer(paid, today), false);
});

test("isExcludedCollectionQueueSalesman matches Zia and Asrar Ahmed with loose spelling", () => {
  assert.equal(isExcludedCollectionQueueSalesman("Zia"), true);
  assert.equal(isExcludedCollectionQueueSalesman("ZIA "), true);
  assert.equal(isExcludedCollectionQueueSalesman("Asrar Ahmed"), true);
  assert.equal(isExcludedCollectionQueueSalesman("ASRAR  AHMED"), true);
  assert.equal(isExcludedCollectionQueueSalesman("PARVEZ"), false);
});

test("filterCollectionQueueInvoices removes excluded salesman invoices only", () => {
  const filtered = filterCollectionQueueInvoices([
    { pending_amount: 100, salesman: "Zia" },
    { pending_amount: 200, salesman: "PARVEZ" },
    { pending_amount: 300, salesman: "Asrar Ahmed" },
  ]);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].salesman, "PARVEZ");
});

test("buildCollectionQueues drops customers with only excluded salesman invoices", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "C-ZIA",
      customer_name: "Zia Customer",
      invoices: [{ pending_amount: 200, due_date: "2026-08-01", salesman: "Zia" }],
    },
    {
      customer_code: "C-KEEP",
      customer_name: "Other Customer",
      invoices: [{ pending_amount: 200, due_date: "2026-08-01", salesman: "PARVEZ" }],
    },
  ], "2026-08-14T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["C-KEEP"]);
});