import test from "node:test";
import assert from "node:assert/strict";
import { forEachCustomerSalesHistory } from "../app/lib/outstandingReconcileServer.js";

test("forEachCustomerSalesHistory reads the canonical active sales view", async () => {
  let queriedTable = "";
  const admin = {
    from(table) {
      queriedTable = table;
      return {
        select() { return this; },
        order() { return this; },
        range: async () => ({
          data: [{ id: 1, customer_code: "C001", sales_amount: 100 }],
          error: null,
        }),
      };
    },
  };
  const customers = [];

  await forEachCustomerSalesHistory(admin, (code, rows) => {
    customers.push({ code, rows });
  });

  assert.equal(queriedTable, "active_sales");
  assert.deepEqual(customers, [{
    code: "C001",
    rows: [{ id: 1, customer_code: "C001", sales_amount: 100 }],
  }]);
});