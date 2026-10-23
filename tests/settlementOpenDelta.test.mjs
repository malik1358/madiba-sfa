import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSettlementOpenDelta,
  isSettlementOpenDeltaDust,
  settlementTransactionDelta,
} from "../app/lib/settlementOpenDelta.js";

test("a sub-fil Machine vs Tally gap shows as 0", () => {
  assert.equal(formatSettlementOpenDelta(-0.006), "0");
  assert.equal(formatSettlementOpenDelta(0.009), "0");
  assert.equal(formatSettlementOpenDelta(-0.009), "0");
  assert.equal(isSettlementOpenDeltaDust(-0.006), true);
});

test("a real fil or more still shows", () => {
  assert.equal(formatSettlementOpenDelta(-0.01), "-0.01");
  assert.equal(formatSettlementOpenDelta(0.02), "+0.02");
  assert.equal(isSettlementOpenDeltaDust(-0.01), false);
});

test("Open Δ compares the sales amount with the Tally bill", () => {
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 20024.32,
    outstanding_pending: 20024.33,
    remaining: 0,
  }), -0.01);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 4600,
    outstanding_pending: 4600,
    remaining: 0,
  }), 0);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 64975,
    outstanding_pending: 64975,
    remaining: 20599.33,
  }), 0);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 55200,
    outstanding_pending: 0,
    remaining: 0,
  }), 0);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 61312.25,
    outstanding_pending: 107.6,
    remaining: 107.63,
  }), 0.03);
  assert.equal(settlementTransactionDelta({ amount_incl_vat: 100, remaining: 100 }), null);
});
