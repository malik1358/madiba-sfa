import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR,
  customerHasOutstandingBalance,
  findOutstandingForCustomer,
} from "../app/lib/outstanding.js";

test("customerHasOutstandingBalance detects visit-status bucket totals", () => {
  assert.equal(customerHasOutstandingBalance(null), false);
  assert.equal(customerHasOutstandingBalance({}), false);
  assert.equal(customerHasOutstandingBalance({
    outstanding_0_30: 0,
    outstanding_30_60: 0,
    outstanding_61_90: 0,
    outstanding_above_90: 0,
  }), false);
  assert.equal(customerHasOutstandingBalance({
    outstanding_0_30: 250,
    outstanding_30_60: 0,
    outstanding_61_90: 0,
    outstanding_above_90: 0,
  }), true);
});

test("customerHasOutstandingBalance detects uploaded outstanding rows", () => {
  assert.equal(customerHasOutstandingBalance({ total_outstanding: 0, buckets: { "0-30": 0 } }), false);
  assert.equal(customerHasOutstandingBalance({ total_outstanding: 1200 }), true);
  assert.equal(customerHasOutstandingBalance({ buckets: { "61-90": 500 } }), true);
});

test("findOutstandingForCustomer plus balance check blocks inactive candidates", () => {
  const dataset = {
    rows: [
      {
        customer_code: "C100",
        customer_name: "Trading Co",
        total_outstanding: 900,
        buckets: { "0-30": 900 },
      },
    ],
  };

  const withBalance = findOutstandingForCustomer(dataset, "C100", "Trading Co");
  const withoutBalance = findOutstandingForCustomer(dataset, "C200", "Clear Co");

  assert.equal(customerHasOutstandingBalance(withBalance), true);
  assert.equal(customerHasOutstandingBalance(withoutBalance), false);
  assert.equal(
    CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR,
    "Customers with outstanding cannot be marked inactive.",
  );
});
