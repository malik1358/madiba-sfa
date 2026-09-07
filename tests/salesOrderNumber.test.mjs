import test from "node:test";
import assert from "node:assert/strict";

import {
  formatSalesOrderNumber,
  isPlaceholderSalesOrderNumber,
  salesOrderNumberNeedsLiveLookup,
} from "../app/lib/salesOrderNumber.js";

test("formatSalesOrderNumber prefers stored order_number over id", () => {
  assert.equal(formatSalesOrderNumber({ id: 55, order_number: "SO-1001" }), "SO-1001");
  assert.equal(formatSalesOrderNumber({ orderId: 296 }), "296");
});

test("formatSalesOrderNumber does not treat pending queue ids as the live number", () => {
  assert.equal(formatSalesOrderNumber({ id: "pending:8981a846-ca3" }), "");
  assert.equal(formatSalesOrderNumber({ orderId: 325, orderNumber: "pending" }), "325");
  assert.equal(isPlaceholderSalesOrderNumber("pending:8981a846-ca3"), true);
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: "pending:8981a846-ca3" }), true);
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: 296 }), false);
});
