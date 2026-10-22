import test from "node:test";
import assert from "node:assert/strict";

import {
  awaitAvgDaysPrefetch,
  formatAvgDaysToPayWhatsappLines,
  resolveLocalAvgDaysToPay,
} from "../app/lib/avgDaysWhatsapp.js";
import { buildPaymentBehavior } from "../app/lib/paymentBehavior.js";
import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";
import { buildFieldVisitWhatsappSummary } from "../app/lib/fieldVisitWhatsapp.js";
import { buildCollectionVisitSummary } from "../app/lib/collectionVisitSummary.js";

test("formatAvgDaysToPayWhatsappLines leaves blank line above", () => {
  assert.deepEqual(formatAvgDaysToPayWhatsappLines(80), ["", "Avg days to pay: 80"]);
  assert.deepEqual(formatAvgDaysToPayWhatsappLines(null), []);
  assert.deepEqual(
    formatAvgDaysToPayWhatsappLines({ avgDaysToPay: 52, avgDaysToPay6m: 45 }),
    ["", "Avg days to pay: 52", "6-month avg: 45"],
  );
});

test("resolveLocalAvgDaysToPay reads snake_case customer fields", () => {
  assert.deepEqual(
    resolveLocalAvgDaysToPay({ avg_days_to_pay: 61, avg_days_to_pay_6m: 40 }),
    { avgDaysToPay: 61, avgDaysToPay6m: 40 },
  );
  assert.equal(resolveLocalAvgDaysToPay({}), null);
  assert.deepEqual(resolveLocalAvgDaysToPay(44), { avgDaysToPay: 44, avgDaysToPay6m: null });
});

test("awaitAvgDaysPrefetch times out without blocking forever", async () => {
  const slow = new Promise((resolve) => {
    setTimeout(() => resolve({ avgDaysToPay: 90, avgDaysToPay6m: 50 }), 50);
  });
  assert.equal(await awaitAvgDaysPrefetch(slow, 1), null);
  assert.deepEqual(
    await awaitAvgDaysPrefetch(Promise.resolve({ avgDaysToPay: 12, avgDaysToPay6m: null }), 100),
    { avgDaysToPay: 12, avgDaysToPay6m: null },
  );
});

test("buildOrderWhatsappSummary includes avg days to pay with blank lines around it", () => {
  const summary = buildOrderWhatsappSummary({
    orderId: 470,
    statusLabel: "Submitted",
    customerCode: "1417",
    customerName: "Adwaa Al-Khaleej Markets Company Ltd.",
    salesmanCode: "OSAMA",
    itemCount: 3,
    totalQuantity: 320,
    grandTotal: 16934.4,
    paymentType: "credit",
    pricingRegion: "riyadh",
  }, "en", {
    analytics: { paymentBehavior: { avgDaysToPay: 80, avgDaysToPay6m: 60 } },
  });

  assert.match(summary, /PDF attached\.\n\nAvg days to pay: 80\n6-month avg: 60\n\nGPS:/);
});

test("buildFieldVisitWhatsappSummary includes avg days to pay with blank lines around it", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1542",
      customer_name: "Test Customer",
      outstanding_0_30: 100,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_above_90: 0,
    },
    visitForm: { outcome: "PAYMENT_FOLLOWUP", nextVisitAt: "2026-09-20" },
    salesmanName: "OSAMA",
    avgDaysToPay: { avgDaysToPay: 45, avgDaysToPay6m: 30 },
  });

  assert.match(summary, /Total: 100\n\nAvg days to pay: 45\n6-month avg: 30\n\nGPS:/);
});

test("buildFieldVisitWhatsappSummary reads avg days from customer local fields", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1092",
      customer_name: "BIN KHAMIS INTERNATIONALTRADING COMPANY",
      outstanding_0_30: 23489.3,
      outstanding_30_60: 33432.8,
      outstanding_61_90: 4800.1,
      outstanding_above_90: 7366.3,
      avg_days_to_pay: 58,
      avg_days_to_pay_6m: 41,
    },
    visitForm: { outcome: "COME_BACK_LATER", nextVisitAt: "2026-09-28" },
    salesmanName: "ABADALLA ANTHANATH",
  });

  assert.match(summary, /Total: 69,088\.5\n\nAvg days to pay: 58\n6-month avg: 41\n\nGPS:/);
});

test("buildCollectionVisitSummary includes avg days to pay with blank lines around it", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_name: "Acme Trading",
      customer_code: "1009",
      salesman_name: "Junaid",
      outstanding_0_30: 1000,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
      avg_days_to_pay: 80,
      avg_days_to_pay_6m: 55,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "500",
      receiptMode: "CASH",
      nextVisitAt: "2026-08-30",
    },
    { queuePriority: 3, visitNumberForDay: 2, visitAt: "2026-08-30T08:15:00.000Z" },
  );

  assert.match(summary, /Visit date\/time: 30\/08\/2026, 11:15/);
  assert.match(summary, />120: 0\n\nAvg days to pay: 80\n6-month avg: 55\n\nGPS:/);
});

test("WhatsApp avg days uses the amount-weighted figure and skips cash vouchers", () => {
  const behavior = buildPaymentBehavior({
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
    todayIso: "2026-03-01",
  });

  // Equal vote of 1 day, 2 days, and 30 days would be 11. Amount-weighted
  // credit-only is 30. Cash vouchers must not pull it down.
  assert.equal(behavior.avgDaysToPay, 30);

  const order = buildOrderWhatsappSummary({
    customerCode: "1002",
    customerName: "Test Customer",
    statusLabel: "Submitted",
  }, "en", {
    analytics: { paymentBehavior: behavior },
  });
  assert.match(order, /Avg days to pay: 30/);

  const visit = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1002",
      customer_name: "Test Customer",
      avg_days_to_pay: 5,
    },
    visitForm: { outcome: "PAYMENT_FOLLOWUP", nextVisitAt: "2026-03-10" },
    avgDaysToPay: behavior,
  });
  assert.match(visit, /Avg days to pay: 30/);

  const collection = buildCollectionVisitSummary(
    {
      customer_name: "Test Customer",
      customer_code: "1002",
      salesman_name: "Parvez",
      avg_days_to_pay: 5,
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "500",
      receiptMode: "CASH",
      nextVisitAt: "2026-03-10",
    },
    { avgDaysToPay: behavior },
  );
  assert.match(collection, /Avg days to pay: 30/);
  assert.deepEqual(
    formatAvgDaysToPayWhatsappLines(behavior),
    ["", "Avg days to pay: 30"].concat(
      behavior.avgDaysToPay6m == null ? [] : [`6-month avg: ${behavior.avgDaysToPay6m}`],
    ),
  );
});
