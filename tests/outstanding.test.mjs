import test from "node:test";
import assert from "node:assert/strict";

import {
  customerCodeCandidates,
  findOutstandingCustomerCodesForSalesmen,
} from "../app/lib/outstanding.js";

test("findOutstandingCustomerCodesForSalesmen matches normalized salesman identity", () => {
  const dataset = {
    invoices: [
      {
        customer_code: "1173C LOULOAT AL NILE TRADING CO.",
        customer_name: "1173C LOULOAT AL NILE TRADING CO.",
        salesman: "Ahmed Nabil",
      },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("findOutstandingCustomerCodesForSalesmen does not widen unrelated scope", () => {
  const dataset = {
    invoices: [
      { customer_code: "1173C", salesman: "Ahmed Nabil" },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("customerCodeCandidates extracts code from a combined customer master value", () => {
  assert.deepEqual(
    customerCodeCandidates("1173C LOULOAT AL NILE TRADING CO."),
    ["1173C LOULOAT AL NILE TRADING CO.", "1173C"]
  );
});