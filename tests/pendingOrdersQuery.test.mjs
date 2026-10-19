import test from "node:test";
import assert from "node:assert/strict";

import { filterPendingOrdersForScope } from "../app/lib/pendingOrdersQuery.js";

test("filterPendingOrdersForScope returns all rows for full access", () => {
  const orders = [
    { id: 1, created_by: "user-a", salesman_code: "SM001" },
    { id: 2, created_by: "user-b", salesman_code: "SM002" },
  ];

  assert.deepEqual(
    filterPendingOrdersForScope(orders, { hasAllAccess: true }),
    orders,
  );
});

test("filterPendingOrdersForScope limits rows to visible creators or salesmen", () => {
  const orders = [
    { id: 1, created_by: "user-a", salesman_code: "SM001" },
    { id: 2, created_by: "user-b", salesman_code: "SM002" },
    { id: 3, created_by: "user-c", salesman_code: "SM003" },
  ];

  const filtered = filterPendingOrdersForScope(orders, {
    hasAllAccess: false,
    visibleUserIds: ["user-a"],
    visibleSalesmanCodes: ["SM002"],
  });

  assert.deepEqual(filtered.map((row) => row.id), [1, 2]);
});
