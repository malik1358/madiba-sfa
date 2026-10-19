import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFieldVisitWhatsappSummary,
  formatFieldVisitOutcome,
} from "../app/lib/fieldVisitWhatsapp.js";

test("formatFieldVisitOutcome returns localized labels", () => {
  assert.equal(formatFieldVisitOutcome("ORDER_TAKEN", "en"), "Order taken");
  assert.equal(formatFieldVisitOutcome("ORDER_TAKEN", "ar"), "تم أخذ الطلب");
});

test("buildFieldVisitWhatsappSummary builds compact visit message", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1542",
      customer_name: "Sultan Salem Ahmed Al-Shehri Accessories Establishment",
      outstanding_0_30: 1200,
      outstanding_30_60: 800,
      outstanding_61_90: 500,
      outstanding_above_90: 300,
    },
    visitForm: {
      outcome: "PAYMENT_FOLLOWUP",
      nextVisitAt: "2026-08-27T10:00",
      note: "Customer asked for invoice copy.",
      stockChecks: [
        { itemName: "Cable A", status: "AVAILABLE" },
        { itemName: "Switch B", status: "NOT_AVAILABLE" },
      ],
    },
    salesmanName: "ABADALLA ANTHANATH",
    language: "en",
  });

  assert.match(summary, /Field visit report/);
  assert.match(summary, /Customer: Sultan Salem Ahmed Al-Shehri Accessories Establishment/);
  assert.match(summary, /Code: 1542/);
  assert.match(summary, /Salesman: ABADALLA ANTHANATH/);
  assert.match(summary, /Outcome: Payment follow-up/);
  assert.match(summary, /Notes: Customer asked for invoice copy\./);
  assert.doesNotMatch(summary, /Stock check/);
  assert.doesNotMatch(summary, /Cable A/);
  assert.doesNotMatch(summary, /Switch B/);
  assert.match(summary, /Outstanding:/);
  assert.match(summary, /0-30: 1,200/);
  assert.match(summary, /31-60: 800/);
  assert.match(summary, /61-90: 500/);
  assert.match(summary, />90: 300/);
  assert.match(summary, /Total: 2,800/);
});
