import test from "node:test";
import assert from "node:assert/strict";

import {
  customerMatchesSearchScope,
  customerSearchOrFilter,
  rankCustomerSearchRows,
  resolveCustomerLookupScope,
} from "../app/lib/customerSearch.js";
import {
  clearSalesScopeResolveCache,
  withSalesScopeResolveCache,
} from "../app/lib/salesScopeResolveCache.js";

test("customer search waits for at least two characters", () => {
  assert.equal(customerSearchOrFilter(""), "");
  assert.equal(customerSearchOrFilter("1"), "");
  assert.equal(customerSearchOrFilter("13"), "customer_code.ilike.%13%,customer_name.ilike.%13%");
});

test("customer search drops characters that would break the filter", () => {
  assert.equal(
    customerSearchOrFilter("13,16"),
    "customer_code.ilike.%1316%,customer_name.ilike.%1316%",
  );
});

test("customer search quotes names that contain spaces", () => {
  assert.equal(
    customerSearchOrFilter("Al Furs"),
    `customer_code.ilike."%Al Furs%",customer_name.ilike."%Al Furs%"`,
  );
});

test("scoped search keeps the salesman's own and shared customers", () => {
  // Use distinct person codes — loose SM### prefixes all collapse to "SM" and falsely match.
  const scope = {
    hasAllAccess: false,
    visibleSalesmanCodes: ["JUNAID"],
    sharedCustomerCodes: ["1605"],
  };
  assert.equal(customerMatchesSearchScope({ customer_code: "1316", current_salesman_code: "JUNAID" }, scope), true);
  assert.equal(customerMatchesSearchScope({ customer_code: "1605", current_salesman_code: "PARVEZ" }, scope), true);
  assert.equal(customerMatchesSearchScope({ customer_code: "9999", current_salesman_code: "PARVEZ" }, scope), false);
  assert.equal(
    customerMatchesSearchScope({ customer_code: "9999", current_salesman_code: "PARVEZ" }, { hasAllAccess: true }),
    true,
  );
});

test("search ranking puts the exact code first", () => {
  const ranked = rankCustomerSearchRows([
    { customer_code: "13160", customer_name: "Later" },
    { customer_code: "2000", customer_name: "Market 1316" },
    { customer_code: "1316", customer_name: "First" },
  ], "1316");
  assert.deepEqual(ranked.map((row) => row.customer_code), ["1316", "13160", "2000"]);
});

test("company-wide lookup scope skips the full sales-scope resolver", async () => {
  let fullCalls = 0;
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return { data: { id: "u1", role: "admin", salesman_code: "AD01", salesman_name: "Admin" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const scope = await resolveCustomerLookupScope(
    admin,
    { id: "u1", user_metadata: {} },
    async () => {
      fullCalls += 1;
      return { hasAllAccess: false };
    },
  );

  assert.equal(scope.hasAllAccess, true);
  assert.equal(fullCalls, 0);
});

test("salesman lookup scope falls through to the full resolver", async () => {
  let fullCalls = 0;
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return { data: { id: "u2", role: "salesman", salesman_code: "SM01", salesman_name: "Field" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const scope = await resolveCustomerLookupScope(
    admin,
    { id: "u2", user_metadata: {} },
    async () => {
      fullCalls += 1;
      return { hasAllAccess: false, visibleSalesmanCodes: ["SM01"] };
    },
  );

  assert.equal(fullCalls, 1);
  assert.deepEqual(scope.visibleSalesmanCodes, ["SM01"]);
});

test("sales scope resolve cache reuses in-flight and warm results", async () => {
  clearSalesScopeResolveCache();
  let loads = 0;

  const first = withSalesScopeResolveCache("user-a", async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { hasAllAccess: true, n: loads };
  });
  const second = withSalesScopeResolveCache("user-a", async () => {
    loads += 1;
    return { hasAllAccess: true, n: loads };
  });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(a, b);

  const third = await withSalesScopeResolveCache("user-a", async () => {
    loads += 1;
    return { hasAllAccess: true, n: loads };
  });
  assert.equal(loads, 1);
  assert.equal(third, a);
  clearSalesScopeResolveCache();
});
