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

test("the same voucher keeps its own debit even when every bill differs by 15%", () => {
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
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.every((row) => row.status === "amount"), true);
  assert.deepEqual(result.rows.map((row) => row.difference), [15, 30, 45]);
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

test("a Tally PDF with plain amounts and To/By markers still reads each line", () => {
  const page = [
    { x: 137.9, y: 717.2, width: 22, text: "Date" },
    { x: 192.2, y: 717.1, width: 52, text: "Particulars" },
    { x: 335.4, y: 717.2, width: 40, text: "Vch Type" },
    { x: 442, y: 717.2, width: 36, text: "Vch No." },
    { x: 483.5, y: 717.1, width: 24, text: "Debit" },
    { x: 519.8, y: 717.1, width: 28, text: "Credit" },
    { x: 122.8, y: 706.8, width: 48, text: "15-Apr-26" },
    { x: 154.6, y: 706.2, width: 12, text: "To" },
    { x: 167.9, y: 706, width: 140, text: "Sales Non Food Division - Building Material" },
    { x: 335.4, y: 706.7, width: 90, text: "SALES-NON FOOD DIVISION" },
    { x: 439, y: 706.8, width: 40, text: "NFD/436" },
    { x: 473.8, y: 706, width: 25.8, text: "7966.05" },
    { x: 122.6, y: 665, width: 48, text: "29-Jun-26" },
    { x: 154.6, y: 664.4, width: 12, text: "By" },
    { x: 167.9, y: 664.2, width: 140, text: "Alrajhi Bank (525000010006080575484) SAR" },
    { x: 335.4, y: 664.9, width: 36, text: "Receipt" },
    { x: 450.5, y: 665, width: 22, text: "1143" },
    { x: 508.7, y: 664.2, width: 29.8, text: "19550.00" },
    { x: 154.6, y: 487, width: 12, text: "By" },
    { x: 205.7, y: 486.7, width: 70, text: "Closing Balance" },
    { x: 508.7, y: 487, width: 29.8, text: "84180.00" },
  ];

  const parsed = parseTallyStatementPositionedPages([page]);
  assert.equal(parsed.error, "");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].date, "2026-04-15");
  assert.equal(parsed.entries[0].voucher, "NFD/436");
  assert.equal(parsed.entries[0].side, "debit");
  assert.equal(parsed.entries[0].amount, 7966.05);
  assert.equal(parsed.entries[0].particulars.includes("To"), false);
  assert.equal(parsed.entries[1].date, "2026-06-29");
  assert.equal(parsed.entries[1].side, "credit");
  assert.equal(parsed.entries[1].amount, 19550);
  assert.equal(parsed.entries[1].voucher, "1143");
  assert.equal(parsed.closing.side, "credit");
  assert.equal(parsed.closing.amount, 84180);
});

test("a Tally pending bill is compared with the SFA sales amount, not the open balance", () => {
  const page = [
    { x: 266.8, y: 713.5, width: 91, text: "Bills Receivable" },
    { x: 281, y: 674.6, width: 63, text: "Pending Bills" },
    { x: 563.2, y: 658.3, width: 29, text: "Page 4" },
    { x: 56.2, y: 646.7, width: 22, text: "Date" },
    { x: 94.1, y: 647, width: 37, text: "Ref. No." },
    { x: 361.1, y: 647.9, width: 54, text: "Sales Person" },
    { x: 475.3, y: 646.7, width: 39, text: "Pending" },
    { x: 526.8, y: 647, width: 32, text: "Due on" },
    { x: 564.5, y: 647, width: 27, text: "Overdue" },
    { x: 477.2, y: 634.8, width: 37, text: "Amount" },
    { x: 564.5, y: 635.2, width: 27, text: "by days" },
    { x: 39.4, y: 617.2, width: 38, text: "27-Jun-26" },
    { x: 94.1, y: 617.5, width: 45, text: "NFD/1030" },
    { x: 361.1, y: 618.4, width: 13, text: "Zia" },
    { x: 470.5, y: 617.2, width: 44, text: "20,024.33" },
    { x: 520.4, y: 617.5, width: 38, text: "11-Aug-26" },
    { x: 580.8, y: 617.5, width: 11, text: "70" },
    { x: 39.5, y: 593.4, width: 38, text: "13-Oct-26" },
    { x: 94.1, y: 593.8, width: 45, text: "NFD/2018" },
    { x: 361.1, y: 594.6, width: 13, text: "Zia" },
    { x: 470.5, y: 593.8, width: 44, text: "64,975.00" },
    { x: 520.4, y: 593.8, width: 38, text: "27-Nov-26" },
    { x: 469.9, y: 581.4, width: 44, text: "89,599.33" },
  ];

  const parsed = parseTallyStatementPositionedPages([page]);
  assert.equal(parsed.report, "pending_bills");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].date, "2026-06-27");
  assert.equal(parsed.entries[0].voucher, "NFD/1030");
  assert.equal(parsed.entries[0].side, "debit");
  assert.equal(parsed.entries[0].amount, 20024.33);
  assert.equal(parsed.entries[0].particulars, "Zia · due 2026-08-11 · 70d overdue");
  assert.equal(parsed.entries[1].voucher, "NFD/2018");
  assert.equal(parsed.entries[1].amount, 64975);
  assert.equal(parsed.closing.amount, 89599.33);

  const sfa = buildSfaStatementEntries({
    openOnly: true,
    invoices: [
      { invoice_date: "2026-06-27", voucher_number: "NFD/1030", amount_incl_vat: 20024.33, remaining: 0 },
      { invoice_date: "2026-10-13", voucher_number: "NFD/2018", amount_incl_vat: 64975, remaining: 20599.33 },
      { invoice_date: "2026-01-02", voucher_number: "NFD/1", amount_incl_vat: 500, remaining: 500 },
    ],
    receipts: [{ receipt_date: "2026-08-01", vch_no: "900", amount: 5000 }],
  });
  assert.equal(sfa.length, 3);
  const result = compareTallyStatement(parsed, sfa);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.voucher === "NFD/1030").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "NFD/1030").sfaDebit, 20024.33);
  assert.equal(result.rows.find((row) => row.voucher === "NFD/2018").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "NFD/2018").sfaDebit, 64975);
  assert.equal(result.rows.some((row) => row.voucher === "NFD/1"), false);
  assert.equal(result.rows.some((row) => row.voucher === "900"), false);
});

test("a one-halala gap stays on its voucher for every statement", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["27-06-2026", "Sales", "Sales", "NFD/1030", 20024.33, ""],
    ["09-07-2026", "Sales", "Sales", "NFD/1086", 4600, ""],
    ["13-10-2026", "Sales", "Sales", "NFD/2018", 64975, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-06-27", voucher_number: "NFD/1030", amount_incl_vat: 20024.32 },
      { invoice_date: "2026-07-09", voucher_number: "NFD/1086", amount_incl_vat: 4600 },
      { invoice_date: "2026-10-13", voucher_number: "NFD/2018", amount_incl_vat: 64975 },
    ],
  });
  const result = compareTallyStatement(tally, sfa);
  const gap = result.rows.find((row) => row.voucher === "NFD/1030");
  assert.equal(gap.status, "amount");
  assert.equal(gap.difference, 0.01);
  assert.equal(result.lead.voucher, "NFD/1030");
  assert.equal(result.totals.issueCount, 1);
  assert.equal(result.totals.difference, 0.01);
  assert.equal(result.rows.filter((row) => row.status === "matched").length, 2);
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

test("a round-off voucher stays on its own line beside the invoice it rounds", () => {
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
  assert.equal(result.rows.find((row) => row.voucher === "1076").status, "amount");
  assert.equal(result.rows.find((row) => row.voucher === "1076").difference, 0.15);
  assert.equal(result.rows.find((row) => row.voucher === "RO-1076").status, "sfa_only");
  assert.equal(result.rows.find((row) => row.voucher === "1077").status, "matched");
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

test("credit note 33 and sales 1583 each keep their own fils difference", () => {
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
  assert.equal(result.rows.find((row) => row.voucher === "1583").status, "amount");
  assert.equal(result.rows.find((row) => row.voucher === "1583").difference, 0.1);
  assert.equal(result.rows.find((row) => row.voucher === "33").status, "amount");
  assert.equal(result.rows.find((row) => row.voucher === "33").difference, -0.1);
  assert.equal(result.rows.find((row) => row.voucher === "1584").status, "amount");
  assert.equal(result.rows.find((row) => row.voucher === "1584").difference, -0.2);
});

test("sales 1825, its discount, and VAT-DG-1825 stay on separate lines", () => {
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
  const sale = result.rows.find((row) => row.voucher === "1825" && row.tallyDebit > 0);
  assert.equal(sale.status, "amount");
  assert.equal(sale.tallyDebit, 18595.5);
  assert.equal(sale.sfaDebit, 18975);
  assert.equal(result.rows.find((row) => row.voucher === "1825" && row.sfaCredit === 330).status, "sfa_only");
  assert.equal(result.rows.find((row) => row.voucher === "VAT-DG-1825").status, "sfa_only");
  assert.equal(result.rows.find((row) => row.voucher === "1900").status, "matched");
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

test("discount lines stay separate from invoice 1769 and credit note 48", () => {
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
  assert.equal(result.rows.find((row) => row.voucher === "1769").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "48").status, "matched");
  for (const voucher of ["DG-1769", "VAT-DG-1769", "DG-48", "VAT-DG-48"]) {
    assert.equal(result.rows.find((row) => row.voucher === voucher).status, "sfa_only", voucher);
  }
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

test("a receipt with a different voucher number stays unmatched even when the amount and date agree", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["25-09-2026", "Alrajhi Bank", "Receipt", "1819", "", 10000],
    ["04-10-2026", "Alrajhi Bank", "Receipt", "1880", "", 40000],
    ["10-09-2026", "Sales", "Sales", "RNFD/411", 39926.85, ""],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-09-10", voucher_number: "RNFD/411", amount_incl_vat: 39926.85 },
    ],
    receipts: [
      { receipt_date: "2026-09-25", vch_no: "BANK-1", amount: 10000, vch_type: "Receipt" },
      { receipt_date: "2026-10-04", vch_no: "1880", amount: 40000, vch_type: "Receipt" },
    ],
  });
  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "RNFD/411").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "1880").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "1819").status, "tally_only");
  assert.equal(result.rows.find((row) => row.voucher === "BANK-1").status, "sfa_only");
  assert.equal(result.rows.find((row) => row.voucher === "1819").tallyCredit, 10000);
  assert.equal(result.rows.find((row) => row.voucher === "BANK-1").sfaCredit, 10000);
});

test("a short receipt number does not take a sales voucher of a different amount", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["10-09-2026", "Sales", "Sales", "RNFD/411", 39926.85, ""],
    ["10-09-2026", "Alrajhi Bank", "Receipt", "411", "", 2500],
  ]);
  const sfa = buildSfaStatementEntries({
    invoices: [
      { invoice_date: "2026-09-10", voucher_number: "RNFD/411", amount_incl_vat: 39926.85 },
    ],
    receipts: [
      { receipt_date: "2026-09-10", vch_no: "BANK-9", amount: 2500, vch_type: "Receipt" },
    ],
  });
  const result = compareTallyStatement(tally, sfa);
  assert.equal(result.rows.find((row) => row.voucher === "RNFD/411").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "411").status, "tally_only");
  assert.equal(result.rows.find((row) => row.voucher === "BANK-9").status, "sfa_only");
});

test("a second SFA voucher stays on its own line when the Tally number is different", () => {
  const tally = parseTallyStatementMatrix([
    HEADER,
    ["04-10-2026", "Alrajhi Bank", "Receipt", "1880", "", 40000],
    ["05-10-2026", "Alrajhi Bank", "Receipt", "1896", "", 2500],
    ["05-05-2026", "DISCOUNT GIVEN", "NSTC JV", "JV/MAY/00001", "", 1680],
  ]);
  const sfa = buildSfaStatementEntries({
    receipts: [
      { receipt_date: "2026-10-04", vch_no: "1880", amount: 40000, vch_type: "Receipt" },
      { receipt_date: "2026-10-04", vch_no: "1879", amount: 40000, vch_type: "Receipt" },
      { receipt_date: "2026-10-05", vch_no: "1896", amount: 2500, vch_type: "Receipt" },
      { receipt_date: "2026-10-05", vch_no: "1895", amount: 2500, vch_type: "Receipt" },
      { receipt_date: "2026-05-05", vch_no: "JV/MAY/00001", amount: 1680, vch_type: "NSTC JV" },
      { receipt_date: "2026-05-05", vch_no: "DG-JV/MAY/00001", amount: 1680, vch_type: "Discount Given" },
      { receipt_date: "2026-05-05", vch_no: "VAT-DG-JV/MAY/00001", amount: 252, vch_type: "Discount Given" },
    ],
  });
  const result = compareTallyStatement(tally, sfa);
  const vouchers = result.rows.filter((row) => row.status !== "matched").map((row) => row.voucher).sort();
  assert.deepEqual(vouchers, ["1879", "1895", "DG-JV/MAY/00001", "VAT-DG-JV/MAY/00001"]);
  assert.equal(result.rows.find((row) => row.voucher === "1880").status, "matched");
  assert.equal(result.rows.find((row) => row.voucher === "JV/MAY/00001").status, "matched");
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
