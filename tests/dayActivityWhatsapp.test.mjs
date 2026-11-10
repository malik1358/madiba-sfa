import test from "node:test";
import assert from "node:assert/strict";

import {
  formatDayActivityWhatsappLines,
  patchWhatsappSummaryDayActivity,
  resolveDayActivityTillMessage,
} from "../app/lib/dayActivityWhatsapp.js";
import { buildFieldVisitWhatsappSummary } from "../app/lib/fieldVisitWhatsapp.js";
import { buildCollectionVisitSummary } from "../app/lib/collectionVisitSummary.js";
import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";

test("formatDayActivityWhatsappLines pads blank lines and formats totals", () => {
  const lines = formatDayActivityWhatsappLines({
    known: true,
    orderCount: 3,
    orderValue: 12500.5,
    visitWithoutOrderCount: 2,
    collectionCount: 4,
    collectionValue: 3200,
  });

  assert.deepEqual(lines, [
    "",
    "Visits with order: 3 / 12,500.5 ﷼",
    "Visits without order: 2",
    "Collections: 4 / 3,200 ﷼",
    "",
  ]);
});

test("formatDayActivityWhatsappLines shows dashes when unknown", () => {
  assert.deepEqual(
    formatDayActivityWhatsappLines({ known: false }),
    [
      "",
      "Visits with order: -",
      "Visits without order: -",
      "Collections: -",
      "",
    ],
  );
});

test("formatDayActivityWhatsappLines omits the block when stats were not loaded", () => {
  assert.deepEqual(formatDayActivityWhatsappLines(null), []);
  assert.deepEqual(formatDayActivityWhatsappLines(undefined), []);
});

test("resolveDayActivityTillMessage counts visits orders and collections including current", () => {
  const stats = resolveDayActivityTillMessage({
    entries: [
      { transactionType: "VISIT_REPORT", customerCode: "V1", savedAt: "2026-11-10T08:00:00.000Z" },
      { transactionType: "VISIT_REPORT", customerCode: "V2", savedAt: "2026-11-10T09:00:00.000Z" },
      { transactionType: "ORDER_SUBMITTED", customerCode: "V2", savedAt: "2026-11-10T09:05:00.000Z" },
      {
        transactionType: "COLLECTION_VISIT",
        customerCode: "C1",
        amountReceived: 500,
        savedAt: "2026-11-10T10:00:00.000Z",
      },
    ],
    orderStats: { orderCount: 1, orderValue: 2000 },
    untilAt: "2026-11-10T11:00:00.000Z",
    currentEntry: {
      transactionType: "COLLECTION_VISIT",
      customerCode: "C2",
      amountReceived: 250,
      visitOutcome: "FUNDS_RECEIVED",
      savedAt: "2026-11-10T11:00:00.000Z",
    },
  });

  assert.equal(stats.visitWithoutOrderCount, 1);
  assert.equal(stats.orderCount, 1);
  assert.equal(stats.orderValue, 2000);
  assert.equal(stats.collectionCount, 2);
  assert.equal(stats.collectionValue, 750);
});

test("resolveDayActivityTillMessage includes current submitted order value", () => {
  const stats = resolveDayActivityTillMessage({
    entries: [
      { transactionType: "VISIT_REPORT", customerCode: "A1", savedAt: "2026-11-10T08:00:00.000Z" },
    ],
    orderStats: { orderCount: 0, orderValue: 0 },
    untilAt: "2026-11-10T12:00:00.000Z",
    currentEntry: {
      transactionType: "ORDER_SUBMITTED",
      customerCode: "B1",
      orderValue: 4500,
      savedAt: "2026-11-10T12:00:00.000Z",
    },
  });

  assert.equal(stats.orderCount, 1);
  assert.equal(stats.orderValue, 4500);
  assert.equal(stats.visitWithoutOrderCount, 1);
});

test("resolveDayActivityTillMessage treats prospect follow-up as visit without order", () => {
  const stats = resolveDayActivityTillMessage({
    entries: [],
    untilAt: "2026-11-10T12:00:00.000Z",
    currentEntry: {
      transactionType: "PROSPECT_FOLLOW_UP",
      customerCode: "PROSPECT-1",
      savedAt: "2026-11-10T12:00:00.000Z",
    },
  });

  assert.equal(stats.visitWithoutOrderCount, 1);
  assert.equal(stats.orderCount, 0);
  assert.equal(stats.collectionCount, 0);
});

test("buildFieldVisitWhatsappSummary appends day activity totals at the end", () => {
  const summary = buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: "1542",
      customer_name: "Sultan Accessories",
      last_visit_date: "2026-11-01",
    },
    visitForm: {
      outcome: "COME_BACK_LATER",
      visitAt: "2026-11-10T09:00:00.000Z",
    },
    salesmanName: "OSAMA",
    dayActivity: {
      known: true,
      orderCount: 2,
      orderValue: 8000,
      visitWithoutOrderCount: 3,
      collectionCount: 1,
      collectionValue: 500,
    },
  });

  assert.match(summary, /Last visit date: 01\/11\/2026\.\n\nVisits with order: 2 \/ 8,000 ﷼\nVisits without order: 3\nCollections: 1 \/ 500 ﷼/);
});

test("buildCollectionVisitSummary appends day activity totals at the end", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_code: "1224",
      customer_name: "Test Customer",
      salesman_name: "AHMED",
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: 100,
      receiptMode: "CASH",
      nextVisitAt: "",
    },
    {
      dayActivity: {
        known: true,
        orderCount: 0,
        orderValue: 0,
        visitWithoutOrderCount: 1,
        collectionCount: 2,
        collectionValue: 900,
      },
    },
  );

  assert.match(summary, /Visits with order: 0 \/ 0 ﷼\nVisits without order: 1\nCollections: 2 \/ 900 ﷼/);
});

test("buildOrderWhatsappSummary appends day activity totals at the end", () => {
  const summary = buildOrderWhatsappSummary({
    orderNumber: "P01",
    customerCode: "1108C",
    customerName: "Customer",
    salesmanCode: "P",
    salesmanName: "Parvez",
    statusLabel: "Submitted",
    paymentType: "credit",
    pricingRegion: "riyadh",
    pricingType: "wholesale",
    itemCount: 1,
    totalQuantity: 2,
    totals: { amountExclVat: 100, vatAmount: 15, amountInclVat: 115 },
    dayActivity: {
      known: true,
      orderCount: 1,
      orderValue: 100,
      visitWithoutOrderCount: 0,
      collectionCount: 0,
      collectionValue: 0,
    },
  });

  assert.match(summary, /Visits with order: 1 \/ 100 ﷼\nVisits without order: 0\nCollections: 0 \/ 0 ﷼/);
});

test("patchWhatsappSummaryDayActivity replaces an existing totals block", () => {
  const patched = patchWhatsappSummaryDayActivity(
    [
      "Field visit report",
      "Customer: Test",
      "",
      "Visits with order: 1 / 100 ﷼",
      "Visits without order: 2",
      "Collections: 0 / 0 ﷼",
    ].join("\n"),
    {
      known: true,
      orderCount: 3,
      orderValue: 900,
      visitWithoutOrderCount: 1,
      collectionCount: 2,
      collectionValue: 400,
    },
  );

  assert.match(patched, /Visits with order: 3 \/ 900 ﷼\nVisits without order: 1\nCollections: 2 \/ 400 ﷼/);
  assert.doesNotMatch(patched, /Visits with order: 1 \/ 100/);
});
