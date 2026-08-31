import test from "node:test";
import assert from "node:assert/strict";
import { buildNearestCustomerActionLinks } from "../app/lib/dashboardNearestCustomers.js";

const customer = {
  customer_code: "C100",
  customer_name: "Al Madina",
  current_salesman_code: "S12",
};

test("salesman sees visit, new order, and my-collections links", () => {
  const actions = buildNearestCustomerActionLinks(customer, {
    modules: {
      visitWithoutOrder: true,
      newOrder: true,
      myCollections: true,
    },
  });

  assert.deepEqual(actions.map((action) => action.key), ["visit", "order", "collection"]);
  assert.equal(actions[0].href, "/management/visit-without-order?customer_code=C100&customer_name=Al+Madina&salesman_code=S12");
  assert.equal(actions[1].href, "/management/new-order?customer_code=C100&customer_name=Al+Madina&salesman_code=S12");
  assert.equal(actions[2].href, "/management/my-collections?customer=C100");
});

test("manager sees payment-collections instead of my-collections", () => {
  const actions = buildNearestCustomerActionLinks(customer, {
    canAccess: (key) => ["visitWithoutOrder", "newOrder", "paymentCollections"].includes(key),
  });

  assert.equal(actions.at(-1).href, "/management/payment-collections?customer=C100");
});

test("skips modules the user cannot access", () => {
  const actions = buildNearestCustomerActionLinks(customer, {
    modules: { newOrder: true },
  });

  assert.deepEqual(actions.map((action) => action.key), ["order"]);
});

test("returns no actions without a customer code", () => {
  assert.deepEqual(buildNearestCustomerActionLinks({ customer_name: "Al Madina" }, { modules: { newOrder: true } }), []);
});
