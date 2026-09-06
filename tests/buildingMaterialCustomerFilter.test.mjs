import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesMixByCustomer,
  excludeBuildingMaterialCustomers,
  isExcludedNewOrderCustomer,
} from "../app/lib/buildingMaterialCustomerFilter.js";

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
