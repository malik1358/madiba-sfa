import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  blockedByAvgDaysMessage,
  parseOrderBlockOverride,
  resolveOrderBlockStatus,
} from "../app/lib/customerOrderBlock.js";

test("blocks when avg days reaches threshold and no override", () => {
  const status = resolveOrderBlockStatus({ avgDaysToPay: ORDER_BLOCK_AVG_DAYS_THRESHOLD });
  assert.equal(status.blocked, true);
  assert.equal(status.isOverThreshold, true);
  assert.equal(status.isAdminUnblocked, false);
});

test("does not block when admin override is active", () => {
  const status = resolveOrderBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true },
  });
  assert.equal(status.blocked, false);
  assert.equal(status.isAdminUnblocked, true);
});

test("parseOrderBlockOverride handles invalid JSON safely", () => {
  const override = parseOrderBlockOverride("{invalid");
  assert.equal(override.isUnblocked, false);
  assert.equal(override.note, "");
});

test("blocked message includes rounded average", () => {
  const message = blockedByAvgDaysMessage({ avgDaysToPay: 120.4, threshold: 120 });
  assert.match(message, /120/);
});
