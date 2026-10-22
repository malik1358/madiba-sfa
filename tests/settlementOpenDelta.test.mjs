import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSettlementOpenDelta,
  isSettlementOpenDeltaDust,
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
