import test from "node:test";
import assert from "node:assert/strict";

import {
  formatOrderPdfOrderNumberLabel,
  formatSalesOrderNumber,
  formatSalesOrderNumberForDisplay,
  isBareNumericOrderIdFallback,
  isPlaceholderSalesOrderNumber,
  orderNeedsSalesmanNumberRepair,
  readStoredSalesOrderNumber,
  requireSalesOrderNumber,
  salesOrderNumberNeedsLiveLookup,
} from "../app/lib/salesOrderNumber.js";

test("formatSalesOrderNumber prefers stored order_number over id", () => {
  assert.equal(formatSalesOrderNumber({ id: 55, order_number: "SO-1001" }), "SO-1001");
  assert.equal(formatSalesOrderNumber({ orderId: 296 }), "296");
});

test("bare numeric order ids matching the row id are not real salesman numbers", () => {
  assert.equal(isBareNumericOrderIdFallback("641", 641), true);
  assert.equal(isBareNumericOrderIdFallback("MOI01", 641), false);
  assert.equal(isBareNumericOrderIdFallback("642", 641), false);
  assert.equal(readStoredSalesOrderNumber({ id: 641, order_number: "641" }), "");
  assert.equal(readStoredSalesOrderNumber({ id: 641, order_number: "MOI01" }), "MOI01");
  assert.equal(orderNeedsSalesmanNumberRepair({ id: 641, order_number: "641" }), true);
  assert.equal(orderNeedsSalesmanNumberRepair({ id: 641, order_number: null }), true);
  assert.equal(orderNeedsSalesmanNumberRepair({ id: 641, order_number: "MOI01" }), false);
  // Live lookup is for pending/missing numbers — not for already-stored legacy numerics.
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: 641, order_number: "641" }), false);
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: 641, order_number: "" }), true);
});

test("formatSalesOrderNumber does not treat pending queue ids as the live number", () => {
  assert.equal(formatSalesOrderNumber({ id: "pending:8981a846-ca3" }), "");
  assert.equal(formatSalesOrderNumber({ orderId: 325, orderNumber: "pending" }), "325");
  assert.equal(isPlaceholderSalesOrderNumber("pending:8981a846-ca3"), true);
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: "pending:8981a846-ca3" }), true);
  assert.equal(salesOrderNumberNeedsLiveLookup({ id: 296, order_number: "P01" }), false);
});

test("formatOrderPdfOrderNumberLabel prints a provisional label for queued orders", () => {
  assert.equal(formatOrderPdfOrderNumberLabel({ id: 296 }), "Order No. 296");
  assert.equal(formatOrderPdfOrderNumberLabel({ order_number: "SO-1001" }), "Order No. SO-1001");
  assert.equal(formatOrderPdfOrderNumberLabel({ order_number: "P01" }), "Order No. P01");
  assert.equal(formatOrderPdfOrderNumberLabel({ order_number: "PA03" }), "Order No. PA03");
  assert.equal(requireSalesOrderNumber({ orderId: 337 }), "337");
  assert.equal(
    formatOrderPdfOrderNumberLabel({ id: "pending:8981a846-ca3" }),
    "Order No. Pending sync",
  );
  assert.equal(
    formatSalesOrderNumberForDisplay({ orderId: "pending:8981a846-ca3" }),
    "Pending sync",
  );
  assert.equal(
    formatSalesOrderNumber({ id: "pending:x", orderNumber: "P03" }),
    "P03",
  );
  assert.throws(() => requireSalesOrderNumber({ id: "pending:8981a846-ca3" }), /Order number is required/);
  assert.throws(() => requireSalesOrderNumber({}), /Order number is required/);
  assert.throws(() => formatOrderPdfOrderNumberLabel({}), /Order number is required/);
});
