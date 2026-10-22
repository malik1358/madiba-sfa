import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSfaStatementEntries,
  compareTallyStatement,
  findTallyStatementHeader,
  parseTallyStatementMatrix,
  parseTallyStatementPositionedPages,
} from "../app/lib/tallyStatementCompare.js";

const HEADER = ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit"];

test("findTallyStatementHeader reads a Tally ledger export", () => {
  const header = findTallyStatementHeader([
    ["MADIBA"],
    HEADER,
  ]);
  assert.equal(header.headerRowIndex, 1);
  assert.equal(header.columns.date, 0);
  assert.equal(header.columns.vchNo, 3);
  assert.equal(header.columns.debit, 4);
  assert.equal(header.columns.credit, 5);
});

test("parseTallyStatementMatrix keeps vouchers and skips opening and closing", () => {
  const parsed = parseTallyStatementMatrix([
    HEADER,
    ["", "Opening Balance", "", "", 5000, ""],
    ["01-04-2026", "Sales", "Sales", "SI-101", 1150, ""],
    ["02-04-2026", "Receipt", "Receipt", "12", "", 500],
    ["", "Closing Balance", "", "", 5650, ""],
  ]);

  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.opening.side, "debit");
  assert.equal(parsed.opening.amount, 5000);
  assert.equal(parsed.closing.amount, 5650);
  assert.equal(parsed.entries[0].date, "2026-04-01");
  assert.equal(parsed.entries[0].voucher, "SI-101");
  assert.equal(parsed.entries[0].side, "debit");
  assert.equal(parsed.entries[1].side, "credit");
});

test("the first Tally voucher missing from SFA is the line that opens the gap", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["01-04-2026", "Sales", "Sales", "101", 1150, ""],
    ["02-04-2026", "Sales", "Sales", "102", 800, ""],
    ["03-04-2026", "Receipt", "Receipt", "12", "", 500],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-04-02", voucher_number: "102", amount_incl_vat: 800 },
    ],
    receipts: [
      { receipt_date: "2026-04-03", vch_no: "12", amount: 500 },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.lead.voucher, "101");
  assert.equal(result.lead.status, "tally_only");
  assert.equal(result.lead.leadsGap, true);
  assert.equal(result.totals.difference, 1150);
  assert.equal(result.totals.issueCount, 1);
  assert.equal(result.rows.filter((row) => row.status === "matched").length, 2);
});

test("an amount difference on a shared voucher is named before later matches", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["01-04-2026", "Sales", "Sales", "101", 1200, ""],
    ["02-04-2026", "Receipt", "Receipt", "12", "", 500],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-04-01", voucher_number: "101", amount_incl_vat: 1000 },
    ],
    receipts: [
      { receipt_date: "2026-04-02", vch_no: "12", amount: 500 },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.lead.voucher, "101");
  assert.equal(result.lead.status, "amount");
  assert.equal(result.lead.difference, 200);
  assert.equal(result.totals.difference, 200);
});

test("SFA vouchers outside the statement dates are not treated as mismatches", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["10-04-2026", "Sales", "Sales", "200", 400, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-01-01", voucher_number: "1", amount_incl_vat: 9000 },
      { invoice_date: "2026-04-10", voucher_number: "200", amount_incl_vat: 400 },
      { invoice_date: "2026-05-01", voucher_number: "9", amount_incl_vat: 50 },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.totals.agrees, true);
  assert.equal(result.lead, null);
  assert.equal(result.rows.length, 1);
});

test("a 15% scale across vouchers is reported as VAT, not a missing entry", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["01-04-2026", "Sales", "Sales", "1", 115, ""],
    ["02-04-2026", "Sales", "Sales", "2", 230, ""],
    ["03-04-2026", "Sales", "Sales", "3", 345, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-04-01", voucher_number: "1", amount_incl_vat: 100 },
      { invoice_date: "2026-04-02", voucher_number: "2", amount_incl_vat: 200 },
      { invoice_date: "2026-04-03", voucher_number: "3", amount_incl_vat: 300 },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.vatScale, "tally_gross");
  assert.equal(result.lead.status, "vat");
  assert.equal(result.rows.every((row) => row.status === "vat"), true);
});

test("a Tally PDF ledger treats the amount column as the customer side", () => {
  const page = [
    { x: 53, y: 581, width: 24, text: "Date" },
    { x: 96, y: 581, width: 50, text: "Particulars" },
    { x: 329, y: 581, width: 40, text: "Vch Type" },
    { x: 425, y: 581, width: 36, text: "Vch No." },
    { x: 501, y: 581, width: 28, text: "Debit" },
    { x: 563, y: 581, width: 30, text: "Credit" },
    { x: 39, y: 564, width: 62, text: "8-Sep-25 Cr" },
    { x: 92, y: 563, width: 180, text: "Sales Non Food Division - Stationery" },
    { x: 337, y: 564, width: 28, text: "Sales" },
    { x: 444, y: 564, width: 22, text: "1153" },
    { x: 498, y: 563, width: 30, text: "185.00" },
    { x: 39, y: 540, width: 62, text: "8-Oct-25 Dr" },
    { x: 92, y: 539, width: 140, text: "Non Food Division - Cash" },
    { x: 337, y: 540, width: 36, text: "Receipt" },
    { x: 450, y: 540, width: 16, text: "195" },
    { x: 562, y: 540, width: 30, text: "185.00" },
    { x: 79, y: 415, width: 14, text: "Dr" },
    { x: 111, y: 415, width: 70, text: "Closing Balance" },
    { x: 553, y: 415, width: 39, text: "7,795.50" },
  ];

  const parsed = parseTallyStatementPositionedPages([page]);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].date, "2025-09-08");
  assert.equal(parsed.entries[0].voucher, "1153");
  assert.equal(parsed.entries[0].side, "debit");
  assert.equal(parsed.entries[0].amount, 185);
  assert.equal(parsed.entries[1].side, "credit");
  assert.equal(parsed.entries[1].voucher, "195");
  assert.equal(parsed.closing.side, "debit");
  assert.equal(parsed.closing.amount, 7795.5);
});

test("a supplier payment is a debit and a purchase is a credit", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["01-06-2026", "Purchase", "Purchase", "P-165", "", 2880],
    ["02-06-2026", "Payment", "Payment", "PMT-9", 2880, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    receipts: [{ receipt_date: "2026-06-02", vch_no: "PMT-9", amount: -2880, vch_type: "Payment" }],
    purchases: [{ purchase_date: "2026-06-01", vch_no: "P-165", amount: 2880, vch_type: "Purchase" }],
  });
  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.totals.agrees, true);
  assert.equal(result.rows.every((row) => row.status === "matched"), true);
});

test("SI-101 in Tally matches voucher 101 in SFA", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["01-04-2026", "Sales", "Sales", "SI-101", 1150, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-04-01", voucher_number: "101", amount_incl_vat: 1150 },
    ],
  });
  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.totals.agrees, true);
  assert.equal(result.rows[0].status, "matched");
});
