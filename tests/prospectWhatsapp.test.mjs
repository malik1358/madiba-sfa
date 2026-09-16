import test from "node:test";
import assert from "node:assert/strict";

import { buildProspectFollowUpWhatsappSummary } from "../app/lib/prospectWhatsapp.js";

test("buildProspectFollowUpWhatsappSummary matches field visit report format", () => {
  const summary = buildProspectFollowUpWhatsappSummary({
    form: {
      customer_name_en: "Al Noor Trading",
      shop_name: "Al Noor Shop",
      owner_name: "Ahmed",
      mobile: "0512345678",
      city: "Riyadh",
      area: "Olaya",
      salesman_code: "S12",
      notes: "",
    },
    prospect: { id: 64, offline_id: "offline-64" },
    followUpDate: "2026-09-20",
    salesmanName: "OSAMA (S12)",
    visitDistance: {
      latitude: 24.7136,
      longitude: 46.6753,
      distanceFromCustomerKm: 0.12,
      distanceFromPreviousKm: 3.4,
      waitingMinutes: 0,
    },
  });

  assert.match(summary, /^Field visit report/);
  assert.match(summary, /Customer: Al Noor Trading/);
  assert.match(summary, /Code: PROSPECT-64/);
  assert.match(summary, /Salesman: OSAMA \(S12\)/);
  assert.match(summary, /Outcome: Order not received/);
  assert.match(summary, /Next visit: 20\/09\/2026/);
  assert.match(summary, /Notes: Order not received/);
  assert.match(summary, /Outstanding:/);
  assert.match(summary, /0-30: 0/);
  assert.match(summary, /31-60: 0/);
  assert.match(summary, /61-90: 0/);
  assert.match(summary, />90: 0/);
  assert.match(summary, /Total: 0/);
  assert.match(summary, /GPS: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=24\.7136%2C46\.6753/);
  assert.match(summary, /Distance from customer: 0.12 km/);
  assert.match(summary, /Distance from previous: 3.40 km/);
  assert.match(summary, /Est. waiting: 0 min/);
  assert.doesNotMatch(summary, /Contact:/);
  assert.doesNotMatch(summary, /Mobile:/);
  assert.doesNotMatch(summary, /City:/);
  assert.doesNotMatch(summary, /New prospect visit/);
});

test("buildProspectFollowUpWhatsappSummary uses custom notes and offline code", () => {
  const summary = buildProspectFollowUpWhatsappSummary({
    form: {
      shop_name: "Pending Sync Shop",
      salesman_code: "S09",
      notes: "Asked to bring catalogue.",
    },
    prospect: { offline_id: "abc-123" },
    followUpDate: "2026-09-18",
    salesmanCode: "S09",
  });

  assert.match(summary, /^Field visit report/);
  assert.match(summary, /Customer: Pending Sync Shop/);
  assert.match(summary, /Code: PROSPECT-OFF-abc-123/);
  assert.match(summary, /Outcome: Order not received/);
  assert.match(summary, /Next visit: 18\/09\/2026/);
  assert.match(summary, /Notes: Asked to bring catalogue\./);
  assert.match(summary, /Salesman: S09/);
  assert.match(summary, /Total: 0/);
});
