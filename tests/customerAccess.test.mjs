import test from "node:test";
import assert from "node:assert/strict";

import { ensureCustomerVisibleToScope } from "../app/lib/customerAccess.js";

function createFakeAdmin({ customersRows = new Map(), dataset = null } = {}) {
  const upserts = [];

  function resultFor(table, state) {
    if (table === "system_settings") {
      return {
        data: dataset ? { setting_value: JSON.stringify(dataset) } : null,
        error: null,
      };
    }
    if (table === "customers") {
      const code = state.eq.customer_code;
      const row = code !== undefined ? (customersRows.get(code) || null) : null;
      if (state.single) return { data: row, error: null };
      return { data: row ? [row] : [], error: null };
    }
    // sales_raw backfill and active_sales scope probes find nothing.
    return { data: state.single ? null : [], error: null };
  }

  function chain(table) {
    const state = { eq: {}, single: false };
    const api = {
      select() { return api; },
      or() { return api; },
      ilike() { return api; },
      in() { return api; },
      order() { return api; },
      gt() { return api; },
      eq(column, value) { state.eq[column] = value; return api; },
      limit() { return Promise.resolve(resultFor(table, state)); },
      maybeSingle() {
        state.single = true;
        return Promise.resolve(resultFor(table, state));
      },
      upsert(payload, options) {
        upserts.push({ table, payload, options });
        if (table === "customers") {
          customersRows.set(payload.customer_code, { ...payload });
        }
        return Promise.resolve({ error: null });
      },
    };
    return api;
  }

  return { admin: { from: chain }, upserts, customersRows };
}

const salesmanScope = {
  hasAllAccess: false,
  visibleSalesmanCodes: ["SM1"],
  visibleMembers: [{ salesman_code: "SM1", salesman_name: "Basheer Karuval" }],
};

const outstandingDataset = {
  rows: [
    {
      customer_code: "",
      customer_name: "1657 Al-Tal Cosmetics Company",
      salesman: "Basheer Karuval",
      buckets: { "61-90": 3420.81 },
      total_outstanding: 3420.81,
    },
  ],
};

test("outstanding-only customer is backfilled into customers and visible to the owning salesman", async () => {
  const { admin, upserts } = createFakeAdmin({ dataset: outstandingDataset });

  const customer = await ensureCustomerVisibleToScope(admin, "1657", salesmanScope);

  assert.equal(customer.customer_code, "1657");
  assert.equal(customer.customer_name, "Al-Tal Cosmetics Company");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].table, "customers");
  assert.deepEqual(upserts[0].options, { onConflict: "customer_code" });
  assert.equal(upserts[0].payload.is_active, true);
});

test("outstanding-only customer owned by another salesman stays hidden and is not backfilled", async () => {
  const foreignDataset = {
    rows: [
      {
        ...outstandingDataset.rows[0],
        salesman: "Some Other Salesman",
      },
    ],
  };
  const { admin, upserts } = createFakeAdmin({ dataset: foreignDataset });

  await assert.rejects(
    () => ensureCustomerVisibleToScope(admin, "1657", salesmanScope),
    /Customer not found/,
  );
  assert.equal(upserts.length, 0);
});

test("customer missing from customers, prospects, and outstanding still throws", async () => {
  const { admin, upserts } = createFakeAdmin({ dataset: { rows: [] } });

  await assert.rejects(
    () => ensureCustomerVisibleToScope(admin, "9999", salesmanScope),
    /Customer not found/,
  );
  assert.equal(upserts.length, 0);
});

test("Belal can open master-owned customer 1583 even when outstanding salesman is ST107 Mr Belal", async () => {
  const belalCustomer = {
    customer_code: "1583",
    customer_name: "Zawya Al Tawfeer Foundation",
    current_salesman_code: "BELAL",
    previous_salesman_code: null,
    is_active: true,
  };
  const { admin } = createFakeAdmin({
    customersRows: new Map([["1583", belalCustomer]]),
    dataset: {
      rows: [{
        customer_code: "1583",
        customer_name: "Zawya Al Tawfeer Foundation",
        salesman: "ST107 Mr Belal",
        total_outstanding: 5192.67,
      }],
      invoices: [{
        customer_code: "1583",
        customer_name: "Zawya Al Tawfeer Foundation",
        salesman: "ST107 Mr Belal",
        pending_amount: 139.84,
      }],
    },
  });

  const customer = await ensureCustomerVisibleToScope(admin, "1583", {
    hasAllAccess: false,
    visibleSalesmanCodes: ["BELAL"],
    visibleMembers: [{ salesman_code: "BELAL", salesman_name: "BELAL" }],
    sharedCustomerCodes: [],
  });
  assert.equal(customer.customer_code, "1583");
  assert.equal(customer.current_salesman_code, "BELAL");
});
