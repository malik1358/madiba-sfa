import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaymentBehavior,
  buildSalesInvoices,
  matchPaymentsFifo,
} from "../app/lib/paymentBehavior.js";

test("buildSalesInvoices aggregates voucher lines by date", () => {
  const invoices = buildSalesInvoices([
    { transaction_date: "2026-01-01", voucher_number: "A1", sales_amount: 100 },
    { transaction_date: "2026-01-01", voucher_number: "A1", sales_amount: 50 },
    { transaction_date: "2026-01-05", voucher_number: "A2", sales_amount: 200 },
  ]);

  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].amount, 150);
  assert.equal(invoices[1].amount, 200);
});

test("matchPaymentsFifo measures days from sales date to receipt date", () => {
  const { allocations, invoices } = matchPaymentsFifo(
    [
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000 },
      { transaction_date: "2026-01-10", voucher_number: "2", sales_amount: 500 },
    ],
    [
      { receipt_date: "2026-01-31", amount: 1000 },
      { receipt_date: "2026-02-09", amount: 500 },
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
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 1000 },
      { transaction_date: "2026-02-01", voucher_number: "2", sales_amount: 1000 },
    ],
    receipts: [
      { receipt_date: "2026-01-11", amount: 1000 },
      { receipt_date: "2026-03-03", amount: 1000 },
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

  // 10 days on 1000 + 30 days on 1000 => weighted avg 20
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
      { transaction_date: "2026-01-01", voucher_number: "1", sales_amount: 400 },
      { transaction_date: "2026-01-20", voucher_number: "2", sales_amount: 600 },
    ],
    [{ receipt_date: "2026-02-01", amount: 1000 }],
  );

  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].voucher_number, "1");
  assert.equal(allocations[0].days, 31);
  assert.equal(allocations[1].voucher_number, "2");
  assert.equal(allocations[1].days, 12);
});
