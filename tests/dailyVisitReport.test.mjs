import test from "node:test";
import assert from "node:assert/strict";

import {
  countDailyVisitEntries,
  countFarFromCustomerEntries,
  countsTowardDailyVisitEntryStats,
} from "../app/lib/dailyVisitReportServer.js";

test("daily visit entry stats skip idle GPS pings and visit reports", () => {
  const entries = [
    { transactionType: "MORNING_ATTENDANCE", isFarFromCustomer: false },
    { transactionType: "VISIT_REPORT", isFarFromCustomer: true },
    { transactionType: "GPS_PING", isFarFromCustomer: true },
    { transactionType: "COLLECTION_VISIT", isFarFromCustomer: true },
    { transaction_type: "ORDER_SUBMITTED", isFarFromCustomer: false },
    { transactionType: "END_OF_DAY", isFarFromCustomer: false },
  ];

  assert.equal(countsTowardDailyVisitEntryStats(entries[1]), false);
  assert.equal(countsTowardDailyVisitEntryStats(entries[2]), false);
  assert.equal(countDailyVisitEntries(entries), 4);
  assert.equal(countFarFromCustomerEntries(entries), 1);
});
