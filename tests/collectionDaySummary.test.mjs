import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionDaySummary,
  formatNarrativeTime,
  isSuccessfulCollection,
} from "../app/lib/collectionDaySummary.js";

function ksaIso(date, hour, minute = 0) {
  // KSA is UTC+3
  return new Date(Date.UTC(date.year, date.month - 1, date.day, hour - 3, minute, 0)).toISOString();
}

test("isSuccessfulCollection accepts FUNDS_RECEIVED or positive amount", () => {
  assert.equal(isSuccessfulCollection({ visit_outcome: "FUNDS_RECEIVED", amount_received: 0 }), true);
  assert.equal(isSuccessfulCollection({ visit_outcome: "NOT_PAID", amount_received: 100 }), true);
  assert.equal(isSuccessfulCollection({ visit_outcome: "NOT_PAID", amount_received: 0 }), false);
});

test("buildCollectionDaySummary matches SM001-style day narrative", () => {
  const date = { year: 2026, month: 8, day: 23 };
  const visits = [
    { customer_code: "C1", saved_at: ksaIso(date, 12, 0), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C2", saved_at: ksaIso(date, 12, 30), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C3", saved_at: ksaIso(date, 13, 0), visit_outcome: "FUNDS_RECEIVED", amount_received: 3625 },
    { customer_code: "C4", saved_at: ksaIso(date, 13, 45), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C5", saved_at: ksaIso(date, 14, 30), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C6", saved_at: ksaIso(date, 19, 30), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C7", saved_at: ksaIso(date, 20, 0), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C8", saved_at: ksaIso(date, 20, 30), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C9", saved_at: ksaIso(date, 21, 30), visit_outcome: "NOT_PAID", amount_received: 0 },
    { customer_code: "C10", saved_at: ksaIso(date, 22, 15), visit_outcome: "FUNDS_RECEIVED", amount_received: 1000 },
  ];

  const customerLocationByCode = new Map([
    ["C1", { city: "Riyadh", area: "Olaya" }],
    ["C2", { city: "Riyadh", area: "Olaya" }],
    ["C3", { city: "Riyadh", area: "Malaz" }],
    ["C4", { city: "Riyadh", area: "Malaz" }],
    ["C5", { city: "Riyadh", area: "Exit South" }],
    ["C6", { city: "Riyadh", area: "Exit South" }],
    ["C7", { city: "Al Kharj", area: "Industrial" }],
    ["C8", { city: "Kharj", area: "Downtown" }],
    ["C9", { city: "Kharj", area: "Downtown" }],
    ["C10", { city: "Riyadh", area: "Return" }],
  ]);

  const summary = buildCollectionDaySummary(visits, customerLocationByCode);

  assert.equal(summary.stats.uniqueCustomers, 10);
  assert.equal(summary.stats.totalVisits, 10);
  assert.equal(summary.stats.successfulCollections, 2);

  const joined = summary.lines.join("\n");
  assert.match(joined, /Visited 10 customer/);
  assert.match(joined, /Started at 12 pm and till 7:30 pm visited 6 customer/);
  assert.match(joined, /collection only from 1 customer of 3,625 SAR/);
  assert.match(joined, /went to Kharj/);
  assert.match(joined, /In Kharj visited 3 customer/);
  assert.match(joined, /without any collection/);
  assert.match(joined, /Came back to Riyadh and visited 1 customer/);
  assert.match(joined, /Total 10 visit/);
  assert.match(joined, /2 successful collection/);
});

test("buildCollectionDaySummary includes lunch break when provided", () => {
  const visits = [
    {
      customer_code: "C1",
      saved_at: ksaIso({ year: 2026, month: 8, day: 23 }, 8, 0),
      visit_outcome: "NOT_PAID",
      amount_received: 0,
    },
    {
      customer_code: "C2",
      saved_at: ksaIso({ year: 2026, month: 8, day: 23 }, 14, 0),
      visit_outcome: "NOT_PAID",
      amount_received: 0,
    },
  ];

  const summary = buildCollectionDaySummary(
    visits,
    new Map([
      ["C1", { city: "Riyadh" }],
      ["C2", { city: "Riyadh" }],
    ]),
    {
      lunchOutAt: ksaIso({ year: 2026, month: 8, day: 23 }, 12, 0),
      lunchInAt: ksaIso({ year: 2026, month: 8, day: 23 }, 13, 0),
    },
  );

  assert.match(summary.lines.join("\n"), /Lunch break from 12 pm to 1 pm/);
});

test("formatNarrativeTime uses KSA clock", () => {
  const label = formatNarrativeTime(ksaIso({ year: 2026, month: 8, day: 23 }, 14, 0));
  assert.equal(label, "2 pm");
});
