import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSettlementOpenDelta,
  isSettlementOpenDeltaDust,
  settlementSalesBillDelta,
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

test("Open Δ is Machine Open minus Tally Open", () => {
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 20024.32,
    outstanding_pending: 20024.33,
    remaining: 0,
  }), -20024.33);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 24150,
    outstanding_pending: 24149.19,
    remaining: 0,
  }), -24149.19);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 4600,
    outstanding_pending: 4600,
    remaining: 0,
  }), -4600);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 64975,
    outstanding_pending: 64975,
    remaining: 20599.33,
  }), -44375.67);
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
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 39926.85,
    outstanding_pending: 33102.03,
    remaining: 0,
  }), -33102.03);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 42197.13,
    outstanding_pending: 0,
    remaining: 1,
  }), 1);
  assert.equal(settlementTransactionDelta({
    amount_incl_vat: 4088.25,
    outstanding_pending: 563.75,
    remaining: 563.05,
  }), -0.7);
  assert.equal(settlementTransactionDelta({ amount_incl_vat: 100, remaining: 100 }), null);
});

test("paid bill with matching Tally face amount keeps the full open gap on Compare", () => {
  assert.equal(settlementSalesBillDelta({
    amount_incl_vat: 20024.32,
    outstanding_pending: 20024.33,
    remaining: 0,
  }), -20024.33);
  assert.equal(settlementSalesBillDelta({
    amount_incl_vat: 4600,
    outstanding_pending: 4600,
    remaining: 0,
  }), -4600);
});

test("still-open bill keeps the one-fil sales-versus-Tally gap", () => {
  assert.equal(settlementSalesBillDelta({
    amount_incl_vat: 20024.32,
    outstanding_pending: 20024.33,
    remaining: 20024.33,
  }), -0.01);
});
