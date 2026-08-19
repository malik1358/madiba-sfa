import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionPriority,
  buildCollectionQueues,
  hasCollectionVisit,
  normalizeWhatsappNumber,
} from "../app/lib/paymentCollections.js";

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
      invoices: [{ pending_amount: 1000, due_date: "2026-08-20", overdue_days: 0, ref_no: "INV-9283-C" }],
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

test("buildCollectionQueues prioritizes cash-bucket customers at top", () => {
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

  assert.deepEqual(queues.dueCustomers.map((row) => row.customer_code), ["CASH", "NONCASH"]);
});

test("buildCollectionQueues prioritizes scheduled future revisits at top", () => {
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
    ["NEXT", "SOON", "LATE"],
  );
});

test("buildCollectionQueues prioritizes unvisited customers over visited ones", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "VISITED",
      customer_name: "Visited Customer",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 900, due_date: "2026-08-01", overdue_days: 17 }],
      latest_collection: {
        payment_status: "NOT_PAID",
        visit_outcome: "COME_LATER",
        saved_at: "2026-08-18T10:00:00Z",
      },
      legal_transfer: null,
    },
    {
      customer_code: "UNVISITED",
      customer_name: "Unvisited Customer",
      outstanding_cash: 0,
      invoices: [{ pending_amount: 300, due_date: "2026-08-05", overdue_days: 13 }],
      latest_collection: null,
      legal_transfer: null,
    },
  ], "2026-08-19T10:00:00Z");

  assert.equal(hasCollectionVisit(queues.dueCustomers[0]), false);
  assert.equal(hasCollectionVisit(queues.dueCustomers[1]), true);
  assert.deepEqual(
    queues.dueCustomers.map((row) => row.customer_code),
    ["UNVISITED", "VISITED"],
  );
});