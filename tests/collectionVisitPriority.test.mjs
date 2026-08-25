import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionQueuePriorityMaps,
  extractQueuePriorityFromSummary,
  resolveVisitPriorityMeta,
} from "../app/lib/collectionVisitPriority.js";

test("extractQueuePriorityFromSummary reads queue rank from saved WhatsApp text", () => {
  const summary = "Customer: Acme\nQueue priority: 8.\nPayment probability: Medium.\nOutcome: Paid";
  assert.equal(extractQueuePriorityFromSummary(summary), 8);
});

test("resolveVisitPriorityMeta reconstructs queue rank and flags off-priority visits", () => {
  const today = "2026-08-24T12:00:00";
  const records = [{
    customer_code: "1053",
    customer_name: "AL RABEE",
    invoices: [{ pending_amount: 2046, due_date: "2026-07-01", ref_no: "SI/1" }],
    latest_collection: null,
    legal_transfer: null,
    outstanding_0_30: 0,
    outstanding_30_60: 2046,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  }, {
    customer_code: "2001",
    customer_name: "Higher Priority",
    invoices: [{ pending_amount: 50000, due_date: "2026-05-01", ref_no: "SI/2" }],
    latest_collection: null,
    legal_transfer: null,
    outstanding_0_30: 0,
    outstanding_30_60: 0,
    outstanding_61_90: 50000,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  }];

  const maps = buildCollectionQueuePriorityMaps(records, today);
  const meta = resolveVisitPriorityMeta({
    customer_code: "1053",
    summary_text: "",
  }, maps, {
    reportDate: "2026-08-24",
    visitNumberForDay: 6,
  });

  assert.ok(meta.queuePriority > 0);
  assert.ok(["High", "Medium", "Low"].includes(meta.probabilityLabel));
  assert.equal(meta.prioritySource, "reconstructed");

  const offPriority = resolveVisitPriorityMeta({
    customer_code: "1053",
  }, {
    ...maps,
    dueQueuePriority: new Map([["1053", 25]]),
    visibleDueQueuePriority: new Map([["1053", 25]]),
  }, {
    reportDate: "2026-08-24",
    visitNumberForDay: 6,
  });
  assert.equal(offPriority.queueCompliance, "off_priority");
});

test("resolveVisitPriorityMeta prefers visible due queue rank over incorrect stored priority", () => {
  const maps = {
    visibleDueQueuePriority: new Map([["1301", 57], ["1071C", 26]]),
    dueQueuePriority: new Map([["1301", 57], ["1071C", 26]]),
    cashQueuePriority: new Map([["1301", 1]]),
    probabilityByCode: new Map(),
    recordByCode: new Map(),
    dueQueueSize: 57,
  };

  const meta = resolveVisitPriorityMeta({
    customer_code: "1301",
    queue_priority: 1,
    visit_number_for_day: 1,
  }, maps, {
    reportDate: "2026-08-24",
    visitNumberForDay: 1,
  });

  assert.equal(meta.queuePriority, 57);
  assert.equal(meta.prioritySource, "reconstructed");
});
