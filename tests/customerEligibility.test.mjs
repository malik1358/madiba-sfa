import test from "node:test";
import assert from "node:assert/strict";

import {
  isDoNotUseCustomer,
  isVisitStatusCustomer,
} from "../app/management/my-day/customerEligibility.js";

test("Do Not Use customer names are excluded regardless of spacing or case", () => {
  assert.equal(isDoNotUseCustomer("DO NOT USE - OLD CUSTOMER"), true);
  assert.equal(isDoNotUseCustomer("Customer do  not  use"), true);
  assert.equal(isDoNotUseCustomer("Rawaa Trading"), false);
});

test("visit status includes only active usable customers", () => {
  assert.equal(isVisitStatusCustomer({ customer_name: "Active Customer", is_active: true }), true);
  assert.equal(isVisitStatusCustomer({ customer_name: "DO NOT USE Customer", is_active: true }), false);
  assert.equal(isVisitStatusCustomer({ customer_name: "Inactive Customer", is_active: false }), false);
});