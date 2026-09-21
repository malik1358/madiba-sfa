import assert from "node:assert/strict";
import test from "node:test";
import {
  attachAvgDaysToPayToRecords,
  resolveCollectionAvgDaysToPay,
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

test("attachAvgDaysToPayToRecords fills avg_days_to_pay per customer code", () => {
  const salesByCustomer = new Map([
    ["1586", [
      { transaction_date: "2026-01-01", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
    ]],
  ]);
  const receiptsByCustomer = new Map([
    ["1586", [
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

  assert.equal(row.avg_days_to_pay, 31);
});
