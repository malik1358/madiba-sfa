import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLegalTransferRows,
  buildPotentialBadDebtRows,
  fundsReceivedWindow,
  isFundsReceivedVisit,
  sumFundsReceivedInWindow,
  summarizeDebtRows,
} from "../app/lib/badDebtReport.js";

const todayKey = "2026-10-19";

function record(overrides = {}) {
  return {
    customer_code: "1001C",
    customer_name: "Alpha Trading",
    salesman_name: "AHMED",
    city: "Riyadh",
    area: "Olaya",
    outstanding_0_30: 100,
    outstanding_above_120: 5000,
    ...overrides,
  };
}

test("funds received window is ten KSA days including today", () => {
  assert.deepEqual(fundsReceivedWindow(todayKey, 10), {
    today: "2026-10-19",
    start: "2026-10-10",
    days: 10,
  });
});

test("only Funds Received amounts inside the window count", () => {
  const visits = [
    { customer_code: "1001C", visit_outcome: "FUNDS_RECEIVED", amount_received: 250, saved_at: "2026-10-10T06:00:00.000Z" },
    { customer_code: "1001C", visit_outcome: "FUNDS_RECEIVED", amount_received: 40, saved_at: "2026-10-09T18:00:00.000Z" },
    { customer_code: "1001C", visit_outcome: "NOT_PAID", amount_received: 999, saved_at: "2026-10-18T10:00:00.000Z" },
    { customer_code: "1001C", visit_outcome: "FUNDS_RECEIVED", amount_received: 0, saved_at: "2026-10-18T10:00:00.000Z" },
  ];
  assert.equal(isFundsReceivedVisit(visits[0]), true);
  assert.equal(sumFundsReceivedInWindow(visits, { todayKey }), 250);
});

test("potential bad debts keep >120 with no recent funds and flag legal", () => {
  const rows = buildPotentialBadDebtRows([
    record(),
    record({
      customer_code: "1002",
      customer_name: "Paid Recently",
      outstanding_above_120: 800,
    }),
    record({
      customer_code: "1003C",
      customer_name: "Current Only",
      outstanding_above_120: 0,
      outstanding_91_120: 9000,
    }),
    record({
      customer_code: "1004C",
      customer_name: "Legal Hold",
      outstanding_above_120: 1200,
    }),
  ], {
    todayKey,
    fundsReceived: [
      { customer_code: "1002C", visit_outcome: "FUNDS_RECEIVED", amount_received: 50, saved_at: "2026-10-15T12:00:00.000Z" },
    ],
    transfers: [
      { customer_code: "1004", is_transferred: true, transferred_at: "2026-09-01T10:00:00.000Z", transferred_by: "user-1", note: "Court" },
      { customer_code: "1001C", is_transferred: false, transferred_at: "2026-08-01T10:00:00.000Z", note: "Returned" },
    ],
    actorNames: { "user-1": "MALIK" },
  });

  assert.deepEqual(rows.map((row) => row.customerCode), ["1001C", "1004C"]);
  assert.equal(rows[0].transferredToLegal, false);
  assert.equal(rows[0].totalOutstanding, 5100);
  assert.equal(rows[1].transferredToLegal, true);
  assert.equal(rows[1].transferredAt, "2026-09-01");
  assert.equal(rows[1].transferredBy, "MALIK");
  assert.equal(rows[1].legalNote, "Court");
  assert.equal(summarizeDebtRows(rows).transferredToLegal, 1);
  assert.equal(summarizeDebtRows(rows).outstandingAbove120, 6200);
});

test("legal report lists every active transfer even without >120 debt", () => {
  const rows = buildLegalTransferRows({
    todayKey,
    transfers: [
      { customer_code: "2001C", is_transferred: true, transferred_at: "2026-10-02T08:00:00.000Z", note: "Old file" },
      { customer_code: "2001", is_transferred: true, transferred_at: "2026-09-01T08:00:00.000Z", note: "Duplicate code" },
      { customer_code: "2002", is_transferred: false, transferred_at: "2026-10-18T08:00:00.000Z", note: "Back" },
      { customer_code: "2003", is_transferred: true, transferred_at: "2026-10-11T08:00:00.000Z", transferred_by: "user-2", note: "New" },
    ],
    records: [
      record({ customer_code: "2003", customer_name: "Still Owing", outstanding_above_120: 300, outstanding_0_30: 0 }),
    ],
    customers: [
      { customer_code: "2001C", customer_name: "Cleared Legal", current_salesman_code: "SALEH", city: "Jeddah", area: "" },
    ],
    fundsReceived: [
      { customer_code: "2003", visit_outcome: "FUNDS_RECEIVED", amount_received: 75, saved_at: "2026-10-12T09:00:00.000Z" },
    ],
    actorNames: { "user-2": "SOYEB" },
  });

  assert.deepEqual(rows.map((row) => row.customerCode), ["2003", "2001C"]);
  assert.equal(rows[0].customerName, "Still Owing");
  assert.equal(rows[0].receivedLast10Days, 75);
  assert.equal(rows[0].transferredBy, "SOYEB");
  assert.equal(rows[1].customerName, "Cleared Legal");
  assert.equal(rows[1].salesman, "SALEH");
  assert.equal(rows[1].cityArea, "Jeddah");
  assert.equal(rows[1].outstandingAbove120, 0);
  assert.equal(rows[1].legalNote, "Old file");
});

test("rows keep the oldest open invoice and the later visit", () => {
  const rows = buildPotentialBadDebtRows([
    record({
      invoices: [
        { pending_amount: 100, invoice_day: 140 },
        { pending_amount: 50, invoice_date: "2026-01-01" },
        { pending_amount: 0, invoice_day: 900 },
      ],
      latest_collection: {
        saved_at: "2026-09-20T08:00:00+03:00",
        remark_english: "Old promise",
        created_by: "user-old",
      },
    }),
  ], {
    todayKey,
    todayIso: "2026-10-19T12:00:00+03:00",
    actorNames: { "user-new": "FAZLUR" },
    visits: [{
      at: "2026-10-11T15:00:00+03:00",
      remark: "Shop closed",
      personId: "user-new",
      personName: "",
      customerCode: "1001",
    }],
  });

  assert.equal(rows[0].oldestInvoiceDays, 291);
  assert.equal(rows[0].lastVisitDate, "2026-10-11");
  assert.equal(rows[0].lastVisitPerson, "FAZLUR");
  assert.equal(rows[0].lastVisitRemark, "Shop closed");
});
