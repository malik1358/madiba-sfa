import test from "node:test";
import assert from "node:assert/strict";
import {
  badDebtReportEmailRecipients,
  buildBadDebtReportEmail,
  debtCustomerWasListed,
  groupBadDebtRowsBySalesman,
  markDebtRowsAddedToday,
} from "../app/lib/badDebtReportEmail.js";
import { runBadDebtReportEmailCycle } from "../app/lib/badDebtReportEmailServer.js";

const date = "2026-10-19";

function row(overrides = {}) {
  return {
    customerCode: "1001C",
    customerName: "Alpha Trading",
    salesman: "AHMED",
    cityArea: "Riyadh / Olaya",
    outstandingAbove120: 5000,
    totalOutstanding: 5100,
    transferredToLegal: false,
    transferredAt: "",
    legalNote: "",
    ...overrides,
  };
}

test("daily bad debt email goes to Malik, Fazlur, and Soyeb", () => {
  assert.deepEqual(badDebtReportEmailRecipients({}), [
    "malik@pinasz.com",
    "fazlur.rahiman@noorshukran.com",
    "soyeb@noorshukran.com",
  ]);
  assert.deepEqual(badDebtReportEmailRecipients({
    BAD_DEBT_REPORT_EMAIL_TEST_TO: "checker@example.com",
  }), ["checker@example.com"]);
});

test("salesman tables leave legal customers out and the legal table stays separate", () => {
  const badDebts = [
    row(),
    row({ customerCode: "1002", customerName: "Beta", salesman: "SALEH", outstandingAbove120: 800 }),
    row({ customerCode: "1004C", customerName: "Legal Hold", salesman: "AHMED", transferredToLegal: true, transferredAt: "2026-09-01" }),
  ];
  const legalTransfers = [
    row({ customerCode: "1004C", customerName: "Legal Hold", salesman: "AHMED", transferredToLegal: true, transferredAt: "2026-09-01", legalNote: "Court" }),
    row({ customerCode: "2001", customerName: "Cleared", salesman: "SALEH", transferredToLegal: true, outstandingAbove120: 0, transferredAt: date }),
  ];
  const groups = groupBadDebtRowsBySalesman(badDebts);
  assert.deepEqual(groups.map((group) => group.salesman), ["AHMED", "SALEH"]);
  assert.deepEqual(groups[0].rows.map((entry) => entry.customerCode), ["1001C"]);

  const message = buildBadDebtReportEmail({
    date,
    badDebts,
    legalTransfers,
    previousBadDebtCodes: ["1001C"],
    previousLegalCodes: ["1004C"],
  });
  assert.match(message.html, /AHMED \(1\)/);
  assert.match(message.html, /SALEH \(1\)/);
  assert.match(message.html, /Transferred to legal \(2\)/);
  assert.match(message.html, /Beta/);
  assert.equal((message.html.match(/Legal Hold/g) || []).length, 1);
  assert.match(message.html, />New</);
  assert.match(message.html, /#fff4c2/);
  assert.match(message.text, /NEW 1002/);
  assert.match(message.text, /NEW 2001/);
  assert.equal(message.addedToday, 2);
});

test("a customer already listed under a matching code is not new", () => {
  assert.equal(debtCustomerWasListed("1002C", ["1002"]), true);
  const [marked] = markDebtRowsAddedToday([
    row({ customerCode: "1002C", transferredAt: "2026-09-01" }),
  ], ["1002"], date);
  assert.equal(marked.isNewToday, false);
});

test("a legal transfer made today is highlighted before any snapshot exists", () => {
  const [marked] = markDebtRowsAddedToday([
    row({ customerCode: "3001", transferredToLegal: true, transferredAt: date }),
  ], null, date);
  assert.equal(marked.isNewToday, true);
});

test("email cycle sends one test without claiming the day and saves the snapshot", async () => {
  const sent = [];
  const saved = [];
  const result = await runBadDebtReportEmailCycle({}, {
    now: new Date("2026-10-19T12:00:00+03:00"),
    env: { BAD_DEBT_REPORT_EMAIL_FORCE: "true", SMTP_HOST: "smtp.example.com", SMTP_FROM: "reports@example.com" },
    force: true,
    send: async (message) => { sent.push(message); },
    loadReport: async () => ({
      badDebts: [row({ customerCode: "1002", customerName: "Beta", salesman: "SALEH" })],
      legalTransfers: [row({ customerCode: "3001", customerName: "Today Legal", transferredToLegal: true, transferredAt: date })],
    }),
    readSnapshot: async () => ({ badDebtCodes: [], legalCodes: [] }),
    saveSnapshot: async (_admin, snapshot) => { saved.push(snapshot); },
    claimSend: async () => { throw new Error("test send must not claim"); },
  });

  assert.equal(result.sentCount, 1);
  assert.deepEqual(result.to, [
    "malik@pinasz.com",
    "fazlur.rahiman@noorshukran.com",
    "soyeb@noorshukran.com",
  ]);
  assert.match(sent[0].subject, /^\[TEST\] Potential bad debts/);
  assert.equal(saved[0].date, date);
  assert.deepEqual(saved[0].badDebts.map((entry) => entry.customerCode), ["1002"]);
  assert.deepEqual(saved[0].legalTransfers.map((entry) => entry.customerCode), ["3001"]);
});

test("a claimed day does not send again", async () => {
  const result = await runBadDebtReportEmailCycle({}, {
    now: new Date("2026-10-19T12:00:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "reports@example.com" },
    send: async () => { throw new Error("should not send"); },
    claimSend: async () => null,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_claimed_or_sent");
});
