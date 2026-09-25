import test from "node:test";
import assert from "node:assert/strict";
import { reconcileAppReceiptsToTally } from "../app/lib/receiptsNotInTally.js";

test("reconcileAppReceiptsToTally finds app visits missing from Tally", () => {
  const result = reconcileAppReceiptsToTally({
    appVisits: [
      {
        id: "v1",
        customer_code: "1006",
        customer_name: "ABDULLAH HAMAD",
        amount_received: 500,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-01",
        saved_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "v2",
        customer_code: "1144",
        customer_name: "HELAL ALSAIF",
        amount_received: 837.2,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-02",
        saved_at: "2026-03-02T11:00:00.000Z",
      },
      {
        id: "v3",
        customer_code: "2001",
        customer_name: "ONLY IN APP",
        amount_received: 100,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-03",
        saved_at: "2026-03-03T12:00:00.000Z",
      },
    ],
    tallyReceipts: [
      {
        receipt_date: "2026-03-01",
        customer_code: "1006",
        customer_name: "ABDULLAH HAMAD",
        amount: 500,
        vch_no: "1",
      },
      {
        receipt_date: "2026-03-02",
        customer_code: "1144",
        customer_name: "HELAL ALSAIF",
        amount: 837.2,
        vch_no: "45",
      },
    ],
  });

  assert.equal(result.appCount, 3);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.missingInTally[0].id, "v3");
  assert.equal(result.missingTotal, 100);
});

test("reconcileAppReceiptsToTally matches within date window and consumes each Tally row once", () => {
  const result = reconcileAppReceiptsToTally({
    windowDays: 1,
    appVisits: [
      {
        id: "a",
        customer_code: "1006",
        customer_name: "ABDULLAH",
        amount_received: 200,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-10",
      },
      {
        id: "b",
        customer_code: "1006",
        customer_name: "ABDULLAH",
        amount_received: 200,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-11",
      },
    ],
    tallyReceipts: [
      {
        receipt_date: "2026-03-11",
        customer_code: "1006",
        customer_name: "ABDULLAH",
        amount: 200,
        vch_no: "9",
      },
    ],
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.matched[0].visit.id, "b");
  assert.equal(result.matched[0].dayGap, 0);
  assert.equal(result.missingInTally[0].id, "a");
});

test("reconcileAppReceiptsToTally rejects amount mismatches beyond tolerance", () => {
  const result = reconcileAppReceiptsToTally({
    appVisits: [
      {
        id: "v1",
        customer_code: "1006",
        customer_name: "ABDULLAH",
        amount_received: 500,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-03-01",
      },
    ],
    tallyReceipts: [
      {
        receipt_date: "2026-03-01",
        customer_code: "1006",
        customer_name: "ABDULLAH",
        amount: 498,
        vch_no: "1",
      },
    ],
  });

  assert.equal(result.matchedCount, 0);
  assert.equal(result.missingCount, 1);
});

test("reconcileAppReceiptsToTally matches same trading name with small amount difference", () => {
  const result = reconcileAppReceiptsToTally({
    appVisits: [
      {
        id: "app-1108",
        customer_code: "1108",
        customer_name: "Dar Rayhana Trading Establishment",
        amount_received: 4896,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-09-01",
      },
    ],
    tallyReceipts: [
      {
        receipt_date: "2026-09-01",
        customer_code: "1106",
        customer_name: "Dar Rayhana Trading Establishment",
        particulars: "1106 Dar Rayhana Trading Establishment",
        amount: 4895.9,
        vch_no: "1599",
      },
    ],
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.missingCount, 0);
  assert.equal(result.matched[0].tally.vch_no, "1599");
});

test("reconcileAppReceiptsToTally hides near-duplicate app visits by same collector", () => {
  const result = reconcileAppReceiptsToTally({
    appVisits: [
      {
        id: "first",
        customer_code: "1441",
        customer_name: "Jazeerat Al-Tawfeer",
        amount_received: 3674,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-09-18",
        saved_at: "2026-09-17T22:30:00.000Z",
        created_by: "collector-1",
      },
      {
        id: "dup",
        customer_code: "1441",
        customer_name: "Jazeerat Al-Tawfeer",
        amount_received: 3674,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-09-18",
        saved_at: "2026-09-17T22:30:20.000Z",
        created_by: "collector-1",
      },
    ],
    tallyReceipts: [],
  });

  assert.equal(result.appCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.missingInTally[0].id, "first");
  assert.equal(result.missingTotal, 3674);
  assert.equal(result.duplicatesDropped[0].duplicateOf, "first");
});

test("reconcileAppReceiptsToTally keeps separate visits outside the duplicate window", () => {
  const result = reconcileAppReceiptsToTally({
    appVisits: [
      {
        id: "morning",
        customer_code: "1441",
        customer_name: "Jazeerat Al-Tawfeer",
        amount_received: 3674,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-09-18",
        saved_at: "2026-09-18T08:00:00.000Z",
        created_by: "collector-1",
      },
      {
        id: "afternoon",
        customer_code: "1441",
        customer_name: "Jazeerat Al-Tawfeer",
        amount_received: 3674,
        visit_outcome: "FUNDS_RECEIVED",
        visit_date: "2026-09-18",
        saved_at: "2026-09-18T10:00:00.000Z",
        created_by: "collector-1",
      },
    ],
    tallyReceipts: [],
  });

  assert.equal(result.appCount, 2);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.missingCount, 2);
});
