import test from "node:test";
import assert from "node:assert/strict";

import { formatAvgDaysToPayWhatsappLines } from "../app/lib/avgDaysWhatsapp.js";
import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";
import { buildFieldVisitWhatsappSummary } from "../app/lib/fieldVisitWhatsapp.js";
import { buildCollectionVisitSummary } from "../app/lib/collectionVisitSummary.js";

test("formatAvgDaysToPayWhatsappLines leaves blank line above", () => {
  assert.deepEqual(formatAvgDaysToPayWhatsappLines(80), ["", "Avg days to pay: 80"]);
  assert.deepEqual(formatAvgDaysToPayWhatsappLines(null), []);
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
    analytics: { paymentBehavior: { avgDaysToPay: 80 } },
  });

  assert.match(summary, /PDF attached\.\n\nAvg days to pay: 80\n\nGPS:/);
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
    avgDaysToPay: 45,
  });

  assert.match(summary, /Total: 100\n\nAvg days to pay: 45\n\nGPS:/);
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
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "500",
      receiptMode: "CASH",
      nextVisitAt: "2026-08-30",
    },
    { queuePriority: 3, visitNumberForDay: 2, avgDaysToPay: 80 },
  );

  assert.match(summary, />120: 0\n\nAvg days to pay: 80\n\nGPS:/);
});
