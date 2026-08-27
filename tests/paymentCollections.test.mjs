import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionPriority,
  buildCollectionQueues,
  buildExposureScore,
  buildExposureScoreFromInvoices,
  collectionRowMatchesCustomerQuery,
  customerMatchesCollectionScope,
  canViewerSeeScheduledRevisit,
  canViewerSeeCollectorScheduledRevisit,
  redactCollectionVisitScheduleForViewer,
  filterCollectionQueueInvoices,
  hasCollectionVisit,
  invoiceHasCashRef,
  isCashOnlyQueueCustomer,
  isCashQueueCustomer,
  isExcludedCollectionQueueSalesman,
  isScheduledRevisitQueueCustomer,
  normalizeWhatsappNumber,
  sortCashQueueCustomers,
} from "../app/lib/paymentCollections.js";
import { buildSalesmanScopeMatchers, salesmanValueMatchesScope } from "../app/lib/mutualSalesmanGroups.js";
import { hydrateOutstandingInvoices } from "../app/lib/outstanding.js";

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

test("buildCollectionQueues includes 1235 Rokn Al-Muhareb overdue invoices", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1235",
      customer_name: "1235 Rokn Al-Muhareb Trading Company",
      invoices: [
        {
          ref_no: "RNFD/024",
          pending_amount: 2531,
          due_date: "2026-07-20",
          overdue_days: 37,
          invoice_day: 67,
          salesman: "Ahmed Nabil",
        },
        {
          ref_no: "RNFD/105",
          pending_amount: 1542,
          due_date: "2026-08-12",
          overdue_days: 14,
          invoice_day: 44,
          salesman: "ABDALLA ANTHANATH",
        },
      ],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-27T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(queues.dueCustomers[0].customer_code, "1235");
  assert.equal(queues.dueCustomers[0].total_due_amount, 4073);
  assert.equal(queues.dueCustomers[0].due_invoice_count, 2);
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

test("buildCollectionQueues keeps 1119C high-exposure credit customer in due queue", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1119C",
      customer_name: "Fahd Ali Sulaiman Al Subaie Trading Est",
      invoices: [{ pending_amount: 2805538, due_date: "2026-06-01", overdue_days: 82, ref_no: "SI/9901" }],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(queues.dueCustomers[0].customer_code, "1119C");
  assert.ok(queues.dueCustomers[0].exposure_score > 1_000_000);
  assert.equal(isCashQueueCustomer(queues.dueCustomers[0], "2026-08-22"), false);
});

test("hydrated aggregate-only outstanding rows place 1119C in due queue", () => {
  const invoices = hydrateOutstandingInvoices({
    invoices: [],
    rows: [{
      customer_code: "1119C  Fahd Ali Sulaiman Al Subaie Trading Est",
      customer_name: "1119C  Fahd Ali Sulaiman Al Subaie Trading Est",
      buckets: { ">120": 2805538 },
      total_outstanding: 2805538,
    }],
  });

  const queues = buildCollectionQueues([{
    customer_code: "1119C",
    customer_name: "Fahd Ali Sulaiman Al Subaie Trading Est",
    invoices,
    latest_collection: null,
    legal_transfer: null,
  }], "2026-08-22T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(queues.dueCustomers[0].customer_code, "1119C");
});

test("buildCollectionQueues keeps scheduled revisit credit customers in due queue data", () => {
  const today = "2026-08-22T10:00:00Z";
  const queues = buildCollectionQueues([
    {
      customer_code: "1119C",
      customer_name: "Fahd Ali Sulaiman Al Subaie Trading Est",
      invoices: [{ pending_amount: 2805538, due_date: "2026-06-01", overdue_days: 82, ref_no: "SI/9901" }],
      latest_collection: {
        saved_at: "2026-08-20T10:00:00Z",
        payment_status: "PARTIAL",
        next_visit_at: "2026-08-25",
      },
      legal_transfer: null,
    },
  ], today);

  assert.equal(queues.dueCustomers.length, 1);
  assert.equal(isScheduledRevisitQueueCustomer(queues.dueCustomers[0], today), true);
  assert.equal(isCashQueueCustomer(queues.dueCustomers[0], today), false);
});

test("buildCollectionQueues keeps 1119C with future due date in not-yet-due queue", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1119C",
      customer_name: "Fahd Ali Sulaiman Al Subaie Trading Est",
      invoices: [{ pending_amount: 2805538, due_date: "2026-09-01", overdue_days: 0, ref_no: "SI/9901" }],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-22T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 0);
  assert.equal(queues.notDueCustomers.length, 1);
  assert.equal(queues.notDueCustomers[0].total_not_due_amount, 2805538);
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

test("isCashOnlyQueueCustomer keeps mixed cash and overdue credit customers in both queues", () => {
  const today = "2026-08-22";
  const mixed = {
    customer_code: "1041",
    customer_name: "AL KHAMIS ARABIYA TRADING Co.",
    outstanding_cash: 4186,
    invoices: [
      { pending_amount: 4186, ref_no: "RC/058", due_date: "2026-09-05", overdue_days: 0 },
      { pending_amount: 2347, ref_no: "NFD/593", due_date: "2026-05-30", overdue_days: 82 },
      { pending_amount: 653, ref_no: "NFD/800", due_date: "2026-06-16", overdue_days: 65 },
    ],
    latest_collection: null,
  };
  const cashOnly = {
    customer_code: "1011C",
    invoices: [{ pending_amount: 5000, ref_no: "RC/001", due_date: "2026-08-24", overdue_days: 0 }],
    latest_collection: null,
  };

  assert.equal(isCashQueueCustomer(mixed, today), true);
  assert.equal(isCashOnlyQueueCustomer(mixed, today), false);
  assert.equal(isCashOnlyQueueCustomer(cashOnly, today), true);
});

test("sortCashQueueCustomers ranks higher cash due amount first", () => {
  const sorted = sortCashQueueCustomers([
    { customer_code: "LOW", outstanding_cash: 500, exposure_score: 1000 },
    { customer_code: "HIGH", outstanding_cash: 5000, exposure_score: 100 },
  ]);

  assert.deepEqual(sorted.map((row) => row.customer_code), ["HIGH", "LOW"]);
});

test("isScheduledRevisitQueueCustomer includes overdue revisit dates not yet visited", () => {
  const today = "2026-08-24";
  const overdue = {
    customer_code: "1005",
    latest_collection: {
      payment_status: "NOT_PAID",
      saved_at: "2026-08-20T10:00:00Z",
      next_visit_at: "2026-08-22",
    },
  };

  assert.equal(isScheduledRevisitQueueCustomer(overdue, today), true);
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

test("buildCollectionQueues includes Abdalla overdue invoices with Excel month-name dates", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1435",
      customer_name: "Toot Al-Noor Trading Establishment",
      salesman_name: "ABDALLA ANTHANATH",
      invoices: [
        { ref_no: "NFD/478", pending_amount: 2031, due_date: "23-May-26", salesman: "ABDALLA ANTHANATH" },
        { ref_no: "RNFD/055", pending_amount: 1140, due_date: "29-Jul-26", salesman: "ABDALLA ANTHANATH" },
      ],
    },
  ], "2026-08-27T10:00:00Z");

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["1435"]);
  assert.equal(queues.dueCustomers[0].due_invoice_count, 2);
  assert.equal(queues.dueCustomers[0].total_due_amount, 3171);
});

test("collectionRowMatchesCustomerQuery finds 1435 in code, name prefix, and 1435C", () => {
  assert.equal(collectionRowMatchesCustomerQuery({
    customer_code: "1435",
    customer_name: "Toot Al-Noor Trading Establishment",
  }, "1435"), true);
  assert.equal(collectionRowMatchesCustomerQuery({
    customer_code: "1435C",
    customer_name: "Toot Al-Noor Trading Establishment",
  }, "1435"), true);
  assert.equal(collectionRowMatchesCustomerQuery({
    customer_code: "",
    customer_name: "1435 Toot Al-Noor Trading Establishment",
  }, "1435"), true);
  assert.equal(collectionRowMatchesCustomerQuery({
    customer_code: "1209",
    customer_name: "Other Customer",
  }, "1435"), false);
});

test("customerMatchesCollectionScope lets Soyeb see Abdalla invoices when hasAllAccess", () => {
  const soyebScope = buildSalesmanScopeMatchers([
    { salesman_code: "ST103", salesman_name: "SOYEB" },
    { salesman_code: "JUNAID", salesman_name: "Junaid" },
    { salesman_code: "PARVEZ", salesman_name: "Parvez" },
  ]);
  const abdallaCustomer = {
    customer: { current_salesman_code: "ABDALLA" },
    customerInvoices: [{ salesman: "ABDALLA ANTHANATH", pending_amount: 2031 }],
    scopeMatchers: soyebScope,
    normalizedScopeCodes: ["ST103", "JUNAID", "PARVEZ", "SOYEB"],
  };

  assert.equal(customerMatchesCollectionScope({
    ...abdallaCustomer,
    hasAllAccess: false,
  }), false);
  assert.equal(customerMatchesCollectionScope({
    ...abdallaCustomer,
    hasAllAccess: true,
  }), true);
});

test("customerMatchesCollectionScope prefers outstanding invoice salesman over customer master", () => {
  const abdulScope = buildSalesmanScopeMatchers([
    { salesman_code: "ABDUL REHMAN", salesman_name: "ABDUL REHMAN" },
  ]);

  assert.equal(customerMatchesCollectionScope({
    customer: { current_salesman_code: "ABDUL REHMAN" },
    customerInvoices: [{ salesman: "Parvez", pending_amount: 1000 }],
    scopeMatchers: abdulScope,
    normalizedScopeCodes: ["ABDUL REHMAN"],
    hasAllAccess: false,
  }), false);

  const parvezScope = buildSalesmanScopeMatchers([
    { salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" },
  ]);

  assert.equal(customerMatchesCollectionScope({
    customer: { current_salesman_code: "ABDUL REHMAN" },
    customerInvoices: [{ salesman: "Parvez", pending_amount: 1000 }],
    scopeMatchers: parvezScope,
    normalizedScopeCodes: ["PARVEZ"],
    hasAllAccess: false,
  }), true);
});

test("customerMatchesCollectionScope falls back to customer master when invoice salesman is missing", () => {
  const abdulScope = buildSalesmanScopeMatchers([
    { salesman_code: "ABDUL REHMAN", salesman_name: "ABDUL REHMAN" },
  ]);

  assert.equal(customerMatchesCollectionScope({
    customer: { current_salesman_code: "ABDUL REHMAN" },
    customerInvoices: [{ salesman: "", pending_amount: 1000 }],
    scopeMatchers: abdulScope,
    normalizedScopeCodes: ["ABDUL REHMAN"],
    hasAllAccess: false,
  }), true);
});

test("scoped salesman matchers exclude other salesmen such as Ahmed Nabil", () => {
  const abdulScope = buildSalesmanScopeMatchers([
    { salesman_code: "ABDUL REHMAN", salesman_name: "ABDUL REHMAN" },
  ]);

  assert.equal(salesmanValueMatchesScope("ABDUL REHMAN", abdulScope), true);
  assert.equal(salesmanValueMatchesScope("Ahmed Nabil", abdulScope), false);
  assert.equal(customerMatchesCollectionScope({
    customer: { current_salesman_code: "ABDUL REHMAN" },
    customerInvoices: [{ salesman: "Ahmed Nabil", pending_amount: 4186 }],
    scopeMatchers: abdulScope,
    normalizedScopeCodes: ["ABDUL REHMAN"],
    hasAllAccess: false,
  }), false);
});

test("customerMatchesCollectionScope honors aggregate outstanding row salesman for team salesmen", () => {
  const parvezScope = buildSalesmanScopeMatchers([
    { salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" },
    { salesman_code: "JUNAID", salesman_name: "Junaid (JUNAID)" },
    { salesman_code: "SOYEB", salesman_name: "Soyeb (SOYEB)" },
  ]);

  assert.equal(customerMatchesCollectionScope({
    customer: { current_salesman_code: "ABDUL REHMAN" },
    customerInvoices: [{ salesman: "Ahmed Nabil", pending_amount: 5000 }],
    aggregateRowSalesman: "Parvez",
    scopeMatchers: parvezScope,
    normalizedScopeCodes: ["PARVEZ", "JUNAID", "SOYEB"],
    hasAllAccess: false,
  }), true);
});

test("canViewerSeeScheduledRevisit hides other users schedules from salesmen", () => {
  const visit = {
    created_by: "collector-user-1",
    scheduled_by_id: "collector-user-1",
    next_visit_at: "2026-08-20",
  };

  assert.equal(canViewerSeeScheduledRevisit(visit, null, {
    userId: "collector-user-1",
    visibleSchedulerUserIds: ["collector-user-1"],
  }), true);

  assert.equal(canViewerSeeScheduledRevisit(visit, null, {
    userId: "abdul-user",
    visibleSchedulerUserIds: ["abdul-user"],
  }), false);

  assert.equal(canViewerSeeScheduledRevisit(visit, null, {
    userId: "manager-user",
    canSeeAllSchedulers: true,
  }), true);
});

test("canViewerSeeCollectorScheduledRevisit delegates to scheduled revisit visibility", () => {
  const collectorProfile = { role: "collector", salesman_code: "SM001" };
  const visit = {
    created_by: "collector-user-1",
    next_visit_at: "2026-08-20",
  };

  assert.equal(canViewerSeeCollectorScheduledRevisit(visit, collectorProfile, {
    userId: "salesman-user",
    visibleSchedulerUserIds: ["salesman-user"],
  }), false);
});

test("redactCollectionVisitScheduleForViewer removes next visit date for unauthorized viewers", () => {
  const collectorProfile = { role: "collector", salesman_code: "SM001" };
  const visit = {
    created_by: "collector-user-1",
    next_visit_at: "2026-08-20",
    payment_status: "PROMISED",
  };

  const redacted = redactCollectionVisitScheduleForViewer(visit, collectorProfile, {
    userId: "salesman-user",
    visibleSchedulerUserIds: ["salesman-user"],
  });

  assert.equal(redacted.next_visit_at, null);
  assert.equal(redacted.payment_status, "PROMISED");
});
