import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionDaySummary,
  findUnloggedIdleGaps,
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
  assert.match(joined, /Started at 12 pm and till 1:45 pm visited 4 customer/);
  assert.match(joined, /collection only from 1 customer of 3,625 SAR/);
  assert.match(joined, /Between 2:30 pm to 7:30 pm visited 2 customer/);
  assert.match(joined, /went to Kharj/);
  assert.match(joined, /In Kharj visited 3 customer/);
  assert.match(joined, /without any collection/);
  assert.match(joined, /Came back to Riyadh and visited 1 customer/);
  assert.match(joined, /Total 10 visit/);
  assert.match(joined, /2 successful collection/);
  assert.match(joined, /4,625 SAR collected/);
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
      loginAt: ksaIso({ year: 2026, month: 8, day: 23 }, 7, 30),
      logoutAt: ksaIso({ year: 2026, month: 8, day: 23 }, 16, 0),
      lunchOutAt: ksaIso({ year: 2026, month: 8, day: 23 }, 12, 0),
      lunchInAt: ksaIso({ year: 2026, month: 8, day: 23 }, 13, 0),
    },
  );

  const joined = summary.lines.join("\n");
  assert.match(joined, /Login at 7:30 am/);
  assert.match(joined, /Logout at 4 pm/);
  assert.match(joined, /Lunch out at 12 pm/);
  assert.match(joined, /Lunch in at 1 pm/);
  assert.doesNotMatch(joined, /not logged/);
});

test("buildCollectionDaySummary says login lunch and logout are not logged", () => {
  const visits = [
    {
      customer_code: "C1",
      saved_at: ksaIso({ year: 2026, month: 8, day: 23 }, 11, 31),
      visit_outcome: "NOT_PAID",
      amount_received: 0,
    },
  ];

  const summary = buildCollectionDaySummary(visits, new Map([["C1", { city: "Riyadh" }]]), {});
  const joined = summary.lines.join("\n");
  assert.match(joined, /Login not logged/);
  assert.match(joined, /Logout not logged/);
  assert.match(joined, /Lunch out not logged/);
  assert.match(joined, /Lunch in not logged/);
});

test("findUnloggedIdleGaps flags 30+ minute gaps without lunch", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const visits = [
    { customer_code: "C1", saved_at: ksaIso(date, 11, 31) },
    { customer_code: "C2", saved_at: ksaIso(date, 12, 45) },
  ];

  const gaps = findUnloggedIdleGaps({ visits });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].minutes, 74);
});

test("findUnloggedIdleGaps does not flag logged lunch windows", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const visits = [
    { customer_code: "C1", saved_at: ksaIso(date, 11, 0) },
    { customer_code: "C2", saved_at: ksaIso(date, 14, 0) },
  ];

  const gaps = findUnloggedIdleGaps({
    visits,
    lunchOutAt: ksaIso(date, 12, 0),
    lunchInAt: ksaIso(date, 13, 0),
  });

  assert.deepEqual(
    gaps.map((gap) => gap.minutes),
    [60, 60],
  );
});

test("findUnloggedIdleGaps ignores an open lunch-out until the next activity", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const gaps = findUnloggedIdleGaps({
    visits: [
      { customer_code: "C1", saved_at: ksaIso(date, 11, 0) },
      { customer_code: "C2", saved_at: ksaIso(date, 15, 0) },
    ],
    lunchOutAt: ksaIso(date, 12, 0),
  });

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].minutes, 60);
});

test("buildCollectionDaySummary lists unlogged idle periods", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const summary = buildCollectionDaySummary(
    [
      { customer_code: "C1", saved_at: ksaIso(date, 11, 31), visit_outcome: "NOT_PAID", amount_received: 0 },
      { customer_code: "C2", saved_at: ksaIso(date, 12, 45), visit_outcome: "NOT_PAID", amount_received: 0 },
    ],
    new Map([
      ["C1", { city: "Riyadh" }],
      ["C2", { city: "Riyadh" }],
    ]),
    {},
  );

  assert.match(
    summary.lines.join("\n"),
    /Unlogged idle from 11:31 am to 12:45 pm \(1h 14m\) — no activity logged\./,
  );
  assert.doesNotMatch(summary.lines.join("\n"), /lunch was not marked/);
});

test("buildCollectionDaySummary sorts idle with visits and uses last visit instead of midnight logout", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const visits = [
    {
      customer_code: "C1",
      saved_at: ksaIso(date, 11, 31),
      visit_outcome: "FUNDS_RECEIVED",
      amount_received: 3700,
    },
    {
      customer_code: "C2",
      saved_at: ksaIso(date, 20, 23),
      visit_outcome: "FUNDS_RECEIVED",
      amount_received: 1000,
    },
  ];

  const summary = buildCollectionDaySummary(
    visits,
    new Map([
      ["C1", { city: "Riyadh" }],
      ["C2", { city: "Riyadh" }],
    ]),
    {
      loginAt: ksaIso(date, 10, 18),
      logoutAt: ksaIso(date, 23, 59),
      logoutAutoClosed: true,
    },
  );

  const joined = summary.lines.join("\n");
  assert.match(joined, /Login at 10:18 am/);
  assert.match(joined, /Logout at 8:23 pm/);
  assert.doesNotMatch(joined, /11:59/);
  assert.doesNotMatch(joined, /lunch was not marked/);
  assert.match(joined, /4,700 SAR collected/);

  assert.match(joined, /At 11:31 am visited 1 customer/);
  assert.doesNotMatch(joined, /Started at 11:31 am and till 11:31 am/);

  const idleIndex = summary.lines.findIndex((line) => line.includes("Unlogged idle from 10:18 am"));
  const visitIndex = summary.lines.findIndex((line) => line.includes("At 11:31 am visited"));
  const logoutIndex = summary.lines.findIndex((line) => line.includes("Logout at 8:23 pm"));
  assert.ok(idleIndex > 0 && visitIndex > idleIndex);
  assert.ok(logoutIndex > visitIndex);
});

test("formatNarrativeTime uses KSA clock", () => {
  const label = formatNarrativeTime(ksaIso({ year: 2026, month: 8, day: 23 }, 14, 0));
  assert.equal(label, "2 pm");
});

test("buildCollectionDaySummary counts two same-GPS saves as one location", () => {
  const date = { year: 2026, month: 8, day: 30 };
  const visits = [
    {
      customer_code: "1234",
      saved_at: ksaIso(date, 19, 45),
      visit_outcome: "FUNDS_RECEIVED",
      amount_received: 1000,
      latitude: 24.57151,
      longitude: 46.73935,
    },
    {
      customer_code: "1234",
      saved_at: ksaIso(date, 20, 14),
      visit_outcome: "FUNDS_RECEIVED",
      amount_received: 1000,
      latitude: 24.57151,
      longitude: 46.73935,
    },
  ];

  const summary = buildCollectionDaySummary(visits, new Map([
    ["1234", { city: "Riyadh", area: "Al Marqab" }],
  ]));

  assert.equal(summary.stats.uniqueCustomers, 1);
  assert.equal(summary.stats.totalVisits, 2);
  assert.equal(summary.stats.uniqueGpsLocations, 1);
  assert.match(summary.lines.join("\n"), /Visited 1 customer\(s\) at 1 unique GPS location/);
});
