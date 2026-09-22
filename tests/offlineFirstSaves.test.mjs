import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("offlineApi defaults field saves to queueFirst", () => {
  const source = fs.readFileSync(new URL("../app/lib/offlineApi.js", import.meta.url), "utf8");
  assert.match(source, /queueFirst = true/);
  assert.match(source, /Field saves default to on-device first/);
});

test("My Day visit and status updates are offline-first", () => {
  const source = fs.readFileSync(new URL("../app/management/my-day/page.js", import.meta.url), "utf8");
  assert.match(source, /queueFirst: true/);
  assert.match(source, /skipTimeline: true/);
  assert.match(source, /sendJsonResilient/);
  assert.match(source, /type: "customer_inactive"/);
  assert.match(source, /type: "customer_active"/);
  assert.match(source, /type: "prospect_foreclose"/);
  assert.doesNotMatch(source, /loadCustomerAvgDaysToPay/);
});

test("sales order draft and submit are offline-first", () => {
  const source = fs.readFileSync(
    new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /queueFirst: true/);
  assert.match(source, /skipTimeline: true/);
  assert.equal((source.match(/queueFirst: true/g) || []).length >= 2, true);
});

test("stock take saves are offline-first", () => {
  const source = fs.readFileSync(new URL("../app/management/stock-take/page.js", import.meta.url), "utf8");
  assert.equal((source.match(/queueFirst: true/g) || []).length >= 6, true);
});

test("new customer prospect link is offline-first", () => {
  const source = fs.readFileSync(new URL("../app/management/new-customer/page.js", import.meta.url), "utf8");
  assert.match(source, /type: "prospect_link_customer"/);
  assert.match(source, /queueFirst: true/);
  assert.match(source, /skipTimeline: true/);
});
