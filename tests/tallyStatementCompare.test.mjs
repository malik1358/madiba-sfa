import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSfaStatementEntries,
  compareTallyStatement,
  findTallyStatementHeader,
  parseTallyStatementMatrix,
  parseTallyStatementPositionedPages,
  reconcileStatementToOpenDelta,
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

test("RO-1076 is the fils rounding of voucher 1076 and both leave the mismatch list", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["27-08-2025", "Sales Non Food Division", "Sales", "1076", 1080, ""],
    ["28-08-2025", "Sales", "Sales", "1077", 500, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2025-08-27", voucher_number: "1076", amount_incl_vat: 1079.85 },
      { invoice_date: "2025-08-28", voucher_number: "1077", amount_incl_vat: 500 },
    ],
    receipts: [
      { receipt_date: "2025-08-27", vch_no: "RO-1076", amount: 0.15, vch_type: "Round Off" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.some((row) => row.voucher === "RO-1076"), false);
  assert.equal(result.rows.find((row) => row.voucher === "1076").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "1076").difference, 0);
  assert.equal(result.lead, null);
  assert.equal(result.totals.issueCount, 0);
  assert.equal(result.totals.agrees, true);
});

test("a round-off that is not the fils on that voucher stays in the mismatch list", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["27-08-2025", "Sales", "Sales", "1076", 1080, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2025-08-27", voucher_number: "1076", amount_incl_vat: 1000 },
    ],
    receipts: [
      { receipt_date: "2025-08-27", vch_no: "RO-1076", amount: 0.15, vch_type: "Round Off" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "1076").status, "amount");
  assert.equal(result.rows.some((row) => row.voucher === "RO-1076"), true);
  assert.equal(result.totals.agrees, false);
});

test("credit note 33 reversing sales 1583 drops both fils when they cross", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["02-11-2025", "Sales", "Sales", "1583", 1111, ""],
    ["02-11-2025", "Sales", "Sales", "1584", 1366, ""],
    ["02-11-2025", "Cr Sales Non Food Division", "Credit Note", "33", "", 1111],
  ]);
  const sfa = buildSfaStatementEntries({
    reversedInvoices: [{
      invoice_date: "2025-11-02",
      voucher_number: "1583",
      amount_incl_vat: 1110.9,
      credit_note_date: "2025-11-02",
      credit_note_voucher: "33",
      credit_note_amount: 1110.9,
    }],
    invoices: [
      { invoice_date: "2025-11-02", voucher_number: "1584", amount_incl_vat: 1366.2 },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "1583").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "33").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "1583").difference, 0);
  assert.equal(result.rows.find((row) => row.voucher === "33").difference, 0);
  assert.equal(result.rows.find((row) => row.voucher === "1584").status, "amount");
  assert.equal(result.rows.find((row) => row.voucher === "1584").difference, -0.2);
  assert.equal(result.lead.voucher, "1584");
});

test("sales 1825, its discount, and VAT-DG-1825 leave together when they net to zero", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["19-11-2025", "Sales Non Food Division - Stationery", "Sales", "1825", 18595.5, ""],
    ["19-11-2025", "Sales", "Sales", "1900", 400, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2025-11-19", voucher_number: "1825", amount_incl_vat: 18975 },
      { invoice_date: "2025-11-19", voucher_number: "1900", amount_incl_vat: 400 },
    ],
    receipts: [
      { receipt_date: "2025-11-19", vch_no: "1825", amount: 330, vch_type: "1825 Discount Given" },
      { receipt_date: "2025-11-19", vch_no: "VAT-DG-1825", amount: 49.5, vch_type: "1825 Discount Given" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "1825" && row.vchType === "Sales").status, "matched");
  assert.equal(result.rows.some((row) => row.voucher === "VAT-DG-1825" && row.status !== "matched"), false);
  assert.equal(result.rows.filter((row) => String(row.voucher).includes("1825") && row.status !== "matched").length, 0);
  assert.equal(result.rows.find((row) => row.voucher === "1900").status, "matched");
  assert.equal(result.lead, null);
  assert.equal(result.totals.agrees, true);
  assert.equal(result.totals.difference, 0);
});

test("a same-number discount that does not net to zero stays in the mismatch list", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["19-11-2025", "Sales", "Sales", "1825", 18595.5, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2025-11-19", voucher_number: "1825", amount_incl_vat: 18975 },
    ],
    receipts: [
      { receipt_date: "2025-11-19", vch_no: "1825", amount: 330, vch_type: "1825 Discount Given" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.filter((row) => row.status !== "matched").length, 2);
  assert.equal(result.totals.agrees, false);
});

test("discount and VAT on invoice 1769 cross the same lines on credit note 48", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["17-11-2025", "Sales", "Sales", "1769", 1000, ""],
    ["19-11-2025", "Credit Note", "Credit Note", "48", "", 1000],
  ]);
  const sfa = buildSfaStatementEntries({
    reversedInvoices: [{
      invoice_date: "2025-11-17",
      voucher_number: "1769",
      amount_incl_vat: 1000,
      credit_note_date: "2025-11-19",
      credit_note_voucher: "48",
      credit_note_amount: 1000,
    }],
    receipts: [
      { receipt_date: "2025-11-17", vch_no: "DG-1769", amount: -330, vch_type: "1769 Discount Given" },
      { receipt_date: "2025-11-17", vch_no: "VAT-DG-1769", amount: -49.5, vch_type: "1769 Discount Given" },
      { receipt_date: "2025-11-19", vch_no: "DG-48", amount: 330, vch_type: "48 Discount Given" },
      { receipt_date: "2025-11-19", vch_no: "VAT-DG-48", amount: 49.5, vch_type: "48 Discount Given" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  for (const voucher of ["DG-1769", "VAT-DG-1769", "DG-48", "VAT-DG-48"]) {
    assert.equal(result.rows.find((row) => row.voucher === voucher).status, "matched", voucher);
  }
  assert.equal(result.lead, null);
  assert.equal(result.totals.agrees, true);
});

test("the same discount lines stay when credit note 48 does not reverse invoice 1769", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["17-11-2025", "Sales", "Sales", "1769", 1000, ""],
    ["19-11-2025", "Sales", "Sales", "1900", 10, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2025-11-17", voucher_number: "1769", amount_incl_vat: 1000 },
      { invoice_date: "2025-11-19", voucher_number: "1900", amount_incl_vat: 10 },
    ],
    receipts: [
      { receipt_date: "2025-11-17", vch_no: "DG-1769", amount: -330, vch_type: "1769 Discount Given" },
      { receipt_date: "2025-11-19", vch_no: "DG-48", amount: 330, vch_type: "48 Discount Given" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "DG-1769").status, "sfa_only");
  assert.equal(result.rows.find((row) => row.voucher === "DG-48").status, "sfa_only");
});

test("Tally purchase 221 matches SFA P-221 once when the receipt register also has it", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["10-08-2026", "Local Purchase Non Food Division", "Purchase", "221", "", 520.72],
  ]);
  const sfa = buildSfaStatementEntries({
    receipts: [
      { receipt_date: "2026-08-10", vch_no: "P-221", amount: 520.72, vch_type: "Purchase" },
      { receipt_date: "2026-08-13", vch_no: "1444", amount: 345, vch_type: "Receipt" },
    ],
    purchases: [
      { purchase_date: "2026-08-10", vch_no: "P-221", amount: 520.72, vch_type: "Purchase" },
    ],
  });

  const result = compareTallyStatement(tally, sfa);
  const purchaseRows = result.rows.filter((row) => /221/.test(row.voucher));
  assert.equal(purchaseRows.length, 1);
  assert.equal(purchaseRows[0].status, "matched");
  assert.equal(purchaseRows[0].tallyCredit, 520.72);
  assert.equal(purchaseRows[0].sfaCredit, 520.72);
  assert.equal(result.totals.agrees, true);
  assert.equal(result.lead, null);
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

test("customer 1009 statement difference matches Open Δ and keeps ledger-only lines aside", () => {
  const row = (fields) => ({
    id: fields.voucher || fields.particulars,
    status: fields.status || "tally_only",
    date: fields.date || "2026-10-01",
    voucher: fields.voucher || "",
    vchType: fields.vchType || "",
    particulars: fields.particulars || "",
    tallyDebit: fields.tallyDebit || 0,
    tallyCredit: fields.tallyCredit || 0,
    sfaDebit: fields.sfaDebit || 0,
    sfaCredit: fields.sfaCredit || 0,
    difference: (fields.tallyDebit || 0) - (fields.tallyCredit || 0) - ((fields.sfaDebit || 0) - (fields.sfaCredit || 0)),
    leadsGap: false,
  });
  const rows = [
    row({ voucher: "1358", status: "amount", tallyDebit: 2349, sfaDebit: 2349.45, date: "2025-10-08" }),
    row({ voucher: "127", status: "sfa_only", sfaCredit: 2415, date: "2025-12-31" }),
    row({ voucher: "2446", status: "sfa_only", sfaDebit: 2415, date: "2026-01-04" }),
    row({ voucher: "", particulars: "Cr ROUND OFF", vchType: "Journal", tallyDebit: 1, date: "2026-02-10" }),
    row({ voucher: "NFD/980", tallyDebit: 4485, date: "2026-06-11" }),
    row({ voucher: "271", vchType: "Purchase", tallyCredit: 270, date: "2026-10-01" }),
    row({ voucher: "", particulars: "Receipt", status: "sfa_only", sfaCredit: 1.28, date: "2026-10-09" }),
    row({ voucher: "JV/Coll/2026/1108", vchType: "JV-Collection", tallyCredit: 1000, date: "2026-10-21" }),
    row({ voucher: "RNFD/603", tallyDebit: 3220, date: "2026-10-22" }),
  ];
  const reconciled = reconcileStatementToOpenDelta({
    rows,
    totals: { tallyNet: 10829.28, sfaNet: 4392.45, difference: 6436.83 },
  }, { machineOpen: 4392.45, tallyOpen: 8879.28 });

  assert.equal(reconciled.reconciledToOpenDelta, true);
  assert.equal(reconciled.totals.difference, -4486.83);
  assert.deepEqual(
    reconciled.bridgeRows.map((line) => line.voucher).sort(),
    ["271", "JV/Coll/2026/1108", "RNFD/603"],
  );
  assert.equal(
    reconciled.rows.some((line) => line.voucher === "NFD/980"),
    true,
  );
  assert.equal(
    Math.round(reconciled.rows.reduce((total, line) => total + line.difference, 0) * 100) / 100,
    -4486.83,
  );
});
