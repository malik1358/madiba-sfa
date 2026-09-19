import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreditNotes,
  buildDaysToPayObservations,
  buildPaymentBehavior,
  buildPaymentSettlementLedger,
  buildSalesInvoices,
  findImmediateCreditNoteReversals,
  matchPaymentsFifo,
  weightedAverageDays,
} from "../app/lib/paymentBehavior.js";

test("buildSalesInvoices aggregates voucher lines by date and adds 15% VAT", () => {
  const invoices = buildSalesInvoices([
    { transaction_date: "2026-01-01", voucher_number: "A1", sales_amount: 100, category: "Paper" },
    { transaction_date: "2026-01-01", voucher_number: "A1", sales_amount: 50, category: "Paper" },
    { transaction_date: "2026-01-05", voucher_number: "A2", sales_amount: 200, category: "Paper" },
  ]);

  assert.equal(invoices.length, 2);
  assert.equal(Number(invoices[0].amount.toFixed(2)), 172.5);
  assert.equal(Number(invoices[1].amount.toFixed(2)), 230);
});

test("matchPaymentsFifo measures days from sales date to receipt date", () => {
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-10", voucher_number: "2", sales_amount: 500, category: "Paper" },
    ],
    [
      // Receipts are VAT-inclusive (15%).
      { receipt_date: "2026-01-31", amount: 1150 },
      { receipt_date: "2026-02-09", amount: 575 },
    ],
  );

  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].days, 30);
  assert.equal(allocations[1].days, 30);
  assert.equal(invoices.every((row) => row.remaining === 0), true);
});

test("buildPaymentBehavior blends only open invoices older than paid-only avg", () => {
  const behavior = buildPaymentBehavior({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Stationery" },
      { transaction_date: "2026-02-01", voucher_number: "2", sales_amount: 1000, category: "Stationery" },
    ],
    receipts: [
      { receipt_date: "2026-01-11", amount: 1150 },
      { receipt_date: "2026-03-03", amount: 1150 },
    ],
    outstandingCustomer: {
      total_outstanding: 750,
      open_invoices: 2,
    },
    outstandingInvoices: [
      {
        invoice_date: "2025-12-01",
        due_date: "2025-12-15",
        pending_amount: 500,
        overdue_days: 40,
        invoice_day: 90,
      },
      {
        invoice_date: "2026-03-01",
        due_date: "2026-04-01",
        pending_amount: 250,
        overdue_days: 0,
        invoice_day: 14,
      },
    ],
    todayIso: "2026-03-15",
  });

  // Paid-only: 10d on 1150 + 30d on 1150 => 20
  // Open 14d is below paid avg → excluded; open 90d is included
  // Blended: (11500 + 34500 + 45000) / 2800 ≈ 32.5 → 33
  assert.equal(behavior.avgDaysPaidOnly, 20);
  assert.equal(behavior.avgDaysToPay, 33);
  assert.equal(behavior.openAmountInAvg, 500);
  assert.equal(behavior.outstandingTotal, 750);
  assert.equal(behavior.outstandingOpenInvoices, 2);
  assert.ok(behavior.outstandingOldestDays >= 40);
  assert.match(behavior.summaryLabel, /Avg 33 days to pay \(paid \+ open older than paid avg\)/);
  assert.match(behavior.summaryLabel, /paid-only 20d/);
  assert.match(behavior.summaryLabel, /Unpaid 750/);
  assert.match(behavior.summaryLabel, /oldest open/);
});

test("fresh large open invoice cannot pull avg days below paid-only avg", () => {
  // Paid avg 107; old open raises; brand-new 50k@1d must not dilute
  const withFresh = buildDaysToPayObservations({
    allocations: [{ amount: 18000, days: 107 }],
    openInvoices: [
      { pending_amount: 9953, open_days: 251 },
      { pending_amount: 3613, open_days: 183 },
      { pending_amount: 50000, open_days: 1 },
    ],
    minOpenDaysExclusive: 107,
  });
  const withoutFresh = buildDaysToPayObservations({
    allocations: [{ amount: 18000, days: 107 }],
    openInvoices: [
      { pending_amount: 9953, open_days: 251 },
      { pending_amount: 3613, open_days: 183 },
    ],
    minOpenDaysExclusive: 107,
  });

  assert.equal(withFresh.filter((row) => row.source === "open").length, 2);
  assert.equal(Math.round(weightedAverageDays(withFresh)), Math.round(weightedAverageDays(withoutFresh)));
  assert.equal(Math.round(weightedAverageDays(withFresh)), 161);
  assert.ok(Math.round(weightedAverageDays(withFresh)) > 107);
});

test("open invoices younger than paid avg are ignored so avg cannot fall", () => {
  const behavior = buildPaymentBehavior({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-04-11", amount: 1150 }],
    outstandingInvoices: [
      { invoice_date: "2026-04-10", ref_no: "NEW", pending_amount: 20000, invoice_day: 1 },
    ],
    todayIso: "2026-04-11",
  });

  // Paid-only = 100 days; open 1d < 100 → excluded
  assert.equal(behavior.avgDaysPaidOnly, 100);
  assert.equal(behavior.avgDaysToPay, 100);
  assert.equal(behavior.openAmountInAvg, 0);
});

test("FIFO applies oldest invoice first when one receipt covers two bills", () => {
  const { allocations } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 400, category: "Paper" },
      { transaction_date: "2026-01-20", voucher_number: "2", sales_amount: 600, category: "Paper" },
    ],
    [{ receipt_date: "2026-02-01", amount: 1150 }],
  );

  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].voucher_number, "1");
  assert.equal(allocations[0].days, 31);
  assert.equal(Number(allocations[0].amount.toFixed(2)), 460);
  assert.equal(allocations[1].voucher_number, "2");
  assert.equal(allocations[1].days, 12);
  assert.equal(Number(allocations[1].amount.toFixed(2)), 690);
});

test("gloves sales stay excl VAT when matching receipts", () => {
  const invoices = buildSalesInvoices([
    { transaction_date: "2026-01-01", voucher_number: "G1", sales_amount: 1000, category: "Gloves", item_name: "Nitrile Gloves" },
    { transaction_date: "2026-01-01", voucher_number: "P1", sales_amount: 1000, category: "Paper" },
  ]);

  const gloves = invoices.find((row) => row.voucher_number === "G1");
  const paper = invoices.find((row) => row.voucher_number === "P1");
  assert.equal(gloves.amount, 1000);
  assert.equal(Number(paper.amount.toFixed(2)), 1150);
});

test("settlement Sales total keeps gloves without VAT and paper with 15%", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "G1", sales_amount: 1000, category: "Gloves", item_name: "Nitrile Gloves" },
      { transaction_date: "2026-01-01", voucher_number: "P1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "REV", sales_amount: 400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "CN", sales_amount: -400, category: "Paper" },
    ],
    // sales = gloves 1000 + paper 1150 + reversed 460 = 2610
    // open 610 on P1 → collected must be 2000 for identity
    receipts: [{ receipt_date: "2026-01-20", amount: 2000 }],
    outstandingCustomer: { total_outstanding: 610, open_invoices: 1 },
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "P1", pending_amount: 610, invoice_day: 19 },
    ],
    todayIso: "2026-01-20",
  });

  const gloves = ledger.invoices.find((row) => row.voucher_number === "G1");
  const paper = ledger.invoices.find((row) => row.voucher_number === "P1");
  assert.equal(gloves.amount_incl_vat, 1000);
  assert.equal(Number(paper.amount_incl_vat.toFixed(2)), 1150);
  assert.equal(Number(ledger.totals.net_sales_incl_vat.toFixed(2)), 2610);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 2000);
  // FIFO open on P1 after 2000 cash (gloves 1000 + paper 1000) = 150 — not forced to outstanding 610.
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 150);
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 610);
  assert.equal(ledger.totals.open_matches_outstanding, false);
  assert.equal(Number(paper.paid_amount.toFixed(2)), Number(paper.fifo_paid.toFixed(2)));
  assert.equal(ledger.reversedInvoices.length, 1);
});

test("buildPaymentSettlementLedger returns invoice settlement and datewise rows", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-20", voucher_number: "2", sales_amount: 500, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-01-31", amount: 1150, vch_no: "R1" },
      { receipt_date: "2026-02-10", amount: 200, vch_no: "R2" },
    ],
    outstandingCustomer: { total_outstanding: 375, open_invoices: 1 },
    outstandingInvoices: [],
    todayIso: "2026-02-15",
  });

  assert.equal(ledger.invoices.length, 2);
  assert.equal(ledger.invoices[0].status, "Paid");
  assert.equal(ledger.invoices[0].payment_days, 30);
  assert.equal(ledger.invoices[0].settlements.length, 1);
  assert.equal(ledger.invoices[0].settlements[0].vch_no, "R1");

  assert.equal(ledger.invoices[1].status, "Partial");
  assert.equal(ledger.invoices[1].settlements.length, 1);
  assert.equal(ledger.invoices[1].payment_days, 21);
  assert.ok(ledger.invoices[1].remaining > 0);

  assert.equal(ledger.datewise.length, 4);
  assert.equal(ledger.settlementEvents.length, 2);
  // Paid: 1150@30 + 200@21 => paid-only ≈ 29
  // Open FIFO residual 375@26 is younger than paid avg → excluded
  assert.equal(ledger.summary.avgDaysPaidOnly, 29);
  assert.equal(ledger.summary.avgDaysToPay, 29);
  assert.equal(ledger.summary.openAmountInAvg, 0);
  assert.equal(ledger.totals.paid_invoice_count, 1);
  assert.equal(ledger.totals.partial_invoice_count, 1);
  assert.ok(ledger.totals.open_sales_amount > 0);
  assert.equal(ledger.reversedInvoices.length, 0);
});

test("buildPaymentBehavior prefers invoice sum over rounded header total", () => {
  const behavior = buildPaymentBehavior({
    transactions: [],
    receipts: [],
    outstandingCustomer: {
      total_outstanding: 76108,
      open_invoices: 2,
    },
    outstandingInvoices: [
      {
        invoice_date: "2026-05-24",
        ref_no: "NFD/868",
        pending_amount: 14795,
        invoice_day: 112,
      },
      {
        invoice_date: "2026-07-29",
        ref_no: "RNFD/158",
        pending_amount: 61312,
        invoice_day: 46,
      },
    ],
    todayIso: "2026-09-16",
  });

  assert.equal(behavior.outstandingTotal, 76107);
  assert.equal(behavior.outstandingOldestDays, 112);
  // Open-only avg: (14795*112 + 61312*46) / 76107 ≈ 59
  assert.equal(behavior.avgDaysToPay, 59);
  assert.equal(behavior.avgDaysPaidOnly, null);
});

test("buildPaymentSettlementLedger Paid/Open follow FIFO, not outstanding force", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-04-12", voucher_number: "NFD/414", sales_amount: 50580, category: "Paper" },
      { transaction_date: "2026-05-24", voucher_number: "NFD/868", sales_amount: 29870, category: "Paper" },
      { transaction_date: "2026-07-29", voucher_number: "RNFD/158", sales_amount: 53315, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-08-01", amount: 2225.98 }],
    outstandingCustomer: { total_outstanding: 76107.6, open_invoices: 2 },
    outstandingInvoices: [
      { invoice_date: "2026-05-24", ref_no: "NFD/868", pending_amount: 14795.35, invoice_day: 112 },
      { invoice_date: "2026-07-29", ref_no: "RNFD/158", pending_amount: 61312.25, invoice_day: 46 },
    ],
    todayIso: "2026-09-16",
  });

  // Open total is FIFO residual (plus outstanding-only rows), not forced to Tally 76,107.60.
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 76107.6);
  assert.equal(ledger.totals.open_matches_outstanding, false);

  const nfd414 = ledger.invoices.find((row) => row.voucher_number === "NFD/414");
  assert.equal(nfd414.open_source, "fifo");
  assert.equal(nfd414.outstanding_pending, 0);

  const nfd868 = ledger.invoices.find((row) => row.voucher_number === "NFD/868");
  assert.equal(nfd868.open_source, "fifo");
  assert.equal(Number(nfd868.outstanding_pending.toFixed(2)), 14795.35);
  // Paid must equal FIFO cash on the row — not sales − outstanding pending (19,555.15).
  assert.equal(Number(nfd868.paid_amount.toFixed(2)), Number(nfd868.fifo_paid.toFixed(2)));
  assert.equal(Number(nfd868.remaining.toFixed(2)), Number(nfd868.fifo_remaining.toFixed(2)));
  assert.notEqual(Number(nfd868.paid_amount.toFixed(2)), Number((34350.5 - 14795.35).toFixed(2)));

  const rnfd = ledger.invoices.find((row) => row.voucher_number === "RNFD/158");
  assert.equal(Number(rnfd.outstanding_pending.toFixed(2)), 61312.25);
});

test("buildPaymentSettlementLedger uses open invoice age when customer never paid", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [],
    outstandingCustomer: { total_outstanding: 1150, open_invoices: 1 },
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "1", pending_amount: 1150, invoice_day: 31 },
    ],
    todayIso: "2026-02-01",
  });

  assert.equal(ledger.summary.avgDaysToPay, 31);
  assert.equal(ledger.summary.avgDaysPaidOnly, null);
  assert.equal(ledger.invoices[0].status, "Open");
  assert.equal(ledger.invoices[0].payment_days, null);
  assert.equal(ledger.invoices[0].open_days, 31);
  assert.equal(ledger.settlementEvents.length, 0);
  assert.equal(ledger.summary.outstandingTotal, 1150);
});

test("buildCreditNotes aggregates negative sales lines with VAT", () => {
  const notes = buildCreditNotes([
    { transaction_date: "2026-01-01", voucher_number: "CN1", sales_amount: -100, category: "Paper" },
    { transaction_date: "2026-01-01", voucher_number: "CN1", sales_amount: -50, category: "Paper" },
    { transaction_date: "2026-01-02", voucher_number: "INV1", sales_amount: 200, category: "Paper" },
  ]);

  assert.equal(notes.length, 1);
  assert.equal(notes[0].voucher_number, "CN1");
  assert.equal(Number(notes[0].amount.toFixed(2)), 172.5);
});

test("immediate same-day credit note reversal is excluded from avg days to pay", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      // Reversed invoice sorts first (older date) so without exclusion FIFO would
      // consume the receipt against it and distort avg days.
      { transaction_date: "2025-12-20", voucher_number: "INV-REV", sales_amount: 400, category: "Paper" },
      { transaction_date: "2025-12-20", voucher_number: "CN-REV", reference: "INV-REV", sales_amount: -400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "INV-KEEP", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-01-31", amount: 1150, vch_no: "R1" },
    ],
    outstandingInvoices: [],
    todayIso: "2026-02-15",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  assert.equal(ledger.reversedInvoices[0].voucher_number, "INV-REV");
  assert.equal(ledger.reversedInvoices[0].credit_note_voucher, "CN-REV");
  assert.equal(ledger.reversedInvoices[0].reversal_days, 0);
  assert.equal(ledger.totals.reversed_invoice_count, 1);

  assert.equal(ledger.invoices.length, 1);
  assert.equal(ledger.invoices[0].voucher_number, "INV-KEEP");
  assert.equal(ledger.invoices[0].status, "Paid");
  assert.equal(ledger.invoices[0].payment_days, 30);
  assert.equal(ledger.summary.avgDaysToPay, 30);
  assert.equal(ledger.settlementEvents.length, 1);
  assert.equal(ledger.settlementEvents[0].voucher_number, "INV-KEEP");

  // KPI Sales includes the reversed invoice; paired CN is not deducted again.
  assert.equal(Number(ledger.totals.sales_incl_vat.toFixed(2)), Number((1150 + 460).toFixed(2)));
  assert.equal(Number(ledger.totals.net_sales_incl_vat.toFixed(2)), Number((1150 + 460).toFixed(2)));
  assert.equal(ledger.totals.credit_note_amount, 0);
  assert.equal(Number(ledger.totals.invoice_sales_incl_vat.toFixed(2)), 1150);
});

test("Sales − Collected = Open for balanced reversed + outstanding books", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "INV-REV", sales_amount: 400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "CN-REV", sales_amount: -400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "INV-OPEN", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "INV-PAID", sales_amount: 500, category: "Paper" },
    ],
    // collected = sales_incl − open = 2185 − 690 = 1495
    receipts: [{ receipt_date: "2026-01-25", amount: 1495 }],
    outstandingCustomer: { total_outstanding: 690, open_invoices: 1 },
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "INV-OPEN", pending_amount: 690, invoice_day: 24 },
    ],
    todayIso: "2026-01-25",
  });

  assert.equal(Number(ledger.totals.net_sales_incl_vat.toFixed(2)), 2185);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 1495);
  // FIFO open after cash — not forced to outstanding pending 690.
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 230);
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 690);
  assert.equal(ledger.totals.open_matches_outstanding, false);
  assert.equal(ledger.summary.avgDaysToPay != null, true);
  assert.equal(ledger.reversedInvoices.length, 1);
});

test("unpaired credit notes reduce net Sales used in the Open check", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "INV1", sales_amount: 1000, category: "Paper" },
      // Credit note several days later — not an immediate reversal pair.
      { transaction_date: "2026-01-10", voucher_number: "CN1", sales_amount: -200, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-01-20", amount: 500 }],
    outstandingCustomer: { total_outstanding: 420, open_invoices: 1 },
    outstandingInvoices: [
      // 1150 sales - 230 CN - 500 collected = 420 open
      { invoice_date: "2026-01-01", ref_no: "INV1", pending_amount: 420, invoice_day: 20 },
    ],
    todayIso: "2026-01-21",
  });

  assert.equal(ledger.reversedInvoices.length, 0);
  assert.equal(ledger.creditNotes.length, 1);
  assert.equal(ledger.creditNotes[0].voucher_number, "CN1");
  assert.equal(Number(ledger.totals.sales_incl_vat.toFixed(2)), 1150);
  assert.equal(Number(ledger.totals.credit_note_amount.toFixed(2)), 230);
  assert.equal(Number(ledger.totals.net_sales_incl_vat.toFixed(2)), 920);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 500);
  // Machine open also applies unpaired CN in date order: 1150 − 230 CN − 500 cash = 420.
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 420);
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 420);
  const inv1 = ledger.invoices.find((row) => row.voucher_number === "INV1");
  assert.equal(Number(inv1.paid_amount.toFixed(2)), 500);
  assert.equal(Number(inv1.outstanding_pending.toFixed(2)), 420);
});

test("partial credit note and sales return appear in creditNotes table, not reversed", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "INV1", sales_amount: 1000, category: "Paper" },
      // Partial CN same day — not a full reverse
      {
        transaction_date: "2026-01-01",
        voucher_number: "CN-PART",
        voucher_type: "Credit Note",
        reference: "INV1",
        sales_amount: -200,
        category: "Paper",
      },
      // Sales return a week later
      {
        transaction_date: "2026-01-08",
        voucher_number: "SR-1",
        voucher_type: "SR",
        sales_amount: -100,
        category: "Paper",
      },
    ],
    receipts: [{ receipt_date: "2026-01-20", amount: 400 }],
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "INV1", pending_amount: 405, invoice_day: 14 },
    ],
    todayIso: "2026-01-15",
  });

  assert.equal(ledger.reversedInvoices.length, 0);
  assert.equal(ledger.creditNotes.length, 2);
  assert.equal(ledger.creditNotes[0].kind, "Credit Note");
  assert.equal(ledger.creditNotes[1].kind, "Sales Return");
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "INV1"), true);

  const invoice = ledger.invoices.find((row) => row.voucher_number === "INV1");
  assert.equal(invoice.credit_notes.length, 2);
  assert.equal(invoice.credit_notes[0].voucher_number, "CN-PART");
  assert.equal(invoice.credit_notes[0].days, null);
  assert.equal(invoice.settlements.length, 1);
  // Payment days only from the cash receipt — CN amounts ignored.
  assert.equal(invoice.payment_days, 19);
  assert.equal(ledger.creditNotes[0].applied_to_voucher, "INV1");
  assert.equal(Number(ledger.totals.credit_note_amount.toFixed(2)), 345);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 400);
});

test("next-day matching credit note still counts as immediate reversal", () => {
  const invoices = buildSalesInvoices([
    { transaction_date: "2026-03-10", voucher_number: "S1", sales_amount: 500, category: "Paper" },
  ]);
  const notes = buildCreditNotes([
    { transaction_date: "2026-03-11", voucher_number: "CN1", sales_amount: -500, category: "Paper" },
  ]);
  const { reversals, reversedKeys } = findImmediateCreditNoteReversals(invoices, notes);

  assert.equal(reversals.length, 1);
  assert.equal(reversals[0].reversal_days, 1);
  assert.equal(reversedKeys.has("2026-03-10::S1"), true);
});

test("credit note several days later is not treated as immediate reversal", () => {
  const { allocations, reversedInvoices, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-10", voucher_number: "CN1", sales_amount: -1000, category: "Paper" },
    ],
    [{ receipt_date: "2026-01-20", amount: 1150 }],
  );

  assert.equal(reversedInvoices.length, 0);
  assert.equal(invoices.length, 1);
  // Full unpaired CN clears the invoice before the later receipt — not a Reversed pair.
  assert.equal(Number(invoices[0].remaining.toFixed(2)), 0);
  assert.equal(allocations.length, 0);
});

test("typed Credit Note with positive amount reverses matching invoice next day (NFD/402 / CN 149)", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-04-11",
        voucher_number: "NFD/402",
        sales_amount: 50580,
        category: "Paper",
        voucher_type: "SALES-NON FOOD DIVISION",
      },
      // Tally credit notes often land as typed rows with a positive amount column.
      {
        transaction_date: "2026-04-12",
        voucher_number: "149",
        sales_amount: 50580,
        category: "Paper",
        voucher_type: "Credit Note",
      },
      {
        transaction_date: "2026-04-12",
        voucher_number: "NFD/414",
        sales_amount: 50580,
        category: "Paper",
        voucher_type: "SALES-NON FOOD DIVISION",
      },
    ],
    receipts: [{ receipt_date: "2026-05-22", amount: 35000 }],
    outstandingInvoices: [],
    todayIso: "2026-09-16",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  assert.equal(ledger.reversedInvoices[0].voucher_number, "NFD/402");
  assert.equal(ledger.reversedInvoices[0].credit_note_voucher, "149");
  assert.equal(ledger.reversedInvoices[0].reversal_days, 1);

  const live = ledger.invoices.map((row) => row.voucher_number);
  assert.ok(!live.includes("NFD/402"));
  assert.ok(live.includes("NFD/414"));
});

test("Tally vs FIFO discrepancy report flags over-allocated paid on partial invoice", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-05-24", voucher_number: "NFD/868", sales_amount: 29870, category: "Paper" },
      { transaction_date: "2026-07-29", voucher_number: "RNFD/158", sales_amount: 53315, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-07-29", amount: 22956.11, vch_no: "1346" }],
    outstandingCustomer: { total_outstanding: 76107.6, open_invoices: 2 },
    outstandingInvoices: [
      { invoice_date: "2026-05-24", ref_no: "NFD/868", pending_amount: 14795.35, invoice_day: 112 },
      { invoice_date: "2026-07-29", ref_no: "RNFD/158", pending_amount: 61312.25, invoice_day: 46 },
    ],
    todayIso: "2026-09-16",
  });

  const nfd868 = ledger.invoices.find((row) => row.voucher_number === "NFD/868");
  assert.equal(Number(nfd868.paid_amount.toFixed(2)), Number(nfd868.fifo_paid.toFixed(2)));
  assert.equal(Number(nfd868.fifo_paid.toFixed(2)), 22956.11);

  const gap = ledger.tallyFifoDiscrepancies.find((row) => row.voucher_number === "NFD/868");
  assert.ok(gap);
  assert.equal(Number(gap.book_paid.toFixed(2)), 19555.15);
  assert.equal(Number(gap.fifo_paid.toFixed(2)), 22956.11);
  assert.equal(Number(gap.paid_delta.toFixed(2)), 3400.96);
  assert.equal(Number(gap.open_delta.toFixed(2)), -3400.96);
  assert.match(gap.note, /over-allocated/i);
  assert.equal(gap.receipt_chunks[0].vch_no, "1346");
  assert.ok(ledger.totals.tally_fifo_over_allocated > 3400);
});

test("same-day CN voids original; next-day reissue stays open (2384 / 2397)", () => {
  const item = { item_code: "P-100", item_name: "Paper A4", quantity: 10, category: "Paper" };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      // Original bill 31 Dec — fully reversed same day by CN 121.
      {
        transaction_date: "2025-12-31",
        voucher_number: "2384",
        sales_amount: 18026.2,
        ...item,
      },
      {
        transaction_date: "2025-12-31",
        voucher_number: "121",
        voucher_type: "Credit Note",
        reference: "2384",
        sales_amount: 18026.2,
        ...item,
      },
      // Orphan / blank-style second CN same day — must NOT reverse the next-day reissue.
      {
        transaction_date: "2025-12-31",
        voucher_number: "",
        voucher_type: "Credit Note",
        sales_amount: 18026.2,
        ...item,
      },
      // Replacement invoice next day — live AR again (Tally keeps this open).
      {
        transaction_date: "2026-01-01",
        voucher_number: "2397",
        sales_amount: 18026.2,
        ...item,
      },
    ],
    receipts: [{ receipt_date: "2026-02-03", amount: 20730.13, vch_no: "R1" }],
    outstandingInvoices: [],
    todayIso: "2026-09-16",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  const original = ledger.reversedInvoices.find((row) => row.voucher_number === "2384");
  assert.ok(original);
  assert.equal(original.credit_note_voucher, "121");
  assert.equal(ledger.reversedInvoices.some((row) => row.voucher_number === "2397"), false);

  const reissue = ledger.invoices.find((row) => row.voucher_number === "2397");
  assert.ok(reissue);
  assert.equal(Number(reissue.paid_amount.toFixed(2)), 20730.13);
  assert.equal(Number(reissue.remaining.toFixed(2)), 0);

  // Orphan CN stays unpaired (or applied as credit), not as a reverse of 2397.
  assert.equal(ledger.creditNotes.some((row) => !String(row.voucher_number || "").trim()), true);
});

test("CN/ and SR/ voucher codes with positive amounts are sales returns not invoices", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "NFD/100", sales_amount: 1000, category: "Paper" },
      // Positive amount but CN/ voucher code — should not inflate sales.
      { transaction_date: "2026-01-20", voucher_number: "CN/55", sales_amount: 200, category: "Paper" },
      { transaction_date: "2026-02-01", voucher_number: "SR/9", sales_amount: 100, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-01-31", amount: 500 }],
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "NFD/100", pending_amount: 505, invoice_day: 40 },
    ],
    todayIso: "2026-02-10",
  });

  assert.equal(ledger.reversedInvoices.length, 0);
  assert.equal(ledger.creditNotes.length, 2);
  assert.equal(ledger.creditNotes.some((row) => row.voucher_number === "CN/55"), true);
  assert.equal(ledger.creditNotes.some((row) => row.kind === "Sales Return"), true);
  assert.equal(ledger.invoices.every((row) => !String(row.voucher_number).startsWith("CN")), true);
  assert.ok(Number(ledger.totals.credit_note_amount) > 0);
  assert.ok(Number(ledger.totals.net_sales_incl_vat) < Number(ledger.totals.sales_incl_vat));
});

test("Tally vs computed outstanding includes credit notes in computed open", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2025-11-11",
        voucher_number: "1691",
        sales_amount: 6190,
        item_code: "ITEM-A",
        quantity: 1,
        category: "Paper",
      },
      {
        transaction_date: "2025-12-10",
        voucher_number: "2106",
        sales_amount: 2250,
        item_code: "ITEM-B",
        quantity: 1,
        category: "Paper",
      },
      {
        transaction_date: "2026-07-29",
        voucher_number: "427",
        voucher_type: "Credit Note",
        reference: "1691",
        sales_amount: 2250,
        item_code: "ITEM-B",
        quantity: 1,
        category: "Paper",
      },
    ],
    receipts: [{ receipt_date: "2026-04-02", amount: 4492.48, vch_no: "538" }],
    outstandingInvoices: [
      { invoice_date: "2025-11-11", ref_no: "1691", pending_amount: 2626.02, invoice_day: 100 },
      { invoice_date: "2025-12-10", ref_no: "2106", pending_amount: 0, invoice_day: 0 },
    ],
    todayIso: "2026-09-16",
  });

  assert.ok(ledger.outstandingCompareTotals);
  assert.equal(ledger.outstandingCompareTotals.has_outstanding_rows, true);

  const row2106 = (ledger.outstandingCompareAllRows || []).find((row) => row.voucher_number === "2106");
  assert.ok(row2106);
  assert.ok(row2106.credit_note_settled > 0);
  assert.equal(Number(row2106.computed_open.toFixed(2)), 0);
  assert.equal(Number(row2106.tally_open.toFixed(2)), 0);
  assert.equal(row2106.has_gap, false);

  const cashGap = (ledger.tallyFifoDiscrepancies || []).find((row) => row.voucher_number === "2106");
  assert.ok(cashGap);
});
