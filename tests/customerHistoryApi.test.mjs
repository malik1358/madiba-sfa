import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildSettlementCustomerHistoryUrl } from "../app/lib/customerHistoryApi.js";

const customerHistoryRoute = fs.readFileSync(
  new URL("../app/api/customer-history/route.js", import.meta.url),
  "utf8",
);

test("buildSettlementCustomerHistoryUrl keeps New Order on full settlement history", () => {
  const url = buildSettlementCustomerHistoryUrl(
    "/api/customer-history",
    " C001 ",
    "Madiba Medical",
    { refresh: true },
  );

  assert.equal(
    url,
    "/api/customer-history?customerCode=C001&customerName=Madiba+Medical&fullHistory=1&scope=settlement&refresh=1&waitReceipts=1",
  );
});

test("buildSettlementCustomerHistoryUrl trims customer name whitespace", () => {
  const url = buildSettlementCustomerHistoryUrl(
    "/api/customer-history",
    "C001",
    "  Madiba Medical  ",
  );

  assert.equal(
    url,
    "/api/customer-history?customerCode=C001&customerName=Madiba+Medical&fullHistory=1&scope=settlement&waitReceipts=1",
  );
});

test("buildSettlementCustomerHistoryUrl appends params to existing query", () => {
  const url = buildSettlementCustomerHistoryUrl(
    "/api/customer-history?foo=1",
    "C001",
    "Madiba Medical",
  );

  assert.equal(
    url,
    "/api/customer-history?foo=1&customerCode=C001&customerName=Madiba+Medical&fullHistory=1&scope=settlement&waitReceipts=1",
  );
});

test("customer history loads current and full history from the active sales snapshot", () => {
  const currentMonthStart = customerHistoryRoute.indexOf("async function fetchCurrentMonthRows");
  const currentMonthEnd = customerHistoryRoute.indexOf("async function overlayCurrentMonthTransactions");
  const historyStart = customerHistoryRoute.indexOf("async function fetchCustomerTransactions");
  const historyEnd = customerHistoryRoute.indexOf("async function fetchPeerTransactions", historyStart);
  const querySources = [
    customerHistoryRoute.slice(currentMonthStart, currentMonthEnd),
    customerHistoryRoute.slice(historyStart, historyEnd),
  ];

  for (const source of querySources) {
    assert.match(source, /\.from\("active_sales"\)/);
    assert.doesNotMatch(source, /\.from\("sales_raw"\)/);
  }

  assert.match(customerHistoryRoute, /const CACHE_VERSION = 19;/);
  assert.match(customerHistoryRoute, /function shouldIncludePeerTransactions/);
  assert.match(customerHistoryRoute, /writeCachedInBackground/);
  assert.match(customerHistoryRoute, /loadReceiptDatasetCached/);
});

test("the audit receipt follow-up waits for the register instead of painting sales alone", () => {
  const cache = fs.readFileSync(
    new URL("../app/lib/mobileDataCache.js", import.meta.url),
    "utf8",
  );
  const followUp = cache.slice(cache.indexOf("function fillPendingReceipts"));
  assert.match(followUp, /waitReceipts:\s*true/);
  assert.match(followUp, /const delays = \[0, 2500\]/);
  assert.doesNotMatch(followUp.slice(0, followUp.indexOf("export async function fetchItemsMasterCached")), /20000/);
});

test("settlement history waits for receipts instead of returning every invoice open", () => {
  assert.match(customerHistoryRoute, /const waitReceipts =/);
  assert.match(customerHistoryRoute, /if \(waitReceipts \|\| receiptDatasetIsWarm\(\)\)/);
});

test("customer history skips peer rows on full settlement history unless includePeers=1", () => {
  assert.match(
    customerHistoryRoute,
    /if \(includePeers\) return true;\s*return !fullHistory;/s,
  );
  assert.match(customerHistoryRoute, /includePeers/);
});
