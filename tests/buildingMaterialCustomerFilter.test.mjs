import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesMixByCustomer,
  excludeBuildingMaterialCustomers,
  isExcludedNewOrderCustomer,
} from "../app/lib/buildingMaterialCustomerFilter.js";

test("1020C is hidden from New Order even without sales history", () => {
  const customer = {
    customer_code: "1020C",
    customer_name: "AL AMAL AL MUWAHHADDAH FOR MANUFACTURING CO.",
  };

  assert.equal(isExcludedNewOrderCustomer(customer), true);
  assert.equal(excludeBuildingMaterialCustomers([customer]).length, 0);
});

test("1020C is hidden when its sales are only building material", () => {
  const customer = {
    customer_code: "1020C",
    customer_name: "AL AMAL AL MUWAHHADDAH FOR MANUFACTURING CO.",
  };
  const mixByCode = buildSalesMixByCustomer([
    { customer_code: "1020C", item_code: "BM1", item_name: "MDF 18MM", category: "Building Material" },
    { customer_code: "1020C", item_code: "BM2", item_name: "Plywood", category: "Building Materials" },
  ]);

  assert.equal(isExcludedNewOrderCustomer(customer, mixByCode), true);
  assert.equal(excludeBuildingMaterialCustomers([customer], mixByCode).length, 0);
});

test("unclassified hardware sales do not keep a building material account visible", () => {
  const customer = {
    customer_code: "1999C",
    customer_name: "Hardware Trading Co.",
  };
  const mixByCode = buildSalesMixByCustomer([
    { customer_code: "1999C", item_code: "LP00190", item_name: "Cement Board 1.22X2.44MtrX12MM", category: "Unclassified" },
    { customer_code: "1999C", item_code: "A003622", item_name: "GRADE-E2 5 MM X 1220MM X 2440MM", category: "Unclassified" },
  ]);

  assert.equal(isExcludedNewOrderCustomer(customer, mixByCode), true);
});

test("cosmetics customers stay visible even if they also bought building material", () => {
  const customer = {
    customer_code: "1187C",
    customer_name: "MODY GOODS STORE",
  };
  const mixByCode = buildSalesMixByCustomer([
    { customer_code: "1187C", item_code: "BM1", category: "Building Material" },
    { customer_code: "1187C", item_code: "BC1", item_name: "Body Lotion", category: "Body Care" },
  ]);

  assert.equal(isExcludedNewOrderCustomer(customer, mixByCode), false);
});

test("customers with no building material sales stay visible", () => {
  const customer = {
    customer_code: "1118",
    customer_name: "EXPRESSWAY TRADING EST.",
  };
  const mixByCode = buildSalesMixByCustomer([
    { customer_code: "1118", item_code: "BC1", item_name: "Body Lotion", category: "Body Care" },
  ]);

  assert.equal(isExcludedNewOrderCustomer(customer, mixByCode), false);
});
