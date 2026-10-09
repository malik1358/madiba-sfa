import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("queued draft and submit share a request id and reject overlapping submits", () => {
  const source = fs.readFileSync(new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url), "utf8");
  assert.match(source, /if \(submitInFlight\.current\) return null/);
  assert.match(source, /orderRequestId\.current \|\|= crypto\.randomUUID\(\)/);
  assert.equal((source.match(/requestId: orderRequestId\.current/g) || []).length, 2);
});

test("order replay resolves the same row and request ids have a database unique index", () => {
  const route = fs.readFileSync(new URL("../app/api/sales-orders/route.js", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260930190000_sales_order_request_id.sql", import.meta.url), "utf8");
  assert.match(route, /\.eq\("request_id", requestId\)/);
  assert.match(route, /if \(requestId\) insertRow\.request_id = requestId/);
  assert.match(route, /replayOrder\?\.id \|\| requestedOrderId/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_request_id_key/);
});