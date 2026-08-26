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
  assert.match(summary, /Cable A: Available/);
  assert.match(summary, /Switch B: Not available/);
});
