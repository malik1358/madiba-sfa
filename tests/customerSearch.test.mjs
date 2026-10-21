import test from "node:test";
import assert from "node:assert/strict";

import {
  customerMatchesSearchScope,
  customerSearchOrFilter,
  rankCustomerSearchRows,
} from "../app/lib/customerSearch.js";

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
  const scope = {
    hasAllAccess: false,
    visibleSalesmanCodes: ["SM01"],
    sharedCustomerCodes: ["1605"],
  };
  assert.equal(customerMatchesSearchScope({ customer_code: "1316", current_salesman_code: "SM01" }, scope), true);
  assert.equal(customerMatchesSearchScope({ customer_code: "1605", current_salesman_code: "SM99" }, scope), true);
  assert.equal(customerMatchesSearchScope({ customer_code: "9999", current_salesman_code: "SM99" }, scope), false);
  assert.equal(
    customerMatchesSearchScope({ customer_code: "9999", current_salesman_code: "SM99" }, { hasAllAccess: true }),
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
