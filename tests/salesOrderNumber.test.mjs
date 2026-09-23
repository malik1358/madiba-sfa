import test from "node:test";
import assert from "node:assert/strict";

import {
  formatOrderPdfOrderNumberLabel,
  formatSalesOrderNumber,
  formatSalesOrderNumberForDisplay,
  isPlaceholderSalesOrderNumber,
  requireSalesOrderNumber,
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

test("formatOrderPdfOrderNumberLabel prints a provisional label for queued orders", () => {
  assert.equal(formatOrderPdfOrderNumberLabel({ id: 296 }), "Order No. 296");
  assert.equal(formatOrderPdfOrderNumberLabel({ order_number: "SO-1001" }), "Order No. SO-1001");
  assert.equal(formatOrderPdfOrderNumberLabel({ order_number: "PARVEZ-0042" }), "Order No. PARVEZ-0042");
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
    formatSalesOrderNumber({ id: "pending:x", orderNumber: "PARVEZ-0003" }),
    "PARVEZ-0003",
  );
  assert.throws(() => requireSalesOrderNumber({ id: "pending:8981a846-ca3" }), /Order number is required/);
  assert.throws(() => requireSalesOrderNumber({}), /Order number is required/);
  assert.throws(() => formatOrderPdfOrderNumberLabel({}), /Order number is required/);
});
