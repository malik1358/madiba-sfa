import assert from "node:assert/strict";
import test from "node:test";
import {
  attachAvgDaysToPayToRecords,
  resolveCollectionAvgDaysToPay,
  resolveLastReceiptDate,
} from "../app/lib/collectionAvgDays.js";

test("resolveCollectionAvgDaysToPay matches receipt FIFO avg for a paid customer", () => {
  const avg = resolveCollectionAvgDaysToPay({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [
      { receipt_date: "2026-02-01", amount: 1150 },
    ],
    invoices: [],
    totalOutstanding: 0,
    todayIso: "2026-02-15",
  });

  assert.equal(avg, 31);
});

test("resolveLastReceiptDate returns the latest receipt date", () => {
  assert.equal(resolveLastReceiptDate([
    { receipt_date: "2026-01-15", amount: 100 },
    { receipt_date: "2026-03-02", amount: 200 },
    { receipt_date: "2026-02-20", amount: 50 },
  ]), "2026-03-02");
  assert.equal(resolveLastReceiptDate([]), "");
});

test("attachAvgDaysToPayToRecords fills avg_days_to_pay and last_receipt_date", () => {
  const salesByCustomer = new Map([
    ["1586", [
      { transaction_date: "2026-01-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
    ]],
  ]);
  const receiptsByCustomer = new Map([
    ["1586", [
      { receipt_date: "2026-01-20", amount: 50 },
      { receipt_date: "2026-02-01", amount: 1150 },
    ]],
  ]);

  const [row] = attachAvgDaysToPayToRecords([{
    customer_code: "1586",
    customer_name: "AL BAYT",
    invoices: [],
  }], {
    salesByCustomer,
    receiptsByCustomer,
    todayIso: "2026-02-15",
  });

  assert.equal(row.last_receipt_date, "2026-02-01");
  assert.equal(typeof row.avg_days_to_pay, "number");
  assert.ok(row.avg_days_to_pay > 0);
  assert.equal(typeof row.avg_days_to_pay_6m, "number");
  assert.ok(row.avg_days_to_pay_6m > 0);
});

test("attachAvgDaysToPayToRecords falls back to aging buckets when invoice age is missing", () => {
  const [row] = attachAvgDaysToPayToRecords([{
    customer_code: "1163C",
    invoices: [{ pending_amount: 853.7 }],
    outstanding_above_120: 853.7,
  }], {
    todayIso: "2026-10-01",
  });

  assert.equal(row.avg_days_to_pay, 135);
  assert.equal(row.avg_days_to_pay_6m, 135);
});

test("attachAvgDaysToPayToRecords derives avg days from open outstanding buckets when never paid", () => {
  const [row] = attachAvgDaysToPayToRecords([{
    customer_code: "1009",
    customer_name: "ABRAJ AL RISALA",
    invoices: [],
    outstanding_0_30: 12714.52,
    outstanding_30_60: 2664.76,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  }], {
    salesByCustomer: new Map(),
    receiptsByCustomer: new Map(),
    todayIso: "2026-09-28",
  });

  assert.equal(row.last_receipt_date, "");
  assert.equal(row.avg_days_to_pay, 20);
  assert.equal(row.avg_days_to_pay_6m, 20);
});
