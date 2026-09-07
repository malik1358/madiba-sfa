import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQueuedPendingOrderId,
  isQueuedPendingOrderId,
  mergeServerAndQueuedOrders,
  queuedSalesOrderToRow,
} from "../app/lib/queuedSalesOrders.js";

test("queued sales orders map to pending queue rows", () => {
  const row = queuedSalesOrderToRow({
    id: "e6506fa4-bb8a-4f21-9c1d-1234567890ab",
    createdAt: Date.parse("2026-09-07T08:00:00.000Z"),
    updatedAt: Date.parse("2026-09-07T08:00:00.000Z"),
    status: "pending",
    url: "/api/sales-orders",
    metadata: { type: "sales_order", action: "submit", customerCode: "PROSPECT-OFF-1" },
    jsonBody: {
      customerCode: "PROSPECT-OFF-1",
      customerName: "test",
      salesmanCode: "ADMIN",
      lines: [{ item_code: "A", quantity: 2 }],
    },
  });

  assert.equal(row.id, "pending:e6506fa4-bb8");
  assert.equal(isQueuedPendingOrderId(row.id), true);
  assert.equal(row.queuedLocally, true);
  assert.equal(row.status, "SUBMITTED");
  assert.equal(row.customer_name, "test");
  assert.equal(row.queuedLines.length, 1);
});

test("mergeServerAndQueuedOrders keeps device orders on top of server rows", () => {
  const merged = mergeServerAndQueuedOrders(
    [{ id: 242, customer_name: "Old", updated_at: "2026-08-30T10:00:00.000Z" }],
    [{ id: "pending:e6506fa4-bb8", customer_name: "test", updated_at: "2026-09-07T08:00:00.000Z", queuedLocally: true }],
  );

  assert.equal(merged[0].id, "pending:e6506fa4-bb8");
  assert.equal(merged[1].id, 242);
  assert.equal(buildQueuedPendingOrderId("abc-123"), "pending:abc-123");
});
