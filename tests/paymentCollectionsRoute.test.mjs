import test from "node:test";
import assert from "node:assert/strict";

import { resolveExistingCollectionCustomerCode } from "../app/lib/customerCode.js";
import { ensureCollectionCustomerRecord } from "../app/api/payment-collections/route.js";

test("resolveExistingCollectionCustomerCode reuses suffix account variants like 1608C", () => {
  assert.equal(resolveExistingCollectionCustomerCode(["1608C"], "1608"), "1608C");
  assert.equal(resolveExistingCollectionCustomerCode(["1608", "1608C"], "1608"), "1608C");
});

test("resolveExistingCollectionCustomerCode avoids unrelated numeric prefixes", () => {
  assert.equal(resolveExistingCollectionCustomerCode(["16080", "16081"], "1608"), "");
});

function createCustomerAdmin({ exact = null, fuzzy = [], insertError = null } = {}) {
  const calls = {
    inserted: [],
    ilikePattern: "",
  };

  const customersQuery = {
    eq(column, value) {
      assert.equal(column, "customer_code");
      return {
        async maybeSingle() {
          return { data: exact ? { customer_code: value } : null, error: null };
        },
      };
    },
    ilike(column, pattern) {
      assert.equal(column, "customer_code");
      calls.ilikePattern = pattern;
      return {
        async limit(limitValue) {
          assert.equal(limitValue, 25);
          return {
            data: fuzzy.map((customer_code) => ({ customer_code })),
            error: null,
          };
        },
      };
    },
  };

  return {
    calls,
    from(table) {
      assert.equal(table, "customers");
      return {
        select(fields) {
          assert.equal(fields, "customer_code");
          return customersQuery;
        },
        async insert(row) {
          calls.inserted.push(row);
          return { error: insertError };
        },
      };
    },
  };
}

test("ensureCollectionCustomerRecord reuses existing suffix account variants instead of inserting duplicates", async () => {
  const admin = createCustomerAdmin({ fuzzy: ["1608C"] });

  const customerCode = await ensureCollectionCustomerRecord(admin, "1608", "1608 TEST CUSTOMER");

  assert.equal(customerCode, "1608C");
  assert.equal(admin.calls.ilikePattern, "1608%");
  assert.equal(admin.calls.inserted.length, 0);
});

test("ensureCollectionCustomerRecord inserts a new customer only when no matching variant exists", async () => {
  const admin = createCustomerAdmin();

  const customerCode = await ensureCollectionCustomerRecord(admin, "1608", "1608 TEST CUSTOMER");

  assert.equal(customerCode, "1608");
  assert.deepEqual(admin.calls.inserted, [{
    customer_code: "1608",
    customer_name: "1608 TEST CUSTOMER",
    is_active: true,
  }]);
});
