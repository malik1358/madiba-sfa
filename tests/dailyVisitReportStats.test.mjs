import test from "node:test";
import assert from "node:assert/strict";

import {
  assignOnSiteVisitNumbers,
  buildVisitDaySplit,
  entryDisplayAmount,
  loginLogoutLocationNotes,
} from "../app/lib/dailyVisitReportStats.js";

test("on-site visit numbers skip far entries", () => {
  const numbered = assignOnSiteVisitNumbers([
    { transactionType: "MORNING_ATTENDANCE" },
    { transactionType: "VISIT_REPORT", customerCode: "A", isFarFromCustomer: true },
    { transactionType: "COLLECTION_VISIT", customerCode: "B", isFarFromCustomer: false },
    { transactionType: "ORDER_SUBMITTED", customerCode: "C", isFarFromCustomer: false },
    { transactionType: "GPS_PING" },
  ]);

  assert.equal(numbered[1].onSiteVisitNumber, null);
  assert.equal(numbered[2].onSiteVisitNumber, 1);
  assert.equal(numbered[3].onSiteVisitNumber, 2);
});

test("day split counts visit without order separately from collections", () => {
  const split = buildVisitDaySplit([
    { transactionType: "VISIT_REPORT", customerCode: "V1" },
    { transactionType: "VISIT_REPORT", customerCode: "V2" },
    { transactionType: "ORDER_SUBMITTED", customerCode: "V2" },
    { transactionType: "COLLECTION_VISIT", customerCode: "C1", amountReceived: 500 },
    { transactionType: "COLLECTION_VISIT", customerCode: "C2", amountReceived: 100 },
  ], {
    newCustomerOrderCount: 1,
    newCustomerOrderValue: 2000,
    repeatCustomerOrderCount: 2,
    repeatCustomerOrderValue: 1500,
    orderCount: 3,
    orderValue: 3500,
  });

  assert.equal(split.visitWithoutOrderCount, 1);
  assert.equal(split.collectionCount, 2);
  assert.equal(split.collectionValue, 600);
  assert.equal(split.newCustomerOrderCount, 1);
  assert.equal(split.repeatCustomerOrderCount, 2);
});

test("buildVisitDaySplit uses posted order totals when new/repeat fields are missing", () => {
  const split = buildVisitDaySplit(
    [
      { transactionType: "ORDER_SUBMITTED", customerCode: "1108C" },
      { transactionType: "ORDER_SUBMITTED", customerCode: "1481" },
      { transactionType: "ORDER_SUBMITTED", customerCode: "1481" },
    ],
    { orderCount: 3, orderValue: 15380.6 },
  );

  assert.equal(split.orderCount, 3);
  assert.equal(split.newCustomerOrderCount, 3);
  assert.equal(split.newCustomerOrderValue, 15380.6);
  assert.equal(split.repeatCustomerOrderCount, 0);
});

test("entryDisplayAmount uses order value when collection amount is empty", () => {
  assert.equal(entryDisplayAmount({ transactionType: "ORDER_SUBMITTED", orderValue: 5380.6 }), 5380.6);
  assert.equal(entryDisplayAmount({ transactionType: "COLLECTION_VISIT", amountReceived: 11000 }), 11000);
  assert.equal(entryDisplayAmount({ transactionType: "ORDER_DRAFT" }), 0);
});

test("login logout coaching fires when GPS is away from first and last customer", () => {
  const notes = loginLogoutLocationNotes([
    {
      transactionType: "MORNING_ATTENDANCE",
      entryLatitude: 24.7,
      entryLongitude: 46.6,
    },
    {
      transactionType: "VISIT_REPORT",
      customerCode: "A",
      isFarFromCustomer: false,
      entryLatitude: 24.8,
      entryLongitude: 46.8,
    },
    {
      transactionType: "END_OF_DAY",
      entryLatitude: 24.7,
      entryLongitude: 46.6,
    },
  ]);

  assert.equal(notes.length, 2);
  assert.match(notes[0], /first customer/);
  assert.match(notes[1], /last customer/);
});
