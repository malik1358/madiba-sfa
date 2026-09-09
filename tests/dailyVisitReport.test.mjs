import test from "node:test";
import assert from "node:assert/strict";

import {
  countDailyVisitEntries,
  countFarFromCustomerEntries,
  countsTowardDailyVisitEntryStats,
  buildFieldVisitStats,
  mergeProspectsIntoCustomerMap,
  resolveVisitCustomerName,
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

test("buildFieldVisitStats counts unique customers and collection amounts", () => {
  const stats = buildFieldVisitStats([
    { transactionType: "ORDER_DRAFT", customerCode: "1084C", customerName: "Bandar" },
    { transactionType: "ORDER_SUBMITTED", customerCode: "1084C", customerName: "Bandar" },
    { transactionType: "COLLECTION_VISIT", customerCode: "1497", customerName: "Enjaz", amountReceived: 575.75 },
    { transactionType: "VISIT_REPORT", customerCode: "1127C", customerName: "Food Village" },
    { transactionType: "GPS_PING" },
    { transactionType: "MORNING_ATTENDANCE" },
  ]);

  assert.equal(stats.uniqueCustomers, 3);
  assert.equal(stats.customers.find((row) => row.customerCode === "1497").amountCollected, 575.75);
  assert.equal(stats.customers.find((row) => row.customerCode === "1084C").amountCollected, 0);
});

test("resolveVisitCustomerName prefers prospect company name over PROSPECT code", () => {
  assert.equal(
    resolveVisitCustomerName(
      { customer_code: "PROSPECT-320", customer_name: "Al Mashaeel Trading" },
      { customer_code: "PROSPECT-320", meta: { customerName: "PROSPECT-320" } },
    ),
    "Al Mashaeel Trading",
  );
  assert.equal(
    resolveVisitCustomerName({}, { customer_code: "PROSPECT-325", meta: { customerName: "PROSPECT-325" } }),
    "PROSPECT-325",
  );
});

test("mergeProspectsIntoCustomerMap fills prospect names for visit report rows", () => {
  const customerMap = new Map();
  mergeProspectsIntoCustomerMap(customerMap, [
    { id: 320, company_name: "Al Mashaeel Trading", area: "Al Mashael District" },
    { id: 325, shop_name: "Gulf Stationery", city: "Riyadh" },
  ]);

  assert.equal(customerMap.get("PROSPECT-320").customer_name, "Al Mashaeel Trading");
  assert.equal(customerMap.get("PROSPECT-325").customer_name, "Gulf Stationery");
});
