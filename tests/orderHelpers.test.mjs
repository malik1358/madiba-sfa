import test from "node:test";
import assert from "node:assert/strict";
import { isProspectCustomerCode } from "../app/lib/customerCode.js";

test("isProspectCustomerCode matches prospect customer codes", () => {
  assert.equal(isProspectCustomerCode("PROSPECT-64"), true);
  assert.equal(isProspectCustomerCode("prospect-12"), true);
  assert.equal(isProspectCustomerCode("1062C"), false);
  assert.equal(isProspectCustomerCode("PROSPECT-ABC"), false);
});
