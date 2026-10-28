import test from "node:test";
import assert from "node:assert/strict";
import {
  BILL_MISMATCH_DAY_INCOMPLETE,
  BILL_MISMATCH_MISSING,
  BILL_MISMATCH_OTHER_CUSTOMER,
  BILL_MISMATCH_REVERSED,
  buildOutstandingReconcileRow,
  classifyOutstandingBillMismatch,
  formatOutstandingCompareDelta,
  hasOutstandingCompareMoneyDifference,
  isOutstandingCompareSmallDifference,
  normalizeOutstandingReconcileDataset,
  sortOutstandingReconcileRows,
  summarizeOutstandingBillMismatches,
  summarizeOutstandingReconcileRows,
} from "../app/lib/outstandingReconcile.js";
import { buildOutstandingReconcileEmail } from "../app/lib/outstandingReconcileEmail.js";
import { outstandingReconcileSignature, runOutstandingReconcileCycle } from "../app/lib/outstandingReconcileEmailServer.js";
import { outstandingInvoicesForAccount } from "../app/lib/outstandingReconcileServer.js";
import { buildPaymentSettlementLedger } from "../app/lib/paymentBehavior.js";

const EMAIL_ENV = {
  SMTP_HOST: "smtp.example.com",
  SMTP_FROM: "reports@example.com",
  OUTSTANDING_RECONCILE_EMAIL_TO: "ops@example.com",
};

test("buildOutstandingReconcileRow flags SFA vs Tally customer differences", () => {
  const differs = buildOutstandingReconcileRow({
    customer: { customer_code: " c01 ", customer_name: "Alpha", salesman_name: "AHMED" },
    totals: { computed_open: 1150, discrepancy_count: 0 },
    tallyOutstanding: 1000,
  });
  assert.equal(differs.customer_code, "C01");
  assert.equal(differs.difference, 150);
  assert.equal(differs.has_difference, true);

  const withinTolerance = buildOutstandingReconcileRow({
    customer: { customer_code: "C02" },
    totals: { computed_open: 500.004, discrepancy_count: 0 },
    tallyOutstanding: 500,
  });
  assert.equal(withinTolerance.has_difference, false);

  const oneHalala = buildOutstandingReconcileRow({
    customer: { customer_code: "C02B" },
    totals: { sales_compared: 89599.32, computed_open: 20599.33, discrepancy_count: 1 },
    tallyOutstanding: 89599.33,
  });
  assert.equal(oneHalala.difference, -0.01);
  assert.equal(oneHalala.sfa_outstanding, 89599.32);
  assert.equal(oneHalala.has_difference, true);

  // Invoice-level gaps that net to zero at customer level still count as a difference.
  const nettedGaps = buildOutstandingReconcileRow({
    customer: { customer_code: "C03" },
    totals: { computed_open: 500, discrepancy_count: 2 },
    tallyOutstanding: 500,
  });
  assert.equal(nettedGaps.has_difference, true);
});

test("Show differences only uses money gaps, not invoice-only branch issues", () => {
  assert.equal(hasOutstandingCompareMoneyDifference({ open_delta: 150, gap_count: 0 }), true);
  assert.equal(hasOutstandingCompareMoneyDifference({ open_delta: 0.01, gap_count: 0 }), true);
  assert.equal(hasOutstandingCompareMoneyDifference({ open_delta: 0, gap_count: 2 }), false);
  assert.equal(hasOutstandingCompareMoneyDifference({ difference: -25, invoice_gap_count: 0 }), true);
  assert.equal(hasOutstandingCompareMoneyDifference({ open_delta: null }), false);

  assert.equal(formatOutstandingCompareDelta(0.01), "+0.01");
  assert.equal(formatOutstandingCompareDelta(0.004), "0");
  assert.equal(formatOutstandingCompareDelta(0), "0");
  assert.equal(formatOutstandingCompareDelta(12.5), "+12.5");
  assert.equal(formatOutstandingCompareDelta(-3.25), "-3.25");
});

test("Ignore differences of 1 SAR or less hides either side of a 1 SAR gap", () => {
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: 1 }), true);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: -1 }), true);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: 0.5 }), true);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: -0.01 }), true);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: 1.01 }), false);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: -1.01 }), false);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: 0 }), false);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: 0.004 }), false);
  assert.equal(isOutstandingCompareSmallDifference({ open_delta: null }), false);
  assert.equal(isOutstandingCompareSmallDifference({ difference: 40 }), false);
});

test("summarize and sort rank rows by absolute difference", () => {
  const rows = sortOutstandingReconcileRows([
    { customer_code: "A", difference: -40, tally_outstanding: 100, sfa_outstanding: 60, invoice_gap_count: 1 },
    { customer_code: "B", difference: 90, tally_outstanding: 10, sfa_outstanding: 100, invoice_gap_count: 2 },
  ]);
  assert.deepEqual(rows.map((row) => row.customer_code), ["B", "A"]);

  const summary = summarizeOutstandingReconcileRows(rows);
  assert.equal(summary.customer_count, 2);
  assert.equal(summary.difference, 50);
  assert.equal(summary.sfa_higher, 90);
  assert.equal(summary.sfa_lower, -40);
  assert.equal(summary.invoice_gap_count, 3);
});

test("normalizeOutstandingReconcileDataset repairs a stored payload", () => {
  const dataset = normalizeOutstandingReconcileDataset({
    builtAt: "2026-09-28T06:00:00.000Z",
    rows: [{ customer_code: "c9", difference: "12.5", sfa_outstanding: "112.5", tally_outstanding: "100" }],
  });
  assert.equal(dataset.rows[0].customer_code, "C9");
  assert.equal(dataset.rows[0].difference, 12.5);
  assert.equal(dataset.summary.customer_count, 1);

  assert.equal(normalizeOutstandingReconcileDataset(null).rows.length, 0);
});

test("email lists only difference rows and links each customer to settlement", () => {
  const message = buildOutstandingReconcileEmail({
    rows: [
      { customer_code: "C01", customer_name: "Alpha", difference: 150, tally_outstanding: 1000, sfa_outstanding: 1150, invoice_gap_count: 1 },
    ],
    summary: summarizeOutstandingReconcileRows([{ difference: 150, tally_outstanding: 1000, sfa_outstanding: 1150, invoice_gap_count: 1 }]),
    builtAt: "2026-09-28T06:00:00.000Z",
    env: {},
  });

  assert.match(message.subject, /1 customer\(s\) differ/);
  assert.match(message.html, /payment-settlement\?customer_code=C01#invoices-settlement/);
  assert.match(message.html, /Alpha/);
  assert.equal(message.rowCount, 1);
});

test("cycle emails differences once and skips an unchanged rebuild", async () => {
  const rows = [{ customer_code: "C01", difference: 150, invoice_gap_count: 0 }];
  const dataset = { builtAt: "2026-09-28T06:00:00.000Z", rows, summary: {}, scannedCount: 3, failedCount: 0 };
  const sent = [];
  let marker = {};

  const options = {
    env: EMAIL_ENV,
    rebuild: async () => dataset,
    send: async (message) => { sent.push(message); },
    loadMarker: async () => marker,
    saveMarker: async (_admin, next) => { marker = next; },
  };

  const first = await runOutstandingReconcileCycle({}, { ...options, trigger: "receipt-upload" });
  assert.equal(first.sentCount, 1);
  assert.equal(first.differenceCount, 1);
  assert.ok(sent[0].to.includes("ops@example.com"));

  const second = await runOutstandingReconcileCycle({}, { ...options, trigger: "receipt-upload" });
  assert.equal(second.sentCount, 0);
  assert.equal(second.reason, "unchanged");
  assert.equal(sent.length, 1);

  const changed = await runOutstandingReconcileCycle({}, {
    ...options,
    rebuild: async () => ({ ...dataset, rows: [{ customer_code: "C01", difference: 200, invoice_gap_count: 0 }] }),
  });
  assert.equal(changed.sentCount, 1);
});

test("cycle does not email when there are no differences", async () => {
  const sent = [];
  const result = await runOutstandingReconcileCycle({}, {
    env: EMAIL_ENV,
    rebuild: async () => ({ builtAt: "", rows: [], summary: {} }),
    send: async (message) => { sent.push(message); },
    loadMarker: async () => ({}),
    saveMarker: async () => {},
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_differences");
  assert.equal(sent.length, 0);
});

test("signature ignores row order", () => {
  const left = outstandingReconcileSignature([
    { customer_code: "A", difference: 1, invoice_gap_count: 0 },
    { customer_code: "B", difference: 2, invoice_gap_count: 1 },
  ]);
  const right = outstandingReconcileSignature([
    { customer_code: "B", difference: 2, invoice_gap_count: 1 },
    { customer_code: "A", difference: 1, invoice_gap_count: 0 },
  ]);
  assert.equal(left, right);
});

test("classifyOutstandingBillMismatch separates the three causes", () => {
  // 1027C bill RNFD/345: that voucher belongs to customer 1211 in sales.
  const otherCustomer = classifyOutstandingBillMismatch({
    customerCode: "1027C",
    billRef: "RNFD/345",
    refOwners: ["1211"],
  });
  assert.equal(otherCustomer.mismatch_type, BILL_MISMATCH_OTHER_CUSTOMER);
  assert.match(otherCustomer.note, /1211/);

  // 1486 bill RNFD/414: the customer's own voucher, dropped as a credit-note reversal.
  const reversed = classifyOutstandingBillMismatch({
    customerCode: "1486",
    billRef: "RNFD/414",
    refOwners: ["1486"],
    reversedInSfa: true,
  });
  assert.equal(reversed.mismatch_type, BILL_MISMATCH_REVERSED);

  // 1572 bill RNFD/408: nowhere in the sales export.
  const missing = classifyOutstandingBillMismatch({
    customerCode: "1572",
    billRef: "RNFD/408",
    refOwners: [],
  });
  assert.equal(missing.mismatch_type, BILL_MISMATCH_MISSING);
});

test("a reversed flag without the customer owning the ref is still an owner mismatch", () => {
  const result = classifyOutstandingBillMismatch({
    customerCode: "1300",
    billRef: "RNFD/900",
    refOwners: ["1400"],
    reversedInSfa: true,
  });
  assert.equal(result.mismatch_type, BILL_MISMATCH_OTHER_CUSTOMER);
});

test("a missing ref on an incomplete sales day points at the partial upload", () => {
  // 1027C bill RNFD/346: 2026-08-31 kept only one salesman after a partial sales upload.
  const result = classifyOutstandingBillMismatch({
    customerCode: "1027C",
    billRef: "RNFD/346",
    refOwners: [],
    salesDayIncomplete: true,
  });
  assert.equal(result.mismatch_type, BILL_MISMATCH_DAY_INCOMPLETE);
  assert.match(result.note, /Re-upload a full sales export/);
});

test("summarizeOutstandingBillMismatches totals each cause", () => {
  const summary = summarizeOutstandingBillMismatches([
    { mismatch_type: BILL_MISMATCH_OTHER_CUSTOMER, pending_amount: 100 },
    { mismatch_type: BILL_MISMATCH_OTHER_CUSTOMER, pending_amount: 50 },
    { mismatch_type: BILL_MISMATCH_MISSING, pending_amount: 25 },
  ]);
  assert.equal(summary.count, 3);
  assert.equal(summary.pending, 175);
  assert.equal(summary.byType[BILL_MISMATCH_OTHER_CUSTOMER].count, 2);
  assert.equal(summary.byType[BILL_MISMATCH_OTHER_CUSTOMER].pending, 150);
  assert.equal(summary.byType[BILL_MISMATCH_REVERSED].count, 0);
});

test("normalizeOutstandingReconcileDataset keeps mismatch rows", () => {
  const dataset = normalizeOutstandingReconcileDataset({
    rows: [],
    mismatchRows: [
      { customer_code: "1572", bill_ref: "RNFD/408", pending_amount: "92126.5", mismatch_type: BILL_MISMATCH_MISSING },
    ],
  });
  assert.equal(dataset.mismatchRows.length, 1);
  assert.equal(dataset.mismatchRows[0].pending_amount, 92126.5);
  assert.equal(dataset.mismatchSummary.count, 1);
});

test("1035C uses the bill refs stored under 1035, not the open balance", () => {
  const invoicesByCode = new Map([
    ["1035", [
      { customer_code: "1035", ref_no: "NFD/1030", pending_amount: 20024.33 },
      { customer_code: "1035", ref_no: "NFD/1086", pending_amount: 4600 },
      { customer_code: "1035", ref_no: "NFD/2018", pending_amount: 64975 },
    ]],
    ["1035C", [{ customer_code: "1035C", ref_no: "", pending_amount: 89599.33 }]],
  ]);
  const bills = outstandingInvoicesForAccount(invoicesByCode, "1035C");
  assert.deepEqual(bills.map((bill) => bill.ref_no), ["NFD/1030", "NFD/1086", "NFD/2018"]);

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-06-27", voucher_number: "NFD/1030", sales_amount: 17412.45, category: "Paper" },
      { transaction_date: "2026-07-09", voucher_number: "NFD/1086", sales_amount: 4000, category: "Paper" },
      { transaction_date: "2026-10-13", voucher_number: "NFD/2018", sales_amount: 56500, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-08-01", amount: 69000, vch_no: "R1" }],
    outstandingInvoices: bills,
    todayIso: "2026-10-23",
  });
  // SFA open is FIFO residual; paid Tally bills still count as open gaps.
  assert.equal(Number(ledger.outstandingCompareTotals.sales_compared.toFixed(2)), 20599.32);
  assert.equal(Number(ledger.outstandingCompareTotals.computed_open.toFixed(2)), 20599.32);
  assert.equal(Number(ledger.outstandingCompareTotals.open_delta.toFixed(2)), -69000.01);
});

test("paid Tally bills offset by untallied SFA opens do not invent a money gap", () => {
  // Same pattern as 1035C: Tally still lists a paid bill; SFA open sits on another
  // voucher Tally does not list. Invoice Open Δ nets to 0 — Compare must too.
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "PAID-TALLY", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-02-01", voucher_number: "OPEN-SFA", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-01-15", amount: 1150, vch_no: "R1" }],
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "PAID-TALLY", pending_amount: 1150 },
    ],
    todayIso: "2026-03-01",
  });

  const paid = ledger.invoices.find((row) => row.voucher_number === "PAID-TALLY");
  const open = ledger.invoices.find((row) => row.voucher_number === "OPEN-SFA");
  assert.equal(Number(paid.remaining.toFixed(2)), 0);
  assert.equal(Number(paid.outstanding_pending.toFixed(2)), 1150);
  assert.equal(Number(open.remaining.toFixed(2)), 1150);
  assert.equal(Number(open.outstanding_pending.toFixed(2)), 0);

  const invoiceOpenDelta = Number((paid.remaining - paid.outstanding_pending + open.remaining - open.outstanding_pending).toFixed(2));
  assert.equal(invoiceOpenDelta, 0);
  assert.equal(Number(ledger.outstandingCompareTotals.open_delta.toFixed(2)), 0);
  assert.ok(ledger.outstandingCompareTotals.discrepancy_count >= 2);
});
