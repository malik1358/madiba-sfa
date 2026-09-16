import test from "node:test";
import assert from "node:assert/strict";

import { buildProspectFollowUpWhatsappSummary } from "../app/lib/prospectWhatsapp.js";

test("buildProspectFollowUpWhatsappSummary builds order-not-received revisit message", () => {
  const summary = buildProspectFollowUpWhatsappSummary({
    form: {
      customer_name_en: "Al Noor Trading",
      shop_name: "Al Noor Shop",
      owner_name: "Ahmed",
      mobile: "0512345678",
      city: "Riyadh",
      area: "Olaya",
      salesman_code: "S12",
      notes: "Asked to bring catalogue.",
    },
    prospect: { id: 64, offline_id: "offline-64" },
    followUpDate: "2026-09-20",
    salesmanName: "OSAMA (S12)",
  });

  assert.match(summary, /^New prospect visit/);
  assert.match(summary, /Customer: Al Noor Trading/);
  assert.match(summary, /Code: PROSPECT-64/);
  assert.match(summary, /Salesman: OSAMA \(S12\)/);
  assert.match(summary, /Outcome: Order not received/);
  assert.match(summary, /Next visit: 20\/09\/2026/);
  assert.match(summary, /Contact: Ahmed/);
  assert.match(summary, /Mobile: 0512345678/);
  assert.match(summary, /City: Riyadh/);
  assert.match(summary, /Area: Olaya/);
  assert.match(summary, /Notes: Asked to bring catalogue\./);
});

test("buildProspectFollowUpWhatsappSummary falls back to offline prospect code", () => {
  const summary = buildProspectFollowUpWhatsappSummary({
    form: {
      shop_name: "Pending Sync Shop",
      salesman_code: "S09",
    },
    prospect: { offline_id: "abc-123" },
    followUpDate: "2026-09-18",
    salesmanCode: "S09",
  });

  assert.match(summary, /Customer: Pending Sync Shop/);
  assert.match(summary, /Code: PROSPECT-OFF-abc-123/);
  assert.match(summary, /Outcome: Order not received/);
  assert.match(summary, /Next visit: 18\/09\/2026/);
  assert.match(summary, /Salesman: S09/);
  assert.doesNotMatch(summary, /Contact:/);
  assert.doesNotMatch(summary, /Notes:/);
});
