import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionVisitSummary,
  isPriorityCollectionVisit,
  patchCollectionVisitSummaryVisitNumber,
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

test("patchCollectionVisitSummaryVisitNumber replaces stale visit numbers in stored summaries", () => {
  const stored = `Customer: Khaled Waleed Bin Salem Al Mahri Electronic Est.
Queue priority: 12.
Payment probability: High.
Code: 1164C
Salesman: Abdul Rehman
Outcome: Funds received
Amount received: 1,500.
Receipt mode: Cash.
Next visit: 31/08/2026.
Visit number today: 1.
Outstanding:
0-30: 0
31-60: 0
61-90: 0
91-120: 0
>120: 5,311`;

  const patched = patchCollectionVisitSummaryVisitNumber(stored, 11);
  assert.match(patched, /^Visit number today: 11\.$/m);
  assert.doesNotMatch(patched, /^Visit number today: 1\.$/m);
});
