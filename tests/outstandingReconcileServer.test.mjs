import test from "node:test";
import assert from "node:assert/strict";
import {
  forEachCustomerSalesHistory,
  preferredReconcileCustomerCode,
  receiptsForAccount,
  reconcileAccountGroupKey,
} from "../app/lib/outstandingReconcileServer.js";

test("reconcileAccountGroupKey groups 1171 with 1171C", () => {
  assert.equal(reconcileAccountGroupKey("1171C"), "1171");
  assert.equal(reconcileAccountGroupKey("1171"), "1171");
  assert.equal(reconcileAccountGroupKey("1035C"), "1035");
  assert.equal(reconcileAccountGroupKey("C001"), "C001");
});

test("receiptsForAccount includes related customer codes", () => {
  const byCode = new Map([
    ["1171", [{ customer_code: "1171", amount: 10 }]],
    ["1171C", [{ customer_code: "1171C", amount: 20 }]],
    ["9999", [{ customer_code: "9999", amount: 99 }]],
  ]);
  const rows = receiptsForAccount(byCode, "1171C");
  assert.deepEqual(rows.map((row) => row.amount).sort((a, b) => a - b), [10, 20]);
});

test("preferredReconcileCustomerCode keeps the outstanding upload code", () => {
  const customersByCode = new Map([["1171C", { customer_code: "1171C" }]]);
  assert.equal(preferredReconcileCustomerCode(["1171", "1171C"], customersByCode), "1171C");
  assert.equal(preferredReconcileCustomerCode(["1171", "1171C"], new Map()), "1171C");
});


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

test("forEachCustomerSalesHistory pages with a keyset and keeps one customer together", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1,
    customer_code: "C001",
    transaction_date: "2026-01-01",
    sales_amount: 1,
  }));
  const calls = [];
  const admin = {
    rpc(name, args) {
      calls.push({ name, args });
      if (calls.length === 1) return Promise.resolve({ data: firstPage, error: null });
      return Promise.resolve({
        data: [
          { id: 1001, customer_code: "C001", transaction_date: "2026-01-02", sales_amount: 4 },
          { id: 1002, customer_code: "c002", transaction_date: "2026-02-01", sales_amount: 9 },
        ],
        error: null,
      });
    },
    from() {
      throw new Error("offset pagination should not run when the keyset function exists");
    },
  };
  const customers = [];

  await forEachCustomerSalesHistory(admin, (code, rows) => {
    customers.push({ code, ids: rows.map((row) => row.id) });
  });

  assert.equal(calls[0].name, "active_sales_history_page");
  assert.equal(calls[0].args.after_customer, null);
  assert.equal(calls[0].args.after_id, null);
  assert.equal(calls[1].args.after_customer, "C001");
  assert.equal(calls[1].args.after_id, 1000);
  assert.deepEqual(customers, [
    { code: "C001", ids: [...firstPage.map((row) => row.id), 1001] },
    { code: "C002", ids: [1002] },
  ]);
});

test("forEachCustomerSalesHistory falls back to offset pages when the keyset function is absent", async () => {
  let ranged = false;
  const admin = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.active_sales_history_page" },
      });
    },
    from(table) {
      assert.equal(table, "active_sales");
      return {
        select() { return this; },
        order() { return this; },
        range: async () => {
          ranged = true;
          return { data: [{ id: 7, customer_code: "C009", sales_amount: 3 }], error: null };
        },
      };
    },
  };
  const customers = [];
  await forEachCustomerSalesHistory(admin, (code, rows) => {
    customers.push({ code, id: rows[0].id });
  });
  assert.equal(ranged, true);
  assert.deepEqual(customers, [{ code: "C009", id: 7 }]);
});