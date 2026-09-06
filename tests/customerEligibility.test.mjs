import test from "node:test";
import assert from "node:assert/strict";

import {
  isBuildingMaterialCustomer,
  isDoNotUseCustomer,
  isVisitStatusCustomer,
} from "../app/management/my-day/customerEligibility.js";

test("Do Not Use customer names are excluded regardless of spacing or case", () => {
  assert.equal(isDoNotUseCustomer("DO NOT USE - OLD CUSTOMER"), true);
  assert.equal(isDoNotUseCustomer("Customer do  not  use"), true);
  assert.equal(isDoNotUseCustomer("Rawaa Trading"), false);
});

test("building material customers are identified by name, type, or salesman", () => {
  assert.equal(isBuildingMaterialCustomer({ customer_name: "Al Khaleej Building Materials" }), true);
  assert.equal(isBuildingMaterialCustomer({ customer_name: "مواد البناء الحديثة" }), true);
  assert.equal(isBuildingMaterialCustomer({ customer_type: "Building Material" }), true);
  assert.equal(isBuildingMaterialCustomer({ current_salesman_code: "BUILDING MATERIAL" }), true);
  assert.equal(isBuildingMaterialCustomer({ customer_name: "Rawaa Trading" }), false);
  assert.equal(isBuildingMaterialCustomer({ customer_name: "Body Care Shop" }), false);
});

test("visit status includes only active usable customers", () => {
  assert.equal(isVisitStatusCustomer({ customer_name: "Active Customer", is_active: true }), true);
  assert.equal(isVisitStatusCustomer({ customer_name: "DO NOT USE Customer", is_active: true }), false);
  assert.equal(isVisitStatusCustomer({ customer_name: "Inactive Customer", is_active: false }), false);
});