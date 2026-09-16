import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaymentBehavior,
  buildPaymentSettlementLedger,
  buildSalesInvoices,
  matchPaymentsFifo,
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

test("buildPaymentBehavior returns weighted average days and unpaid outstanding stats", () => {
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

  // 10 days on 1150 + 30 days on 1150 => weighted avg 20
  assert.equal(behavior.avgDaysToPay, 20);
  assert.equal(behavior.outstandingTotal, 750);
  assert.equal(behavior.outstandingOpenInvoices, 2);
  assert.ok(behavior.outstandingOldestDays >= 40);
  assert.match(behavior.summaryLabel, /Avg 20 days to pay/);
  assert.match(behavior.summaryLabel, /Unpaid 750/);
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
  assert.equal(ledger.summary.avgDaysToPay, 29);
  assert.equal(ledger.totals.paid_invoice_count, 1);
  assert.equal(ledger.totals.partial_invoice_count, 1);
  assert.ok(ledger.totals.open_sales_amount > 0);
});

test("buildPaymentSettlementLedger leaves avg days blank when customer never paid", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [],
    outstandingCustomer: { total_outstanding: 1150, open_invoices: 1 },
    todayIso: "2026-02-01",
  });

  assert.equal(ledger.summary.avgDaysToPay, null);
  assert.equal(ledger.invoices[0].status, "Open");
  assert.equal(ledger.invoices[0].payment_days, null);
  assert.equal(ledger.invoices[0].open_days, 31);
  assert.equal(ledger.settlementEvents.length, 0);
  assert.equal(ledger.summary.outstandingTotal, 1150);
});
