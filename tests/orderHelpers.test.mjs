import test from "node:test";
import assert from "node:assert/strict";
import { isProspectCustomerCode } from "../app/lib/customerCode.js";
import { buildOrderItems } from "../app/management/customer-audit/lib/orderHelpers.js";

test("isProspectCustomerCode matches prospect customer codes", () => {
  assert.equal(isProspectCustomerCode("PROSPECT-64"), true);
  assert.equal(isProspectCustomerCode("prospect-12"), true);
  assert.equal(isProspectCustomerCode("1062C"), false);
  assert.equal(isProspectCustomerCode("PROSPECT-ABC"), false);
});

test("buildOrderItems prefers catalog names over historical do-not-use names", () => {
  const orderQuantities = { A004078: 5 };
  const analytics = {
    items: [{
      item_code: "A004078",
      item_name: "BOX FILE DO NOT USE old code",
      category: "Stationery",
    }],
  };
  const catalogItems = [{
    item_code: "A004078",
    item_name: "BOX FILE FIXED MECH ARCH FILE 24PC - ENGLISH",
    category: "Stationery",
  }];

  const items = buildOrderItems(orderQuantities, analytics, [], catalogItems);

  assert.equal(items.length, 1);
  assert.equal(items[0].item_code, "A004078");
  assert.equal(items[0].order_quantity, 5);
  assert.match(items[0].item_name, /BOX FILE FIXED/i);
});
