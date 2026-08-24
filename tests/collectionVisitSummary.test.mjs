import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionVisitSummary,
  isPriorityCollectionVisit,
} from "../app/lib/collectionVisitSummary.js";

test("isPriorityCollectionVisit marks high and medium probability as priority", () => {
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "High" }).isPriority, true);
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "Medium" }).isPriority, true);
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "Low" }).isPriority, false);
  assert.equal(isPriorityCollectionVisit({ queuePriority: 4 }).isPriority, true);
});

test("buildCollectionVisitSummary includes queue priority and outstanding buckets", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_name: "Acme Trading",
      customer_code: "1009",
      salesman_name: "Junaid",
      outstanding_0_30: 1000,
      outstanding_30_60: 2000,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "500",
      receiptMode: "CASH",
      nextVisitAt: "2026-08-30",
      remarkArabic: "",
      remarkEnglish: "",
    },
    { queuePriority: 3, visitNumberForDay: 2 },
  );

  assert.match(summary, /Queue priority: 3/);
  assert.match(summary, /Customer: Acme Trading/);
  assert.match(summary, /0-30: 1,000/);
  assert.match(summary, /Visit number today: 2/);
});
