import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreditNotes,
  buildDaysToPayObservations,
  buildPaymentBehavior,
  buildPaymentSettlementLedger,
  buildSalesInvoices,
  findImmediateCreditNoteReversals,
  isCashSalesVoucher,
  matchPaymentsFifo,
  pairRefundsForReversedSales,
  parseCreditNoteReferences,
  weightedAverageDays,
} from "../app/lib/paymentBehavior.js";

test("sales incl VAT total matches the sum of each invoice rounded to halalas", () => {
  // Customer 1073. Raw VAT is 59,119.476, which prints as 59,119.48.
  // The invoice column rounds each bill first and those bills add to 59,119.49.
  const excl = [
    939.13, 1173.91, 2043, 4086, 4130, 9938, 1900, 1440,
    2087, 1512.9, 1240, 5043, 2641.5, 2773.8, 4988, 5472,
  ];
  const ledger = buildPaymentSettlementLedger({
    transactions: excl.map((sales_amount, index) => ({
      transaction_date: `2026-01-${String((index % 27) + 1).padStart(2, "0")}`,
      voucher_number: `V${index + 1}`,
      sales_amount,
      category: "Paper",
    })),
    receipts: [],
  });

  const shownCents = ledger.invoices.reduce((total, row) => {
    const shown = Number(Number(row.amount_incl_vat).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      useGrouping: false,
    }));
    return total + Math.round(shown * 100);
  }, 0);

  assert.equal(shownCents, 5911949);
  assert.equal(Math.round(ledger.totals.invoice_sales_incl_vat * 100), shownCents);
  assert.equal(Math.round(ledger.totals.open_sales_amount * 100), shownCents);
  assert.equal(
    Number(ledger.totals.invoice_sales_incl_vat.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      useGrouping: false,
    })),
    59119.49,
  );

  const sameDay = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-08-20", voucher_number: "A", sales_amount: 2641.5, category: "Paper" },
      { transaction_date: "2026-08-20", voucher_number: "B", sales_amount: 1512.9, category: "Paper" },
    ],
    receipts: [],
  });
  assert.equal(Math.round(sameDay.datewise[0].sales_incl_vat * 100), 477757);
  assert.equal(Math.round(sameDay.totals.invoice_sales_incl_vat * 100), 477757);
});

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

test("a debit receipt leaves Machine Open on the newest invoice", () => {
  const transactions = [
    { transaction_date: "2025-10-20", voucher_number: "1457", sales_amount: 1000, category: "Paper" },
    { transaction_date: "2026-01-18", voucher_number: "2645", sales_amount: 1000, category: "Paper" },
  ];
  const receipts = [
    { receipt_date: "2025-11-13", amount: 1150, vch_no: "286", vch_type: "Receipt" },
    { receipt_date: "2026-01-18", amount: 1150, vch_no: "326", vch_type: "Receipt" },
    { receipt_date: "2025-10-20", amount: -0.45, vch_no: "RO-1457", vch_type: "Round Off" },
  ];
  const ledger = buildPaymentSettlementLedger({ transactions, receipts });
  const oldest = ledger.invoices.find((row) => row.voucher_number === "1457");
  const newest = ledger.invoices.find((row) => row.voucher_number === "2645");

  assert.equal(Number(oldest.remaining.toFixed(2)), 0);
  assert.equal(oldest.status, "Paid");
  assert.equal(Number(newest.remaining.toFixed(2)), 0.45);
  assert.equal(newest.status, "Partial");
  assert.equal(newest.settlements.find((row) => row.vch_no === "RO-1457").amount, -0.45);
});

test("matchPaymentsFifo treats a Round Off debit as a negative receipt on that invoice", () => {
  const transactions = [
    { transaction_date: "2025-10-20", voucher_number: "1457", sales_amount: 1000, category: "Paper" },
  ];
  const receipts = [
    { receipt_date: "2025-10-20", amount: 1149.55, vch_no: "326", vch_type: "Receipt" },
    { receipt_date: "2025-10-20", amount: -0.45, vch_no: "RO-1457", vch_type: "Round Off" },
    { receipt_date: "2025-12-18", amount: 0.25, vch_no: "RO-2219", vch_type: "Round Off" },
  ];
  const { allocations, invoices } = matchPaymentsFifo(transactions, receipts);
  const reversal = allocations.find((row) => row.vch_no === "RO-1457");

  assert.equal(reversal.voucher_number, "1457");
  assert.equal(reversal.amount, -0.45);
  assert.equal(Number(invoices[0].remaining.toFixed(2)), 0.65);

  const ledger = buildPaymentSettlementLedger({ transactions, receipts });
  const invoice = ledger.invoices.find((row) => row.voucher_number === "1457");
  assert.equal(Number(invoice.paid_amount.toFixed(2)), 1149.35);
  assert.equal(invoice.status, "Partial");
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 1149.35);
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

test("matchPaymentsFifo Payment leftover without Purchases settles open sales", () => {
  const { allocations, invoices, paymentAppliedToSales, unmatchedReceiptAmount } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-01-15", amount: 800, vch_no: "R1" },
      { receipt_date: "2026-01-20", amount: -230, vch_no: "PV-1", vch_type: "Payment" },
    ],
  );

  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 230);
  assert.equal(Number(unmatchedReceiptAmount.toFixed(2)), 0);
  assert.equal(allocations.length, 2);
  assert.equal(Number(invoices[0].remaining.toFixed(2)), 120);
  const cash = allocations.find((row) => row.vch_no === "R1");
  const payment = allocations.find((row) => row.vch_no === "PV-1");
  assert.equal(Boolean(cash?.is_payment), false);
  assert.equal(Boolean(payment?.is_payment), true);

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-01-15", amount: 800, vch_no: "R1" },
      { receipt_date: "2026-01-20", amount: -230, vch_no: "PV-1", vch_type: "Payment" },
    ],
  });
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 1030);
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 120);
  const settled = ledger.invoices[0].settlements.find((row) => row.vch_no === "PV-1");
  assert.equal(Boolean(settled?.is_payment), true);
  // Customer 1231 Payment 384: leftover closes AR but must stay labelled Payment/Dr, not Rcpt.
  assert.equal(Number(settled?.amount.toFixed(2)), 230);
});

test("matchPaymentsFifo exact Payment↔Purchase amount pairs go to matchedPurchasePayments", () => {
  const { matchedPurchasePayments, purchaseAllocations, paymentAppliedToSales } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 1000, category: "Paper" },
    ],
    [
      { receipt_date: "2025-09-02", amount: 10608.75, vch_no: "46", vch_type: "Purchase" },
      { receipt_date: "2025-09-02", amount: -10608.75, vch_no: "374", vch_type: "Payment" },
      { receipt_date: "2025-10-02", amount: 10608.75, vch_no: "90", vch_type: "Purchase" },
      { receipt_date: "2025-10-15", amount: -10608.75, vch_no: "604", vch_type: "Payment" },
    ],
  );

  assert.equal(matchedPurchasePayments.length, 2);
  assert.equal(purchaseAllocations.length, 0);
  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 0);
  assert.equal(matchedPurchasePayments[0].purchase_voucher, "46");
  assert.equal(matchedPurchasePayments[0].payment_voucher, "374");
  assert.equal(matchedPurchasePayments[0].match_days, 0);
  assert.equal(matchedPurchasePayments[1].purchase_voucher, "90");
  assert.equal(matchedPurchasePayments[1].payment_voucher, "604");
  assert.equal(matchedPurchasePayments[1].match_days, 13);

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2025-09-02", amount: 10608.75, vch_no: "46", vch_type: "Purchase" },
      { receipt_date: "2025-09-02", amount: -10608.75, vch_no: "374", vch_type: "Payment" },
      { receipt_date: "2025-10-02", amount: 10608.75, vch_no: "90", vch_type: "Purchase" },
      { receipt_date: "2025-10-15", amount: -10608.75, vch_no: "604", vch_type: "Payment" },
    ],
  });
  assert.equal(ledger.matchedPurchasePayments.length, 2);
  assert.equal(Number(ledger.totals.matched_purchase_payment_amount.toFixed(2)), 21217.5);
  assert.equal(ledger.purchases.length, 0);
});

test("matchPaymentsFifo refunds a reversed sale instead of advancing the receipt", () => {
  // 1020C: sale 2214 collected by 378, CN 92 reverses it, Payment P-1061 refunds
  // (1,661 vs 1,661.75). Without pairing, 378 wrongly pays later sale 2270 and
  // P-1061 stays "Not adjusted against an invoice".
  const transactions = [
    { transaction_date: "2025-12-17", voucher_number: "2214", voucher_type: "Sales", sales_amount: 1445, category: "Paper" },
    { transaction_date: "2025-12-18", voucher_number: "92", voucher_type: "Credit Note", sales_amount: -1445, category: "Paper" },
    { transaction_date: "2025-12-22", voucher_number: "2270", voucher_type: "Sales", sales_amount: 25848, category: "Paper" },
  ];
  const receipts = [
    { receipt_date: "2025-12-17", vch_type: "Receipt", vch_no: "378", amount: 1661.75 },
    { receipt_date: "2025-12-18", vch_type: "Payment", vch_no: "P-1061", amount: -1661 },
  ];

  const paired = pairRefundsForReversedSales(
    findImmediateCreditNoteReversals(
      buildSalesInvoices(transactions),
      buildCreditNotes(transactions),
    ).reversals,
    receipts,
  );
  assert.equal(paired.refundMatches.length, 1);
  assert.equal(paired.refundMatches[0].invoice_voucher, "2214");
  assert.equal(paired.refundMatches[0].payment_voucher, "P-1061");
  assert.equal(paired.refundMatches[0].receipt_voucher, "378");

  const { allocations, invoices, reversedSaleRefunds, unmatchedReceiptAmount } = matchPaymentsFifo(
    transactions,
    receipts,
  );
  assert.equal(reversedSaleRefunds.length, 1);
  assert.equal(reversedSaleRefunds[0].invoice_voucher, "2214");
  assert.equal(allocations.filter((row) => row.voucher_number === "2270").length, 0);
  assert.equal(Number(invoices.find((row) => row.voucher_number === "2270").remaining.toFixed(2)), 29725.2);
  assert.equal(Number(unmatchedReceiptAmount.toFixed(2)), 0);

  const ledger = buildPaymentSettlementLedger({ transactions, receipts });
  const paymentDay = ledger.datewise.find((day) => day.date === "2025-12-18");
  const payment = paymentDay.receipts.find((row) => row.vch_no === "P-1061");
  assert.ok(payment);
  assert.equal(payment.applications.length, 1);
  assert.equal(payment.applications[0].voucher_number, "2214");
  assert.equal(payment.applications[0].status, "Refund");
  assert.equal(Number(payment.ar_amount.toFixed(2)), 0);

  const receiptDay = ledger.datewise.find((day) => day.date === "2025-12-17");
  const collection = receiptDay.receipts.find((row) => row.vch_no === "378");
  assert.equal(Number(collection.ar_amount.toFixed(2)), 0);
  assert.equal(collection.applications[0].status, "Reversed");
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 0);
  assert.equal(Number(ledger.invoices.find((row) => row.voucher_number === "2270").remaining.toFixed(2)), 29725.2);
});

test("matchPaymentsFifo exact full-bill receipt claims that invoice before older FIFO", () => {
  // 1171C-style: receipt 1797 equals NFD/1411; oldest-open would park it on 1215.
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-07-26", voucher_number: "NFD/1215", sales_amount: 21000, category: "Paper" },
      { transaction_date: "2026-08-15", voucher_number: "NFD/1411", sales_amount: 24605.8, category: "Paper" },
    ],
    [
      { receipt_date: "2026-09-22", amount: 28296.67, vch_no: "1797", vch_type: "Receipt" },
    ],
  );

  const paid1411 = allocations.filter((row) => row.voucher_number === "NFD/1411");
  const paid1215 = allocations.filter((row) => row.voucher_number === "NFD/1215");
  assert.equal(paid1411.length, 1);
  assert.equal(Number(paid1411[0].amount.toFixed(2)), 28296.67);
  assert.equal(paid1215.length, 0);
  assert.equal(Number(invoices.find((row) => row.voucher_number === "NFD/1411").remaining.toFixed(2)), 0);
  assert.equal(Number(invoices.find((row) => row.voucher_number === "NFD/1215").remaining.toFixed(2)), 24150);
});

test("matchPaymentsFifo settles dual-party Payment against Purchase before sales", () => {
  const {
    allocations,
    invoices,
    purchaseAllocations,
    purchases,
    paymentAppliedToPurchases,
    paymentAppliedToSales,
  } = matchPaymentsFifo(
    [
      // Paper +15% VAT → 57,500 incl; receipt 35,436.10 leaves AR open.
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 50000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-02-11", amount: 70437.5, vch_no: "51", vch_type: "Purchase" },
      { receipt_date: "2026-02-14", amount: 39387.5, vch_no: "58", vch_type: "Purchase" },
      { receipt_date: "2026-02-19", amount: -99679.39, vch_no: "Sep//Bpmt0125", vch_type: "Payment" },
      { receipt_date: "2026-01-25", amount: 35436.1, vch_no: "140", vch_type: "Receipt" },
    ],
  );

  assert.equal(Number(paymentAppliedToPurchases.toFixed(2)), 99679.39);
  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 0);
  assert.equal(purchaseAllocations.length, 2);
  assert.equal(Number(purchaseAllocations[0].amount.toFixed(2)), 70437.5);
  assert.equal(purchaseAllocations[0].purchase_voucher, "51");
  assert.equal(Number(purchaseAllocations[1].amount.toFixed(2)), 29241.89);
  assert.equal(purchaseAllocations[1].purchase_voucher, "58");
  assert.equal(Number(purchases[0].remaining.toFixed(2)), 0);
  // The slice no Payment covered settles the earlier sales invoice. It is not cash.
  assert.equal(Number(purchases[1].remaining.toFixed(2)), 0);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].vch_no, "140");
  assert.equal(Number(allocations[0].amount.toFixed(2)), 35436.1);
  assert.equal(Number(invoices[0].remaining.toFixed(2)), 11918.29);

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 50000, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-02-11", amount: 70437.5, vch_no: "51", vch_type: "Purchase" },
      { receipt_date: "2026-02-14", amount: 39387.5, vch_no: "58", vch_type: "Purchase" },
      { receipt_date: "2026-02-19", amount: -99679.39, vch_no: "Sep//Bpmt0125", vch_type: "Payment" },
      { receipt_date: "2026-01-25", amount: 35436.1, vch_no: "140", vch_type: "Receipt" },
    ],
  });
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 35436.1);
  const sepDay = ledger.datewise.find((row) => row.date === "2026-02-19");
  assert.equal(Number(sepDay.collected_amount.toFixed(2)), 0);
  assert.equal(sepDay.receipts[0].vch_no, "Sep//Bpmt0125");
  assert.equal(sepDay.receipts[0].applications.length, 2);
  assert.equal(
    Number(sepDay.receipts[0].applications.reduce((total, row) => total + row.amount, 0).toFixed(2)),
    99679.39,
  );
  assert.ok(sepDay.receipts[0].applications.every((row) => row.target_kind === "purchase"));
  assert.equal(Number(ledger.totals.payment_applied_to_purchases.toFixed(2)), 99679.39);
  assert.equal(Number(ledger.totals.open_purchase_amount.toFixed(2)), 0);
  assert.equal(Number(ledger.totals.purchase_applied_to_sales.toFixed(2)), 10145.61);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 35436.1);
  assert.ok(ledger.settlementEvents.some((row) => (
    row.target_kind === "purchase" && row.vch_no === "Sep//Bpmt0125"
  )));
});

test("matchPaymentsFifo Purchase with no Payment settles earlier sales and not a later invoice", () => {
  const { purchaseSalesAllocations, invoices, allocations, purchases } = matchPaymentsFifo(
    [
      { transaction_date: "2026-05-20", voucher_number: "NFD/845", sales_amount: 5578.5, category: "Stationery" },
      { transaction_date: "2026-10-15", voucher_number: "RNFD/573", sales_amount: 5857, category: "Stationery" },
    ],
    [
      { receipt_date: "2026-06-20", amount: 2880, vch_no: "P-165", vch_type: "Purchase" },
      { receipt_date: "2026-10-13", amount: 3000, vch_no: "1965", vch_type: "Receipt" },
    ],
  );

  assert.equal(purchaseSalesAllocations.length, 1);
  assert.equal(purchaseSalesAllocations[0].purchase_voucher, "P-165");
  assert.equal(purchaseSalesAllocations[0].voucher_number, "NFD/845");
  assert.equal(Number(purchaseSalesAllocations[0].amount.toFixed(2)), 2880);
  assert.equal(Number(purchases[0].remaining.toFixed(2)), 0);
  assert.ok(allocations.every((row) => row.vch_no !== "P-165"));
  assert.equal(allocations[0].voucher_number, "NFD/845");
  const earlier = invoices.find((row) => row.voucher_number === "NFD/845");
  const later = invoices.find((row) => row.voucher_number === "RNFD/573");
  assert.ok(Math.abs(earlier.remaining - (5578.5 * 1.15 - 2880 - 3000)) < 0.02);
  assert.equal(Number(later.remaining.toFixed(2)), Number((5857 * 1.15).toFixed(2)));

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-05-20", voucher_number: "NFD/845", sales_amount: 5578.5, category: "Stationery" },
      { transaction_date: "2026-10-15", voucher_number: "RNFD/573", sales_amount: 5857, category: "Stationery" },
    ],
    receipts: [
      { receipt_date: "2026-06-20", amount: 2880, vch_no: "P-165", vch_type: "Purchase" },
      { receipt_date: "2026-10-13", amount: 3000, vch_no: "1965", vch_type: "Receipt" },
    ],
  });
  const purchaseDay = ledger.datewise.find((row) => row.date === "2026-06-20");
  assert.equal(purchaseDay.purchases[0].applications.length, 1);
  assert.equal(purchaseDay.purchases[0].applications[0].voucher_number, "NFD/845");
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 3000);
  assert.equal(Number(ledger.totals.purchase_applied_to_sales.toFixed(2)), 2880);
  assert.equal(ledger.totals.sales_collected_matches_open, true);
  const settled = ledger.invoices.find((row) => row.voucher_number === "NFD/845");
  assert.equal(settled.purchase_settlements.length, 1);
  assert.equal(settled.purchase_settlements[0].voucher_number, "P-165");
});

test("matchPaymentsFifo open Purchase does not settle a sales invoice dated after it", () => {
  const { purchaseSalesAllocations, invoices, purchases } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "OLD", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-10-08", voucher_number: "LATER", sales_amount: 2000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-02-01", amount: 1150, vch_no: "R1", vch_type: "Receipt" },
      { receipt_date: "2026-06-20", amount: 2880, vch_no: "P-165", vch_type: "Purchase" },
    ],
  );

  assert.equal(purchaseSalesAllocations.length, 0);
  assert.equal(Number(purchases[0].remaining.toFixed(2)), 2880);
  assert.equal(Number(invoices.find((row) => row.voucher_number === "OLD").remaining.toFixed(2)), 0);
  assert.equal(Number(invoices.find((row) => row.voucher_number === "LATER").remaining.toFixed(2)), 2300);
});

test("matchPaymentsFifo Payment leftover after Purchases settles sales invoices", () => {
  const { allocations, invoices, paymentAppliedToPurchases, paymentAppliedToSales } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "S1", sales_amount: 1000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-01-05", amount: 400, vch_no: "P1", vch_type: "Purchase" },
      { receipt_date: "2026-01-10", amount: 500, vch_no: "R1", vch_type: "Receipt" },
      { receipt_date: "2026-01-20", amount: -600, vch_no: "PV-1", vch_type: "Payment" },
    ],
  );

  assert.equal(Number(paymentAppliedToPurchases.toFixed(2)), 400);
  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 200);
  assert.equal(allocations.length, 2);
  assert.equal(Number(allocations[0].amount.toFixed(2)), 500);
  assert.equal(allocations[1].vch_no, "PV-1");
  assert.equal(Number(allocations[1].amount.toFixed(2)), 200);
  assert.equal(Number(invoices[0].remaining.toFixed(2)), 450);
});

test("matchPaymentsFifo applies a 0.01 payment to the open invoice instead of dropping it", () => {
  const { allocations, invoices, paymentAppliedToSales, paymentAppliedToPurchases, unmatchedReceiptAmount } = matchPaymentsFifo(
    [
      { transaction_date: "2026-10-04", voucher_number: "DNFD/119", sales_amount: 5814, category: "Office supplies" },
    ],
    [
      { receipt_date: "2026-10-13", amount: -0.01, vch_no: "VP-2", vch_type: "Payment" },
      { receipt_date: "2026-10-13", amount: -0.01, vch_no: "VP-5", vch_type: "Payment" },
    ],
  );

  assert.equal(Number(paymentAppliedToPurchases.toFixed(2)), 0);
  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 0.02);
  assert.ok(unmatchedReceiptAmount < 0.000001);
  const hits = allocations.filter((row) => row.vch_no === "VP-2" || row.vch_no === "VP-5");
  assert.equal(hits.length, 2);
  assert.ok(hits.every((row) => row.voucher_number === "DNFD/119" && row.invoice_date === "2026-10-04"));
  assert.equal(Number(hits.reduce((total, row) => total + row.amount, 0).toFixed(2)), 0.02);
  assert.equal(Number((5814 * 1.15 - invoices[0].remaining).toFixed(2)), 0.02);

  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-10-04", voucher_number: "DNFD/119", sales_amount: 5814, category: "Office supplies" },
    ],
    receipts: [
      { receipt_date: "2026-10-13", amount: -0.01, vch_no: "VP-2", vch_type: "Payment" },
      { receipt_date: "2026-10-13", amount: -0.01, vch_no: "VP-5", vch_type: "Payment" },
    ],
    todayIso: "2026-10-17",
  });
  const day = ledger.datewise.find((row) => row.date === "2026-10-13");
  assert.equal(day.receipts.length, 2);
  assert.ok(day.receipts.every((row) => (
    row.applications.length === 1
    && row.applications[0].target_kind === "sales"
    && row.applications[0].voucher_number === "DNFD/119"
  )));
});

test("matchPaymentsFifo applies a 0.01 payment to an open purchase instead of dropping it", () => {
  const { purchaseAllocations, paymentAppliedToPurchases, paymentAppliedToSales } = matchPaymentsFifo(
    [],
    [
      { receipt_date: "2026-10-01", amount: 50, vch_no: "P1", vch_type: "Purchase" },
      { receipt_date: "2026-10-13", amount: -0.01, vch_no: "VP-2", vch_type: "Payment" },
    ],
  );
  assert.equal(Number(paymentAppliedToPurchases.toFixed(2)), 0.01);
  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 0);
  assert.equal(purchaseAllocations.length, 1);
  assert.equal(purchaseAllocations[0].purchase_voucher, "P1");
  assert.equal(purchaseAllocations[0].vch_no, "VP-2");
});

test("matchPaymentsFifo Sep//Bpmt0125-style Payment settles Purchases and leftover Payment settles sales", () => {
  const receipts = [
    { receipt_date: "2025-09-02", amount: -10608.75, vch_no: "374", vch_type: "Payment" },
    { receipt_date: "2025-09-02", amount: 10608.75, vch_no: "46", vch_type: "Purchase" },
    { receipt_date: "2025-10-02", amount: 10608.75, vch_no: "90", vch_type: "Purchase" },
    { receipt_date: "2025-10-15", amount: -10608.75, vch_no: "604", vch_type: "Payment" },
    { receipt_date: "2025-11-08", amount: 10350, vch_no: "145", vch_type: "Purchase" },
    { receipt_date: "2025-11-08", amount: 5043.9, vch_no: "146", vch_type: "Purchase" },
    { receipt_date: "2026-01-25", amount: 35436.1, vch_no: "140", vch_type: "Receipt" },
    { receipt_date: "2026-02-11", amount: 70437.5, vch_no: "51", vch_type: "Purchase" },
    { receipt_date: "2026-02-14", amount: 39387.5, vch_no: "58", vch_type: "Purchase" },
    { receipt_date: "2026-02-19", amount: -99679.39, vch_no: "Sep//Bpmt0125", vch_type: "Payment" },
    { receipt_date: "2026-03-05", amount: 6399.75, vch_no: "76", vch_type: "Purchase" },
    { receipt_date: "2026-04-29", amount: -103068, vch_no: "Apr//Bpmt0125", vch_type: "Payment" },
    { receipt_date: "2026-09-15", amount: 644, vch_no: "1734", vch_type: "Receipt" },
  ];
  const transactions = [
    { transaction_date: "2025-11-08", voucher_number: "1658", sales_amount: 23800, category: "Paper" },
    { transaction_date: "2025-11-08", voucher_number: "1659", sales_amount: 20400, category: "Paper" },
    { transaction_date: "2025-12-27", voucher_number: "2332", sales_amount: 11440, category: "Paper" },
    { transaction_date: "2026-08-24", voucher_number: "NFD/1516", sales_amount: 560, category: "Paper" },
    { transaction_date: "2026-09-29", voucher_number: "NFD/1875", sales_amount: 194, category: "Paper" },
    { transaction_date: "2026-10-08", voucher_number: "NFD/1942", sales_amount: 60400, category: "Paper" },
  ];
  const { purchaseAllocations, allocations, invoices, paymentAppliedToSales } = matchPaymentsFifo(
    transactions,
    receipts,
  );

  const sepPurchase = purchaseAllocations
    .filter((row) => row.vch_no === "Sep//Bpmt0125")
    .reduce((total, row) => total + row.amount, 0);
  assert.equal(Number(sepPurchase.toFixed(2)), 99679.39);
  assert.ok(paymentAppliedToSales > 0.009);
  assert.ok(allocations.some((row) => row.vch_no === "Apr//Bpmt0125"));
  const open = invoices.reduce((total, row) => total + row.remaining, 0);
  // Must not inflate open above sales (old reverse path pushed NFD/1942 above its bill).
  assert.ok(open < 134313.1);
  assert.ok(invoices.every((row) => row.remaining <= row.amount + 0.02));
});

test("matchPaymentsFifo Payment leftover does not settle a sales invoice dated after the payment", () => {
  const { allocations, invoices, unmatchedReceiptAmount, paymentAppliedToSales } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "OLD", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-10-08", voucher_number: "LATER", sales_amount: 2000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-04-29", amount: -5000, vch_no: "Apr//Bpmt0125", vch_type: "Payment" },
    ],
  );

  assert.equal(Number(paymentAppliedToSales.toFixed(2)), 1150);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].voucher_number, "OLD");
  assert.equal(Number(invoices.find((row) => row.voucher_number === "LATER").remaining.toFixed(2)), 2300);
  assert.equal(Number(unmatchedReceiptAmount.toFixed(2)), 3850);
});

test("matchPaymentsFifo Payment leftover refunds unmatched overcollection (1424 Bpmt0057)", () => {
  const transactions = [
    {
      transaction_date: "2026-04-14",
      voucher_number: "CNFD/APR/014",
      voucher_type: "CASH SALES NON FOOD DIVISION",
      sales_amount: 2905,
      category: "Paper",
    },
    { transaction_date: "2026-04-19", voucher_number: "NFD/451", sales_amount: 515, category: "Paper" },
    { transaction_date: "2026-04-27", voucher_number: "NFD/509", sales_amount: 480, category: "Paper" },
    { transaction_date: "2026-05-12", voucher_number: "NFD/725", sales_amount: 580, category: "Paper" },
    { transaction_date: "2026-05-20", voucher_number: "NFD/844", sales_amount: 465, category: "Paper" },
    { transaction_date: "2026-05-21", voucher_number: "NFD/854", sales_amount: 465, category: "Paper" },
  ];
  const receipts = [
    { receipt_date: "2026-04-20", amount: 3340.75, vch_no: "675", vch_type: "Receipt" },
    { receipt_date: "2026-06-02", amount: 6221.5, vch_no: "957", vch_type: "Receipt" },
    { receipt_date: "2026-06-16", amount: -3340.75, vch_no: "Jun/Bpmt0057", vch_type: "Payment" },
  ];

  const matched = matchPaymentsFifo(transactions, receipts);
  assert.equal(Number(matched.paymentRefundedUnmatched.toFixed(2)), 3340.75);
  assert.equal(Number(matched.paymentAppliedToSales.toFixed(2)), 0);
  assert.ok(matched.unmatchedReceiptAmount < 0.01);
  assert.equal(matched.paymentUnmatchedRefunds.length, 1);
  assert.equal(matched.paymentUnmatchedRefunds[0].payment_voucher, "Jun/Bpmt0057");
  assert.equal(matched.paymentUnmatchedRefunds[0].invoice_voucher, "CNFD/APR/014");
  assert.ok(matched.invoices.every((row) => row.remaining <= 0.009));

  const ledger = buildPaymentSettlementLedger({ transactions, receipts });
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 6221.5);
  assert.equal(Number(ledger.totals.payment_refunded_unmatched.toFixed(2)), 3340.75);
  assert.ok(Math.abs(ledger.totals.balance_delta) <= 0.02);

  const paymentDay = ledger.datewise.find((day) => day.date === "2026-06-16");
  const payment = paymentDay.receipts.find((row) => row.vch_no === "Jun/Bpmt0057");
  assert.ok(payment);
  assert.equal(Number(payment.ar_amount.toFixed(2)), -3340.75);
  assert.equal(payment.applications.length, 1);
  assert.equal(payment.applications[0].status, "Refund");
  assert.equal(payment.applications[0].voucher_number, "CNFD/APR/014");
});

test("matchPaymentsFifo applies an advance receipt to the next customer invoice", () => {
  const { allocations, invoices, unmatchedReceiptAmount } = matchPaymentsFifo(
    [
      {
        transaction_date: "2026-04-02",
        voucher_number: "NFD/334",
        sales_amount: 86362.5,
        category: "Building Material",
      },
    ],
    [{ receipt_date: "2026-04-01", amount: 99316.88, vch_no: "537" }],
  );

  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].voucher_number, "NFD/334");
  assert.ok(invoices[0].remaining <= 0.009);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].receipt_date, "2026-04-01");
  assert.equal(allocations[0].vch_no, "537");
  assert.equal(allocations[0].days, 0);
  assert.ok(unmatchedReceiptAmount <= 0.01);
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
  // Open 14d is below paid avg â†’ excluded; open 90d is included
  // Blended: (11500 + 34500 + 45000) / 2800 â‰ˆ 32.5 â†’ 33
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

  // Paid-only = 100 days; open 1d < 100 â†’ excluded
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

test("isCashSalesVoucher detects RC/DC/JC and skips credit notes", () => {
  assert.equal(isCashSalesVoucher("RC/100"), true);
  assert.equal(isCashSalesVoucher("DC/12"), true);
  assert.equal(isCashSalesVoucher("JC-9"), true);
  assert.equal(isCashSalesVoucher("NFD/902"), false);
  assert.equal(isCashSalesVoucher("RNFD/190"), false);
  assert.equal(isCashSalesVoucher("CNFD/APR/024"), false);
  assert.equal(isCashSalesVoucher("CN/149"), false);
});

test("cash vouchers stay out of the amount-weighted avg days", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-01-01",
        voucher_number: "RC/1",
        voucher_type: "RIYADH CASH SALES",
        sales_amount: 1000,
        category: "Gloves",
        item_name: "Nitrile Gloves",
      },
      {
        transaction_date: "2026-01-01",
        voucher_number: "CNFD/APR/013",
        voucher_type: "CASH SALES NON FOOD DIVISION",
        sales_amount: 1000,
        category: "Gloves",
        item_name: "Nitrile Gloves",
      },
      {
        transaction_date: "2026-01-10",
        voucher_number: "NFD/2",
        voucher_type: "RIYADH W/S CREDIT",
        sales_amount: 100000,
        category: "Gloves",
        item_name: "Nitrile Gloves",
      },
    ],
    receipts: [
      { receipt_date: "2026-01-02", amount: 1000 },
      { receipt_date: "2026-01-03", amount: 1000 },
      { receipt_date: "2026-02-09", amount: 100000 },
    ],
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "RC/9", pending_amount: 50000, invoice_day: 200 },
    ],
    todayIso: "2026-03-01",
  });

  const cash = ledger.invoices.find((row) => row.voucher_number === "RC/1");
  const cnfd = ledger.invoices.find((row) => row.voucher_number === "CNFD/APR/013");
  const credit = ledger.invoices.find((row) => row.voucher_number === "NFD/2");
  assert.equal(cash.status, "Paid");
  assert.equal(cash.payment_days, null);
  assert.equal(cnfd.payment_days, null);
  assert.equal(credit.payment_days, 30);
  assert.equal(ledger.summary.avgDaysToPay, 30);
  assert.equal(ledger.summary.openAmountInAvg, 0);
});

test("first receipt after cash voucher settles cash before older credit invoices", () => {
  // Older credit open, then cash RC â€” first receipt after RC must clear RC first.
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-08-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-09-13", voucher_number: "RC/100", sales_amount: 2000, category: "Paper" },
    ],
    [{ receipt_date: "2026-09-14", amount: 2300 }],
  );

  assert.equal(allocations[0].voucher_number, "RC/100");
  assert.equal(Number(allocations[0].amount.toFixed(2)), 2300);
  const cash = invoices.find((row) => row.voucher_number === "RC/100");
  const credit = invoices.find((row) => row.voucher_number === "NFD/1");
  assert.equal(Number(cash.remaining.toFixed(2)), 0);
  assert.equal(Number(credit.remaining.toFixed(2)), 1150);
});

test("cash receipt leftover after RC goes to credit invoices on FIFO", () => {
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-08-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-08-15", voucher_number: "NFD/2", sales_amount: 500, category: "Paper" },
      { transaction_date: "2026-09-13", voucher_number: "RC/100", sales_amount: 800, category: "Paper" },
    ],
    [{ receipt_date: "2026-09-14", amount: 2000 }],
  );

  // RC 800*1.15=920 first; leftover 1080 â†’ NFD/1 1150 (partial 1080)
  assert.equal(allocations[0].voucher_number, "RC/100");
  assert.equal(Number(allocations[0].amount.toFixed(2)), 920);
  assert.equal(allocations[1].voucher_number, "NFD/1");
  assert.equal(Number(allocations[1].amount.toFixed(2)), 1080);
  const nfd1 = invoices.find((row) => row.voucher_number === "NFD/1");
  const nfd2 = invoices.find((row) => row.voucher_number === "NFD/2");
  assert.equal(Number(nfd1.remaining.toFixed(2)), 70);
  assert.equal(Number(nfd2.remaining.toFixed(2)), 575);
});

test("a receipt older than a cash invoice waits while older bills are still open", () => {
  // Customer 1224 style: Rcpt 675 on 2026-04-20 must not jump to cash DC/0024 on 2026-09-19.
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-03-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-09-19", voucher_number: "DC/0024", sales_amount: 2000, category: "Paper" },
    ],
    [{ receipt_date: "2026-04-20", amount: 800 }],
  );

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].voucher_number, "NFD/1");
  assert.equal(Number(allocations[0].amount.toFixed(2)), 800);
  const cash = invoices.find((row) => row.voucher_number === "DC/0024");
  assert.equal(Number(cash.remaining.toFixed(2)), 2300);
});

test("a receipt older than a cash invoice settles it when nothing older is pending", () => {
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-03-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-09-19", voucher_number: "DC/0024", sales_amount: 2000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-03-05", amount: 1150 },
      { receipt_date: "2026-04-20", amount: 800 },
    ],
  );

  // First receipt clears the older credit bill, so the April receipt can reach the cash sale.
  assert.equal(allocations[0].voucher_number, "NFD/1");
  assert.equal(allocations[1].voucher_number, "DC/0024");
  assert.equal(Number(allocations[1].amount.toFixed(2)), 800);
  const cash = invoices.find((row) => row.voucher_number === "DC/0024");
  assert.equal(Number(cash.remaining.toFixed(2)), 1500);
});

test("second receipt after cash uses normal FIFO including unfinished cash", () => {
  // First receipt after RC is tiny â€” marks cash priority used; second receipt is plain FIFO.
  const { allocations } = matchPaymentsFifo(
    [
      { transaction_date: "2026-08-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-09-13", voucher_number: "RC/100", sales_amount: 2000, category: "Paper" },
    ],
    [
      { receipt_date: "2026-09-14", amount: 100 },
      { receipt_date: "2026-09-20", amount: 3000 },
    ],
  );

  assert.equal(allocations[0].voucher_number, "RC/100");
  assert.equal(Number(allocations[0].amount.toFixed(2)), 100);
  // Second receipt: oldest open first â†’ finish NFD/1 then RC
  assert.equal(allocations[1].voucher_number, "NFD/1");
  assert.equal(allocations[2].voucher_number, "RC/100");
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

test("building-material safety gloves on NFD/436 take 15% VAT", () => {
  const invoices = buildSalesInvoices([
    { transaction_date: "2026-04-15", voucher_number: "NFD/436", sales_amount: 6319, category: "Building Material", item_name: "Safety Helmet" },
    {
      transaction_date: "2026-04-15",
      voucher_number: "NFD/436",
      sales_amount: 608,
      category: "Building Material",
      item_code: "LP00318",
      item_name: "LP00318_Latex Gloves Crinkle Orange LGC Hi-Tex, 250 Pair/ Cartoon",
    },
  ]);

  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].amount_excl_vat, 6927);
  assert.equal(Number(invoices[0].amount.toFixed(2)), 7966.05);
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
    // open 610 on P1 â†’ collected must be 2000 for identity
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
  // FIFO open on P1 after 2000 cash (gloves 1000 + paper 1000) = 150 â€” not forced to outstanding 610.
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 150);
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 610);
  assert.equal(ledger.totals.open_matches_outstanding, false);
  assert.equal(Number(paper.paid_amount.toFixed(2)), Number(paper.fifo_paid.toFixed(2)));
  assert.equal(ledger.reversedInvoices.length, 1);
});

test("a plain receipt that copies a same-day DG receipt is left out of datewise", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [],
    receipts: [
      { receipt_date: "2026-05-05", amount: 1680, vch_no: "DG-JV/MAY/00001", vch_type: "Discount Given" },
      { receipt_date: "2026-05-05", amount: 1680, vch_no: "JV/MAY/00001", vch_type: "Receipt" },
      { receipt_date: "2026-05-05", amount: 252, vch_no: "VAT-DG-JV/MAY/00001", vch_type: "Discount Given" },
    ],
    todayIso: "2026-05-06",
  });
  const day = ledger.datewise.find((row) => row.date === "2026-05-05");
  assert.deepEqual(day.receipts.map((row) => row.vch_no), ["DG-JV/MAY/00001", "VAT-DG-JV/MAY/00001"]);
  assert.equal(day.collected_amount, 1932);
});

test("receipt 1879 is left off the customer when 1880 is the same amount that day", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-10-04", voucher_number: "RC/124", sales_amount: 36693.16, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-10-04", amount: 40000, vch_no: "1879", vch_type: "Receipt" },
      { receipt_date: "2026-10-04", amount: 40000, vch_no: "1880", vch_type: "Receipt" },
    ],
    todayIso: "2026-10-23",
  });
  const invoice = ledger.invoices.find((row) => row.voucher_number === "RC/124");
  assert.deepEqual(invoice.settlements.map((row) => row.vch_no), ["1880"]);
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
  const day1 = ledger.datewise.find((row) => row.date === "2026-01-01");
  assert.ok(day1);
  assert.equal(day1.invoices.length, 1);
  assert.equal(day1.invoices[0].voucher_number, "1");
  assert.equal(day1.receipts.length, 0);
  const dayReceipt = ledger.datewise.find((row) => row.date === "2026-01-31");
  assert.ok(dayReceipt);
  assert.equal(dayReceipt.invoices.length, 0);
  assert.equal(dayReceipt.receipts.length, 1);
  assert.equal(dayReceipt.receipts[0].vch_no, "R1");
  assert.equal(ledger.settlementEvents.length, 2);
  // Paid: 1150@30 + 200@21 => paid-only â‰ˆ 29
  // Open FIFO residual 375@26 is younger than paid avg â†’ excluded
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
  // Open-only avg: (14795*112 + 61312*46) / 76107 â‰ˆ 59
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
  // Paid must equal FIFO cash on the row â€” not sales âˆ’ outstanding pending (19,555.15).
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

test("truncated sales window with full receipts skews avg days vs full ledger", () => {
  // Older invoice paid slowly (100d) + newer invoice paid quickly (10d).
  // Truncating sales to only the recent month (while keeping all receipts)
  // applies the early receipt to the wrong invoice set and inflates avg days.
  const allTransactions = [
    { transaction_date: "2025-06-01", voucher_number: "OLD", sales_amount: 10000, category: "Paper" },
    { transaction_date: "2026-08-01", voucher_number: "NEW", sales_amount: 1000, category: "Paper" },
  ];
  const allReceipts = [
    { receipt_date: "2025-09-09", amount: 11500 }, // 100 days on OLD
    { receipt_date: "2026-08-11", amount: 1150 }, // 10 days on NEW
  ];

  const full = buildPaymentBehavior({
    transactions: allTransactions,
    receipts: allReceipts,
    todayIso: "2026-09-21",
  });
  const truncated = buildPaymentBehavior({
    transactions: allTransactions.filter((row) => row.transaction_date >= "2026-03-01"),
    receipts: allReceipts,
    todayIso: "2026-09-21",
    includeSixMonthWindow: false,
  });

  assert.equal(full.avgDaysToPay, 92); // amount-weighted 100d + 10d
  assert.equal(full.avgDaysToPay6m, 10); // only NEW falls in 6m window with its receipt
  assert.equal(full.avgDays6mFromDate, "2026-03-01");
  assert.notEqual(truncated.avgDaysToPay, full.avgDaysToPay);
  assert.ok(
    Math.abs(truncated.avgDaysToPay - full.avgDaysToPay) >= 20,
    `truncated window must not be used for avg days (got ${truncated.avgDaysToPay} vs full ${full.avgDaysToPay})`,
  );
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

test("Sales âˆ’ Collected = Open for balanced reversed + outstanding books", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "INV-REV", sales_amount: 400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "CN-REV", sales_amount: -400, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "INV-OPEN", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "INV-PAID", sales_amount: 500, category: "Paper" },
    ],
    // collected = sales_incl âˆ’ open = 2185 âˆ’ 690 = 1495
    receipts: [{ receipt_date: "2026-01-25", amount: 1495 }],
    outstandingCustomer: { total_outstanding: 690, open_invoices: 1 },
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "INV-OPEN", pending_amount: 690, invoice_day: 24 },
    ],
    todayIso: "2026-01-25",
  });

  assert.equal(Number(ledger.totals.net_sales_incl_vat.toFixed(2)), 2185);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 1495);
  // FIFO open after cash â€” not forced to outstanding pending 690.
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
      // Credit note several days later â€” not an immediate reversal pair.
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
  // Machine open also applies unpaired CN in date order: 1150 âˆ’ 230 CN âˆ’ 500 cash = 420.
  assert.equal(Number(ledger.totals.open_sales_amount.toFixed(2)), 420);
  assert.equal(Number(ledger.totals.outstanding_unpaid.toFixed(2)), 420);
  const inv1 = ledger.invoices.find((row) => row.voucher_number === "INV1");
  // Unreferenced CN FIFO-settles Open and counts in Paid like a receipt.
  assert.equal(Number(inv1.fifo_paid.toFixed(2)), 500);
  assert.equal(Number(inv1.credit_note_settled.toFixed(2)), 230);
  assert.equal(Number(inv1.paid_amount.toFixed(2)), 730);
  assert.equal(Number(inv1.outstanding_pending.toFixed(2)), 420);
});

test("referenced credit note settles the named invoice (2395-style)", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "2395", sales_amount: 10220, category: "Paper" },
      { transaction_date: "2026-01-25", voucher_number: "2749", sales_amount: 2000, category: "Paper" },
      {
        transaction_date: "2026-02-10",
        voucher_number: "56",
        voucher_type: "Credit Note",
        reference: "2395",
        sales_amount: -1320,
        category: "Paper",
      },
    ],
    receipts: [
      { receipt_date: "2026-02-16", amount: 7855, vch_no: "314" },
      { receipt_date: "2026-02-22", amount: 2380, vch_no: "362" },
    ],
    outstandingInvoices: [],
    todayIso: "2026-03-01",
  });

  const first = ledger.invoices.find((row) => row.voucher_number === "2395");
  const next = ledger.invoices.find((row) => row.voucher_number === "2749");
  assert.ok(first);
  assert.ok(next);
  // CN 56 (1320×1.15=1518) settles named bill 2395. Later cash pays the rest. 2749 is untouched.
  assert.equal(Number(first.amount_excl_vat.toFixed(2)), 10220);
  assert.equal(Number(first.amount_incl_vat.toFixed(2)), 11753);
  assert.equal(Number(first.credit_note_settled.toFixed(2)), 1518);
  assert.equal(Number(first.fifo_paid.toFixed(2)), 10235);
  assert.equal(Number(first.paid_amount.toFixed(2)), 11753);
  assert.equal(Number(first.remaining.toFixed(2)), 0);
  assert.equal(first.status, "Paid");
  assert.deepEqual(first.fifo_credit_notes.map((row) => row.voucher_number), ["56"]);
  assert.equal(Number(next.credit_note_settled.toFixed(2)), 0);
  assert.equal(Number(next.paid_amount.toFixed(2)), 0);
  assert.equal(Number(next.remaining.toFixed(2)), 2300);
  assert.equal(Number(ledger.totals.credit_note_amount.toFixed(2)), 1518);
  assert.equal(Number(ledger.totals.credit_note_excl_vat.toFixed(2)), 1320);
});

test("referenced credit note fills the named bill before any leftover", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "2395", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-25", voucher_number: "2749", sales_amount: 1000, category: "Paper" },
      {
        transaction_date: "2026-02-10",
        voucher_number: "56",
        voucher_type: "Credit Note",
        reference: "2395",
        // Larger than the named bill. Named bill takes its full amount; leftover hits the next open bill.
        sales_amount: -1500,
        category: "Paper",
      },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-03-01",
  });

  const first = ledger.invoices.find((row) => row.voucher_number === "2395");
  const next = ledger.invoices.find((row) => row.voucher_number === "2749");
  assert.ok(first);
  assert.ok(next);
  assert.equal(Number(first.amount_incl_vat.toFixed(2)), 1150);
  // 1725 CN fills named 2395 (1150) and the leftover 575 settles 2749.
  assert.equal(Number(first.credit_note_settled.toFixed(2)), 1150);
  assert.equal(Number(first.remaining.toFixed(2)), 0);
  assert.equal(Number(next.credit_note_settled.toFixed(2)), 575);
  assert.equal(Number(next.paid_amount.toFixed(2)), 575);
  assert.equal(Number(next.remaining.toFixed(2)), 575);
});

test("referenced credit notes settle their own Ref. No., not the other bill", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-03-07", voucher_number: "NFD/211", sales_amount: 3765, item_code: "ITEM-A", quantity: 10, category: "Paper" },
      { transaction_date: "2026-03-07", voucher_number: "NFD/212", sales_amount: 4609, item_code: "ITEM-B", quantity: 10, category: "Paper" },
      {
        transaction_date: "2026-08-03",
        voucher_number: "429",
        voucher_type: "Credit Note",
        reference: "NFD/211",
        sales_amount: -1080,
        item_code: "ITEM-A",
        quantity: -4,
        category: "Paper",
      },
      {
        transaction_date: "2026-08-03",
        voucher_number: "430",
        voucher_type: "Credit Note",
        reference: "NFD/212",
        sales_amount: -2488.86,
        item_code: "ITEM-B",
        quantity: -8,
        category: "Paper",
      },
    ],
    receipts: [{ receipt_date: "2026-07-05", amount: 1500, vch_no: "1180" }],
    outstandingInvoices: [],
    todayIso: "2026-09-30",
  });

  const invoice211 = ledger.invoices.find((row) => row.voucher_number === "NFD/211");
  const invoice212 = ledger.invoices.find((row) => row.voucher_number === "NFD/212");
  // Receipt 1500 → 211. CN 429 stays on 211. CN 430 stays on 212.
  assert.deepEqual(invoice211.fifo_credit_notes.map((row) => row.voucher_number), ["429"]);
  assert.deepEqual(invoice212.fifo_credit_notes.map((row) => row.voucher_number), ["430"]);
  assert.equal(Number(invoice211.remaining.toFixed(2)), 1587.75);
  assert.equal(Number(invoice212.remaining.toFixed(2)), 2438.16);
});

test("Outstanding Compare uses FIFO open when CN display attachment differs", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "A-PAID", sales_amount: 100, item_code: "ITEM-A", quantity: 1, category: "Paper" },
      { transaction_date: "2026-01-01", voucher_number: "B-OPEN", sales_amount: 100, item_code: "ITEM-B", quantity: 1, category: "Paper" },
      {
        transaction_date: "2026-01-03",
        voucher_number: "CN-ORPHAN",
        voucher_type: "Credit Note",
        sales_amount: -50,
        item_code: "ITEM-A",
        quantity: 1,
        category: "Paper",
      },
    ],
    receipts: [{ receipt_date: "2026-01-02", amount: 115, vch_no: "R1" }],
    outstandingInvoices: [
      { invoice_date: "2026-01-01", ref_no: "A-PAID", pending_amount: 0 },
      { invoice_date: "2026-01-01", ref_no: "B-OPEN", pending_amount: 57.5 },
    ],
    todayIso: "2026-01-10",
  });

  const openInvoice = ledger.invoices.find((row) => row.voucher_number === "B-OPEN");
  assert.equal(Number(openInvoice.remaining.toFixed(2)), 57.5);
  assert.equal(Number(ledger.outstandingCompareTotals.computed_open.toFixed(2)), 57.5);
  assert.equal(Number(ledger.outstandingCompareTotals.sales_compared.toFixed(2)), 57.5);
  assert.equal(Number(ledger.outstandingCompareTotals.open_delta.toFixed(2)), 0);
  assert.equal(ledger.outstandingCompareTotals.discrepancy_count, 0);
});

test("partial credit note and sales return appear in creditNotes table, not reversed", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "INV1", sales_amount: 1000, category: "Paper" },
      // Partial CN same day â€” not a full reverse
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
  // No later voucher, so referenced CN-PART settles the open bill. Unreferenced SR-1 follows FIFO.
  assert.equal(invoice.credit_notes.length, 2);
  assert.equal(invoice.credit_notes[0].voucher_number, "CN-PART");
  assert.equal(invoice.credit_notes[1].voucher_number, "SR-1");
  assert.equal(invoice.credit_notes[0].days, null);
  assert.equal(invoice.settlements.length, 1);
  // Payment days only from the cash receipt — CN amounts ignored.
  assert.equal(invoice.payment_days, 19);
  assert.equal(ledger.creditNotes[0].applied_to_voucher, "INV1");
  assert.equal(Number(ledger.totals.credit_note_amount.toFixed(2)), 345);
  assert.equal(Number(ledger.totals.collected_amount.toFixed(2)), 400);
  assert.equal(Number(invoice.remaining.toFixed(2)), 405);
});

test("referenced credit note settles the named invoice when it is the open bill", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2025-11-20", voucher_number: "1835", sales_amount: 13338, category: "Paper" },
      {
        transaction_date: "2026-06-11",
        voucher_number: "284",
        voucher_type: "Credit Note",
        reference: "1835",
        sales_amount: -8768.81,
        category: "Paper",
      },
    ],
    receipts: [
      { receipt_date: "2026-01-15", amount: 500, vch_no: "75", vch_type: "Receipt" },
      { receipt_date: "2026-01-22", amount: 500, vch_no: "122", vch_type: "Receipt" },
      { receipt_date: "2026-02-19", amount: 500, vch_no: "342", vch_type: "Receipt" },
      { receipt_date: "2026-06-11", amount: -1574.38, vch_no: "284", vch_type: "Credit Note" },
      { receipt_date: "2026-07-23", amount: 1300, vch_no: "JV/Coll/2026/0433", vch_type: "JV-Collection" },
      { receipt_date: "2026-10-10", amount: 500, vch_no: "", vch_type: "Journal" },
    ],
    outstandingInvoices: [
      { invoice_date: "2025-11-20", ref_no: "1835", pending_amount: 1954.57 },
    ],
    todayIso: "2026-10-17",
  });

  const invoice = ledger.invoices.find((row) => row.voucher_number === "1835");
  assert.ok(invoice);
  assert.equal(Number(invoice.amount_incl_vat.toFixed(2)), 15338.7);
  assert.equal(Number(invoice.fifo_paid.toFixed(2)), 3300);
  assert.equal(Number(invoice.credit_note_settled.toFixed(2)), 10084.13);
  assert.deepEqual(invoice.credit_notes.map((row) => row.voucher_number), ["284"]);
  assert.equal(invoice.settlements.some((row) => row.vch_no === "284"), false);
  assert.equal(Number(invoice.remaining.toFixed(2)), 1954.57);
  assert.ok(Math.abs(ledger.outstandingCompareTotals.open_delta) < 0.02);
});

test("same-day named credit note reverses the earlier identical invoice", () => {
  // Customer 1486: CN 552 names RNFD/415, both dated 13 Sep. RNFD/414 is the day before, same amount and item.
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-09-12", voucher_number: "RNFD/414", voucher_type: "RIYADH W/S CREDIT", sales_amount: 10672, item_code: "A004555", quantity: 1000, category: "Office supplies" },
      { transaction_date: "2026-09-13", voucher_number: "552", voucher_type: "Credit Note", reference: "RNFD/415", sales_amount: -10672, item_code: "A004555", quantity: -1000, category: "Office supplies" },
      { transaction_date: "2026-09-13", voucher_number: "RNFD/415", voucher_type: "RIYADH W/S CREDIT", sales_amount: 10672, item_code: "A004555", quantity: 1000, category: "Office supplies" },
    ],
    receipts: [],
    todayIso: "2026-10-21",
  });

  assert.equal(ledger.reversedInvoices.some((row) => row.voucher_number === "RNFD/414" && row.credit_note_voucher === "552"), true);
  assert.equal(ledger.reversedInvoices.some((row) => row.voucher_number === "RNFD/415"), false);
  const reissue = ledger.invoices.find((row) => row.voucher_number === "RNFD/415");
  assert.ok(reissue);
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "RNFD/414"), false);
  assert.equal(Number(reissue.remaining.toFixed(2)), Number((10672 * 1.15).toFixed(2)));
});

test("reversed invoice stays a Tally line when the outstanding file still has it", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-09-12", voucher_number: "RNFD/414", voucher_type: "RIYADH W/S CREDIT", sales_amount: 10672, item_code: "A004555", quantity: 1000, category: "Office supplies" },
      { transaction_date: "2026-09-13", voucher_number: "552", voucher_type: "Credit Note", reference: "RNFD/415", sales_amount: -10672, item_code: "A004555", quantity: -1000, category: "Office supplies" },
      { transaction_date: "2026-09-13", voucher_number: "RNFD/415", voucher_type: "RIYADH W/S CREDIT", sales_amount: 10672, item_code: "A004555", quantity: 1000, category: "Office supplies" },
    ],
    receipts: [],
    outstandingInvoices: [
      { invoice_date: "2026-09-12", ref_no: "RNFD/414", pending_amount: 12272.8 },
      { invoice_date: "2026-09-13", ref_no: "RNFD/415", pending_amount: 12272.8 },
    ],
    todayIso: "2026-10-21",
  });

  const tallyOnly = ledger.invoices.find((row) => row.voucher_number === "RNFD/414");
  assert.ok(tallyOnly);
  assert.equal(tallyOnly.tally_only, true);
  assert.equal(tallyOnly.status, "Tally");
  assert.equal(Number(tallyOnly.amount_excl_vat), 0);
  assert.equal(Number(tallyOnly.remaining), 0);
  assert.equal(Number(tallyOnly.outstanding_pending), 12272.8);
  assert.equal(ledger.reversedInvoices.some((row) => row.voucher_number === "RNFD/414" && row.credit_note_voucher === "552"), true);
  const reissue = ledger.invoices.find((row) => row.voucher_number === "RNFD/415");
  assert.ok(reissue);
  assert.equal(reissue.tally_only, undefined);
  assert.equal(Number(reissue.amount_excl_vat.toFixed(2)), 10672);
  assert.equal(Number(reissue.outstanding_pending), 12272.8);
  const tallyTotal = ledger.invoices.reduce((total, row) => total + Number(row.outstanding_pending || 0), 0);
  assert.equal(Number(tallyTotal.toFixed(2)), Number((12272.8 * 2).toFixed(2)));
});

test("named partial credit note does not void the same-day reissue", () => {
  // Customer 1602: CN 614 names RNFD/447. RNFD/537 is a same-day reissue for the same total.
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-09-16", voucher_number: "RNFD/447", voucher_type: "RIYADH W/S CREDIT", sales_amount: 12198, item_code: "A003286", quantity: 10, category: "Sundry" },
      { transaction_date: "2026-10-05", voucher_number: "614", voucher_type: "Credit Note", reference: "RNFD/447", sales_amount: -5442, item_code: "A003286", quantity: -5, category: "Sundry" },
      { transaction_date: "2026-10-05", voucher_number: "614", voucher_type: "Credit Note", reference: "RNFD/447", sales_amount: -97, item_code: "A003608", quantity: -30, category: "Personal Care" },
      { transaction_date: "2026-10-05", voucher_number: "RNFD/537", voucher_type: "RIYADH W/S CREDIT", sales_amount: 5442, item_code: "A003286", quantity: 5, category: "Sundry" },
      { transaction_date: "2026-10-05", voucher_number: "RNFD/537", voucher_type: "RIYADH W/S CREDIT", sales_amount: 97, item_code: "A003606", quantity: 36, category: "Personal Care" },
    ],
    receipts: [],
    todayIso: "2026-10-21",
  });

  assert.equal(ledger.reversedInvoices.some((row) => row.credit_note_voucher === "614"), false);
  const named = ledger.invoices.find((row) => row.voucher_number === "RNFD/447");
  const reissue = ledger.invoices.find((row) => row.voucher_number === "RNFD/537");
  assert.ok(named);
  assert.ok(reissue);
  assert.equal(Number(reissue.credit_note_settled.toFixed(2)), 0);
  assert.equal(Number(reissue.remaining.toFixed(2)), Number((5539 * 1.15).toFixed(2)));
  assert.equal(Number(named.credit_note_settled.toFixed(2)), Number((5539 * 1.15).toFixed(2)));
  assert.equal(Number(named.remaining.toFixed(2)), Number(((12198 - 5539) * 1.15).toFixed(2)));
  assert.deepEqual(named.fifo_credit_notes.map((row) => row.voucher_number), ["614"]);
  assert.equal(reissue.fifo_credit_notes.length, 0);
});

test("customer 1171C credit note 396 reverses invoice NFD/1173 that references it", () => {
  // CN 396 names large NFD/898 (amount mismatch) while sale NFD/1173 references 396.
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-06-01", voucher_number: "NFD/898", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 900, item_code: "LP00039", quantity: 50, category: "Sundry" },
      { transaction_date: "2026-06-01", voucher_number: "NFD/898", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 84, item_code: "LP00374", quantity: 2, category: "Sundry" },
      {
        transaction_date: "2026-07-21",
        voucher_number: "396",
        voucher_type: "Credit Note",
        reference: "NFD/898",
        sales_amount: -84,
        item_code: "LP00374",
        quantity: -2,
        category: "Sundry",
      },
      {
        transaction_date: "2026-07-21",
        voucher_number: "397",
        voucher_type: "Credit Note",
        reference: "NFD/898",
        sales_amount: -89.56,
        item_code: "LP00374",
        quantity: -2,
        category: "Sundry",
      },
      {
        transaction_date: "2026-07-21",
        voucher_number: "NFD/1173",
        voucher_type: "SALES-NON FOOD DIVISION",
        reference: "396",
        sales_amount: 84,
        item_code: "LP00374",
        quantity: 2,
        category: "Sundry",
      },
    ],
    receipts: [],
    todayIso: "2026-10-28",
  });

  assert.equal(
    ledger.reversedInvoices.some((row) => row.voucher_number === "NFD/1173" && row.credit_note_voucher === "396"),
    true,
  );
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "NFD/1173"), false);
  const named = ledger.invoices.find((row) => row.voucher_number === "NFD/898");
  assert.ok(named);
  assert.deepEqual(named.fifo_credit_notes.map((row) => row.voucher_number), ["397"]);
  assert.equal(Number(named.credit_note_settled.toFixed(2)), Number((89.56 * 1.15).toFixed(2)));
  assert.equal(ledger.creditNotes.some((row) => row.voucher_number === "396"), false);
});

test("customer 1177 partial credit notes stay on the named invoices", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-03-14", voucher_number: "NFD/261", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 2478.5, category: "Personal Care" },
      { transaction_date: "2026-05-02", voucher_number: "NFD/616", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 13085.04, category: "Personal Care" },
      { transaction_date: "2026-07-07", voucher_number: "RNFD/084", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 565.73, category: "Personal Care" },
      { transaction_date: "2026-07-15", voucher_number: "NFD/1139", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 2250, category: "Personal Care" },
      { transaction_date: "2026-07-22", voucher_number: "401", voucher_type: "Credit Note", reference: "RNFD/084", sales_amount: -371.33, category: "Personal Care" },
      { transaction_date: "2026-08-23", voucher_number: "NFD/1497", voucher_type: "SALES-NON FOOD DIVISION", sales_amount: 852.23, category: "Personal Care" },
      { transaction_date: "2026-08-29", voucher_number: "510", voucher_type: "Credit Note", reference: "NFD/1497", sales_amount: -657.83, category: "Personal Care" },
    ],
    receipts: [],
    todayIso: "2026-10-22",
  });

  const named084 = ledger.invoices.find((row) => row.voucher_number === "RNFD/084");
  const named1497 = ledger.invoices.find((row) => row.voucher_number === "NFD/1497");
  const later = ledger.invoices.find((row) => row.voucher_number === "NFD/1139");
  const older = ledger.invoices.find((row) => row.voucher_number === "NFD/261");
  assert.deepEqual(named084.fifo_credit_notes.map((row) => row.voucher_number), ["401"]);
  assert.equal(Number(named084.credit_note_settled.toFixed(2)), Number((371.33 * 1.15).toFixed(2)));
  assert.deepEqual(named1497.fifo_credit_notes.map((row) => row.voucher_number), ["510"]);
  assert.equal(Number(named1497.credit_note_settled.toFixed(2)), Number((657.83 * 1.15).toFixed(2)));
  assert.equal(later.credit_note_settled, 0);
  assert.equal(older.credit_note_settled, 0);
  assert.equal(ledger.creditNotes.find((row) => row.voucher_number === "401").applied_to_voucher, "RNFD/084");
  assert.equal(ledger.creditNotes.find((row) => row.voucher_number === "510").applied_to_voucher, "NFD/1497");
});

test("parseCreditNoteReferences splits Tally compound refs like NFD/1341-1340", () => {
  assert.deepEqual(parseCreditNoteReferences("NFD/1341-1340"), ["NFD/1341", "NFD/1340"]);
  assert.deepEqual(parseCreditNoteReferences("DNFD/095"), ["DNFD/095"]);
  assert.deepEqual(parseCreditNoteReferences("NFD/1340, NFD/1341"), ["NFD/1340", "NFD/1341"]);
  assert.deepEqual(parseCreditNoteReferences(""), []);
});

test("compound Ref. No. credit note reverses both named same-day invoices (1424 CN 447)", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-08-09",
        voucher_number: "NFD/1340",
        voucher_type: "SALES-NON FOOD DIVISION",
        item_code: "A004075",
        quantity: 750,
        sales_amount: 4950,
        category: "Paper",
      },
      {
        transaction_date: "2026-08-09",
        voucher_number: "NFD/1341",
        voucher_type: "SALES-NON FOOD DIVISION",
        item_code: "A004075",
        quantity: 750,
        sales_amount: 4950,
        category: "Paper",
      },
      {
        transaction_date: "2026-08-09",
        voucher_number: "447",
        voucher_type: "Credit Note",
        reference: "NFD/1341-1340",
        item_code: "A004075",
        quantity: -1500,
        sales_amount: -9900,
        category: "Paper",
      },
    ],
    receipts: [],
  });

  assert.equal(ledger.creditNotes.length, 0);
  assert.equal(ledger.reversedInvoices.length, 2);
  assert.deepEqual(
    ledger.reversedInvoices.map((row) => row.voucher_number).sort(),
    ["NFD/1340", "NFD/1341"],
  );
  assert.ok(ledger.reversedInvoices.every((row) => row.credit_note_voucher === "447"));
});

test("partial named credit note settles DNFD/095 not a later open bill (1424 CN 627)", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-09-13",
        voucher_number: "DNFD/095",
        voucher_type: "DAMMAM W/S CREDIT",
        item_code: "A004224",
        quantity: 120,
        sales_amount: 243,
        category: "Paper",
      },
      {
        transaction_date: "2026-09-13",
        voucher_number: "DNFD/095",
        voucher_type: "DAMMAM W/S CREDIT",
        item_code: "A004388",
        quantity: 200,
        sales_amount: 121,
        category: "Paper",
      },
      {
        transaction_date: "2026-09-13",
        voucher_number: "DNFD/095",
        voucher_type: "DAMMAM W/S CREDIT",
        item_code: "A005514",
        quantity: 60,
        sales_amount: 572.28,
        category: "Paper",
      },
      {
        transaction_date: "2026-09-20",
        voucher_number: "DNFD/108",
        voucher_type: "DAMMAM W/S CREDIT",
        item_code: "A004555",
        quantity: 500,
        sales_amount: 5700,
        category: "Paper",
      },
      {
        transaction_date: "2026-10-12",
        voucher_number: "627",
        voucher_type: "Credit Note",
        reference: "DNFD/095",
        item_code: "A005514",
        quantity: -60,
        sales_amount: -572.28,
        category: "Paper",
      },
    ],
    receipts: [],
  });

  assert.equal(ledger.reversedInvoices.length, 0);
  assert.equal(ledger.creditNotes.length, 1);
  assert.equal(ledger.creditNotes[0].voucher_number, "627");
  assert.equal(ledger.creditNotes[0].applied_to_voucher, "DNFD/095");
  const named = ledger.invoices.find((row) => row.voucher_number === "DNFD/095");
  const later = ledger.invoices.find((row) => row.voucher_number === "DNFD/108");
  assert.equal(Number(named.credit_note_settled.toFixed(2)), Number((572.28 * 1.15).toFixed(2)));
  assert.equal(later.credit_note_settled, 0);
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
  // Full unpaired CN clears the invoice before the later receipt â€” not a Reversed pair.
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
      // Original bill 31 Dec â€” fully reversed same day by CN 121.
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
      // Orphan / blank-style second CN same day â€” must NOT reverse the next-day reissue.
      {
        transaction_date: "2025-12-31",
        voucher_number: "",
        voucher_type: "Credit Note",
        sales_amount: 18026.2,
        ...item,
      },
      // Replacement invoice next day â€” live AR again (Tally keeps this open).
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
      // Positive amount but CN/ voucher code â€” should not inflate sales.
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

test("Tally vs computed outstanding follows FIFO credit-note allocation", () => {
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
        // Different qty than 2106 so this is not an exact mirror reverse.
        quantity: 2,
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

  // CN 427 refs 1691 and settles that bill, not the later voucher 2106.
  const row2106 = (ledger.outstandingCompareAllRows || []).find((row) => row.voucher_number === "2106");
  assert.ok(row2106);
  assert.equal(Number(row2106.credit_note_settled.toFixed(2)), 0);
  assert.equal(Number(row2106.computed_open.toFixed(2)), 2587.5);
  assert.equal(Number(row2106.tally_open.toFixed(2)), 0);

  const row1691 = (ledger.outstandingCompareAllRows || []).find((row) => row.voucher_number === "1691");
  assert.ok(row1691);
  assert.equal(Number(row1691.credit_note_settled.toFixed(2)), 2587.5);
  assert.equal(Number(row1691.computed_open.toFixed(2)), 38.52);
  assert.equal(Number(row1691.tally_open.toFixed(2)), 2626.02);
  assert.equal(Number(ledger.outstandingCompareTotals.computed_open.toFixed(2)), 2626.02);
  assert.equal(Number(ledger.outstandingCompareTotals.tally_open.toFixed(2)), 2626.02);
});

test("exact amount + items/qty CN reverses invoice on any later date", () => {
  const item = { item_code: "A003595", quantity: 24, category: "Body Care" };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-06-30",
        voucher_number: "NFD/1050",
        sales_amount: 18888.37,
        ...item,
      },
      {
        transaction_date: "2026-07-07",
        voucher_number: "361",
        voucher_type: "Credit Note",
        reference: "NFD/1050",
        sales_amount: -18888.37,
        ...item,
      },
      {
        transaction_date: "2026-04-06",
        voucher_number: "NFD/357",
        sales_amount: 1000,
        item_code: "OTHER",
        quantity: 1,
        category: "Paper",
      },
    ],
    // Cash that previously stacked on NFD/1050 must settle elsewhere once reversed.
    receipts: [
      { receipt_date: "2026-07-07", amount: 5000, vch_no: "1191" },
      { receipt_date: "2026-08-10", amount: 3400, vch_no: "1411" },
    ],
    outstandingInvoices: [],
    todayIso: "2026-09-16",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  assert.equal(ledger.reversedInvoices[0].voucher_number, "NFD/1050");
  assert.equal(ledger.reversedInvoices[0].credit_note_voucher, "361");
  assert.equal(ledger.reversedInvoices[0].reversal_days, 7);
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "NFD/1050"), false);

  const kept = ledger.invoices.find((row) => row.voucher_number === "NFD/357");
  assert.ok(kept);
  assert.equal(Number(kept.paid_amount.toFixed(2)), 1150);
  assert.ok(
    !(kept.credit_notes || []).some((note) => String(note.voucher_number) === "361"),
    "full mirror CN must not also attach under another invoice",
  );
});

test("same-amount CN with different items does not reverse outside the 1-day window", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      {
        transaction_date: "2026-06-30",
        voucher_number: "NFD/1",
        sales_amount: 1000,
        item_code: "ITEM-A",
        quantity: 10,
        category: "Paper",
      },
      {
        transaction_date: "2026-07-10",
        voucher_number: "CN-9",
        voucher_type: "Credit Note",
        sales_amount: -1000,
        item_code: "ITEM-B",
        quantity: 10,
        category: "Paper",
      },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-09-16",
  });

  assert.equal(ledger.reversedInvoices.length, 0);
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "NFD/1"), true);
  assert.equal(ledger.creditNotes.some((row) => row.voucher_number === "CN-9"), true);
});

test("referenced CNs claim their voucher before same-amount twins steal them (1198)", () => {
  const basket = [
    { item_code: "A003457", quantity: 1, sales_amount: 81, category: "Personal Care" },
    { item_code: "A004082", quantity: 10, sales_amount: 1190, category: "Stationery" },
  ];
  const transactions = [
    // Early CN 44 names 1820 before that bill's date (Tally forward Ref. No.).
    ...basket.map((row) => ({
      transaction_date: "2025-11-13",
      voucher_number: "44",
      voucher_type: "Credit Note",
      reference: "1820",
      ...row,
      quantity: Math.abs(row.quantity),
      sales_amount: Math.abs(row.sales_amount),
    })),
    // Same-day void of 1730 by CN 43.
    ...basket.flatMap((row) => [
      {
        transaction_date: "2025-11-13",
        voucher_number: "1730",
        voucher_type: "Sales",
        ...row,
      },
      {
        transaction_date: "2025-11-13",
        voucher_number: "43",
        voucher_type: "Credit Note",
        reference: "1730",
        ...row,
        quantity: -row.quantity,
        sales_amount: -row.sales_amount,
      },
    ]),
    // Three identical reissue baskets; CN refs must win over oldest-first fingerprint.
    ...["1818", "1819", "1820"].flatMap((voucher) => basket.map((row) => ({
      transaction_date: "2025-11-19",
      voucher_number: voucher,
      voucher_type: "Sales",
      ...row,
    }))),
    ...basket.map((row) => ({
      transaction_date: "2025-11-19",
      voucher_number: "045",
      voucher_type: "Credit Note",
      reference: "1819",
      ...row,
      quantity: -row.quantity,
      sales_amount: -row.sales_amount,
    })),
    ...basket.map((row) => ({
      transaction_date: "2025-11-19",
      voucher_number: "046",
      voucher_type: "Credit Note",
      reference: "1820",
      ...row,
      quantity: -row.quantity,
      sales_amount: -row.sales_amount,
    })),
  ];

  const ledger = buildPaymentSettlementLedger({
    transactions,
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-10-12",
  });

  const byInvoice = Object.fromEntries(
    (ledger.reversedInvoices || []).map((row) => [row.voucher_number, row.credit_note_voucher]),
  );
  assert.equal(byInvoice["1730"], "43");
  assert.equal(byInvoice["1820"], "44");
  assert.equal(byInvoice["1819"], "045");
  // Leftover same-day mirror (046 refs 1820, already voided by 44) clears the twin 1818.
  assert.equal(byInvoice["1818"], "046");
  assert.equal(ledger.invoices.length, 0);
  const nov13 = ledger.datewise.find((row) => row.date === "2025-11-13");
  assert.ok(nov13, "voided day still appears in datewise");
  assert.deepEqual(
    (nov13.invoices || []).map((row) => row.voucher_number),
    ["1730"],
  );
  assert.deepEqual(
    (nov13.credit_notes || []).map((row) => row.voucher_number).sort(),
    ["43", "44"],
  );
});

test("blank early CN still must not reverse a next-day reissue", () => {
  const item = { item_code: "P-100", quantity: 10, category: "Paper", sales_amount: 1000 };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2025-12-31", voucher_number: "2384", ...item },
      {
        transaction_date: "2025-12-31",
        voucher_number: "121",
        voucher_type: "Credit Note",
        reference: "2384",
        ...item,
        sales_amount: -1000,
        quantity: -10,
      },
      {
        transaction_date: "2025-12-31",
        voucher_number: "",
        voucher_type: "Credit Note",
        ...item,
        sales_amount: -1000,
        quantity: -10,
      },
      { transaction_date: "2026-01-01", voucher_number: "2397", ...item },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-09-16",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  assert.equal(ledger.reversedInvoices[0].voucher_number, "2384");
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "2397"), true);
});

test("customer 1009 credit note 127 reverses later invoice 2446", () => {
  const item = { item_code: "A003234", quantity: 250, category: "Paper", sales_amount: 2100 };
  const credit = { ...item, sales_amount: -2100, quantity: -250, voucher_type: "Credit Note" };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2025-12-31", voucher_number: "2387", voucher_type: "Sales", ...item },
      { transaction_date: "2025-12-31", voucher_number: "2388", voucher_type: "Sales", ...item },
      { transaction_date: "2025-12-31", voucher_number: "126", reference: "2387", ...credit },
      { transaction_date: "2025-12-31", voucher_number: "127", reference: "2387", ...credit },
      { transaction_date: "2026-01-04", voucher_number: "2446", voucher_type: "Sales", ...item },
      { transaction_date: "2026-01-04", voucher_number: "4", reference: "2388", ...credit },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-10-22",
  });

  const byInvoice = Object.fromEntries(
    (ledger.reversedInvoices || []).map((row) => [row.voucher_number, row.credit_note_voucher]),
  );
  assert.equal(byInvoice["2387"], "126");
  assert.equal(byInvoice["2388"], "4");
  assert.equal(byInvoice["2446"], "127");
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "2446"), false);
});

test("customer 1442 leftover credit note 381 reverses debit note 009", () => {
  const item = { item_code: "A003600", quantity: 1, category: "Paper", sales_amount: 925 };
  const credit = { ...item, sales_amount: -925, quantity: -1, voucher_type: "Credit Note", reference: "RNFD/092" };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-07-09", voucher_number: "RNFD/092", voucher_type: "RIYADH W/S CREDIT", ...item },
      { transaction_date: "2026-07-13", voucher_number: "375", ...credit },
      { transaction_date: "2026-07-14", voucher_number: "381", ...credit },
      { transaction_date: "2026-07-16", voucher_number: "009", voucher_type: "Debit Note Sales", ...item },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-10-22",
  });

  const byInvoice = Object.fromEntries(
    (ledger.reversedInvoices || []).map((row) => [row.voucher_number, row.credit_note_voucher]),
  );
  assert.equal(byInvoice["RNFD/092"], "375");
  assert.equal(byInvoice["009"], "381");
});

test("two credit notes on 2384 still leave next-day reissue 2397 open", () => {
  const item = { item_code: "P-200", quantity: 6, category: "Paper", sales_amount: 18026.2 };
  const credit = { ...item, sales_amount: -18026.2, quantity: -6, voucher_type: "Credit Note", reference: "2384" };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2025-12-31", voucher_number: "2384", voucher_type: "Sales", ...item },
      { transaction_date: "2025-12-31", voucher_number: "0131", ...credit },
      { transaction_date: "2025-12-31", voucher_number: "121", ...credit },
      { transaction_date: "2026-01-01", voucher_number: "2397", voucher_type: "Sales", ...item },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-10-22",
  });

  const reversed = (ledger.reversedInvoices || []).map((row) => row.voucher_number);
  assert.deepEqual(reversed, ["2384"]);
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "2397"), true);
});

test("a credit note that already voided its named bill does not take a later identical sale", () => {
  const item = { item_code: "P-300", quantity: 1, category: "Paper", sales_amount: 500 };
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2025-12-01", voucher_number: "100", voucher_type: "Sales", ...item },
      {
        transaction_date: "2025-12-01",
        voucher_number: "50",
        voucher_type: "Credit Note",
        reference: "100",
        ...item,
        sales_amount: -500,
        quantity: -1,
      },
      { transaction_date: "2025-12-05", voucher_number: "140", voucher_type: "Sales", ...item },
    ],
    receipts: [],
    outstandingInvoices: [],
    todayIso: "2026-10-22",
  });

  assert.equal(ledger.reversedInvoices.length, 1);
  assert.equal(ledger.reversedInvoices[0].voucher_number, "100");
  assert.equal(ledger.invoices.some((row) => row.voucher_number === "140"), true);
});

