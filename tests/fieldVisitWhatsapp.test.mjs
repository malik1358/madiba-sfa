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
  assert.match(summary, /Visit date\/time:.*\n\nWorking hours: -\n\n/);
  assert.match(summary, /GPS: -/);
  assert.match(summary, /Distance from customer: -/);
  assert.match(summary, /Est. waiting: -/);
});

test("buildFieldVisitWhatsappSummary includes working hours till the visit", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1542",
      customer_name: "Sultan Accessories",
    },
    visitForm: {
      outcome: "ORDER_TAKEN",
      visitAt: "2026-09-07T09:00:00.000Z",
    },
    salesmanName: "OSAMA",
    workingHours: { known: true, value: "1h 26m", minutes: 86 },
  });

  assert.match(summary, /\n\nWorking hours: 1h 26m\n\n/);
});

test("buildFieldVisitWhatsappSummary includes live visit distance metrics at the end", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "PROSPECT-300",
      customer_name: "Jawahir Alqamih Trading Company",
    },
    visitForm: {
      outcome: "PAYMENT_FOLLOWUP",
      nextVisitAt: "2026-09-12T10:00",
    },
    salesmanName: "OSAMA (OSAMA)",
    visitDistance: {
      latitude: 24.7136,
      longitude: 46.6753,
      distanceFromCustomerKm: 0.12,
      distanceFromPreviousKm: 3.4,
      waitingMinutes: 25,
    },
  });

  assert.match(summary, /Total: 0\n\nGPS: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=24\.7136%2C46\.6753/);
  assert.match(summary, /Distance from customer: 0.12 km/);
  assert.match(summary, /Distance from previous: 3.40 km/);
  assert.match(summary, /Est. waiting: 25 min/);
  assert.doesNotMatch(summary, /Last visit date/);
});

test("buildFieldVisitWhatsappSummary appends last visit date after GPS metrics", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1010",
      customer_name: "Adwaa Al Asaar",
      outstanding_0_30: 0,
      outstanding_30_60: 3132.6,
      outstanding_61_90: 2380.85,
      outstanding_above_90: 0,
      last_visit_date: "2026-10-15",
    },
    visitForm: {
      outcome: "COME_BACK_LATER",
      nextVisitAt: "2026-10-25",
      visitAt: "2026-10-21T16:51:00.000Z",
    },
    salesmanName: "BELAL (BELAL)",
    visitDistance: {
      latitude: 24.592775,
      longitude: 46.711635,
      distanceFromCustomerKm: 0.09,
      distanceFromPreviousKm: 0,
      waitingMinutes: null,
    },
    lastVisitAt: "2026-10-15",
  });

  assert.match(summary, /Est\. waiting: -\n\nLast visit date: 15\/10\/2026\./);
  assert.doesNotMatch(summary, /Last visit date:[\s\S]*GPS:/);
  assert.ok(summary.trimEnd().endsWith("Last visit date: 15/10/2026."));
});

test("buildFieldVisitWhatsappSummary reads last visit date from the customer row", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1034",
      customer_name: "Al Fursan",
      last_visit_date: "2026-09-01T10:00:00.000Z",
    },
    visitForm: {
      outcome: "ORDER_TAKEN",
      nextVisitAt: "2026-09-20",
    },
    salesmanName: "OSAMA",
  });

  assert.match(summary, /Last visit date: 01\/09\/2026/);
});

test("buildFieldVisitWhatsappSummary stays English when UI language is Arabic", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1034",
      customer_name: "Al Fursan Train Trading Company",
    },
    visitForm: {
      outcome: "COME_BACK_LATER",
      nextVisitAt: "2026-09-15T10:00",
    },
    salesmanName: "OSAMA (OSAMA)",
    language: "ar",
    visitDistance: {
      latitude: 24.594595,
      longitude: 46.705838,
      distanceFromCustomerKm: 0.68,
      distanceFromPreviousKm: 0,
      waitingMinutes: 13,
    },
  });

  assert.match(summary, /^Field visit report/);
  assert.match(summary, /Customer: Al Fursan Train Trading Company/);
  assert.match(summary, /Code: 1034/);
  assert.match(summary, /Salesman: OSAMA \(OSAMA\)/);
  assert.match(summary, /Outcome: Asked to come back later/);
  assert.match(summary, /Next visit: 15\/09\/2026/);
  assert.match(summary, /Outstanding:/);
  assert.match(summary, /0-30: 0/);
  assert.match(summary, /Total: 0/);
  assert.doesNotMatch(summary, /تقرير زيارة ميدانية/);
  assert.doesNotMatch(summary, /طلب العودة لاحقاً/);
  assert.doesNotMatch(summary, /العميل:/);
  assert.doesNotMatch(summary, /المستحقات:/);
});

test("buildFieldVisitWhatsappSummary can omit outstanding details", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "PROSPECT-64",
      customer_name: "Al Noor Trading",
      outstanding_above_90: 5100.19,
    },
    visitForm: {
      outcome: "Order not received",
      nextVisitAt: "2026-09-20",
      note: "Order not received",
    },
    salesmanName: "Administrator (ADMIN)",
    includeOutstanding: false,
  });

  assert.match(summary, /^Field visit report/);
  assert.match(summary, /Outcome: Order not received/);
  assert.doesNotMatch(summary, /Outstanding:/);
  assert.doesNotMatch(summary, /0-30:/);
  assert.doesNotMatch(summary, /Total:/);
  assert.doesNotMatch(summary, /5,100/);
});
