import test from "node:test";
import assert from "node:assert/strict";

import {
  matchesCollectionCustomerQuery,
  mergeLegalMatchesIntoDueRows,
} from "../app/lib/collectionQueueSearch.js";
import { buildCollectionQueues } from "../app/lib/paymentCollections.js";

test("matchesCollectionCustomerQuery finds Art Mart by name tokens and compact text", () => {
  const row = {
    customer_code: "1071C",
    customer_name: "ART MART LIMITED",
    invoices: [{ ref_no: "2280", pending_amount: 2266 }],
  };

  assert.equal(matchesCollectionCustomerQuery(row, "art mart"), true);
  assert.equal(matchesCollectionCustomerQuery(row, "ARTMART"), true);
  assert.equal(matchesCollectionCustomerQuery(row, "1071c"), true);
  assert.equal(matchesCollectionCustomerQuery(row, "2280"), true);
  assert.equal(matchesCollectionCustomerQuery(row, "unknown party"), false);
});

test("matchesCollectionCustomerQuery uses outstanding invoice party name after code merge", () => {
  const row = {
    customer_code: "1071",
    customer_name: "شركة ارت مارت",
    invoices: [{
      customer_code: "1071C",
      customer_name: "1071C ART MART LIMITED",
      ref_no: "2280",
    }],
  };

  assert.equal(matchesCollectionCustomerQuery(row, "art mart"), true);
});

test("legal-transferred Art Mart still appears when searching the due queue", () => {
  const queues = buildCollectionQueues([
    {
      customer_code: "1071C",
      customer_name: "ART MART LIMITED",
      invoices: [{ pending_amount: 2266, due_date: "2026-01-22", overdue_days: 221, invoice_day: 249, ref_no: "2280" }],
      latest_collection: null,
      legal_transfer: { is_transferred: true, transferred_at: "2026-06-01T08:00:00Z" },
    },
  ], "2026-08-31T10:00:00Z");

  assert.equal(queues.dueCustomers.length, 0);
  assert.equal(queues.legalCustomers.length, 1);

  const legalMatches = queues.legalCustomers.filter((row) => matchesCollectionCustomerQuery(row, "art mart"));
  const visible = mergeLegalMatchesIntoDueRows([], legalMatches, "art mart");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].customer_code, "1071C");
});
