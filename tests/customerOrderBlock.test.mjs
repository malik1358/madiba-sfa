import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  blockedByAvgDaysMessage,
  cashOrderAllowedDespiteBlockMessage,
  isSalesOrderSubmissionBlocked,
  parseOrderBlockOverride,
  resolveDisplayedOrderBlock,
  resolveOrderBlockStatus,
  resolveOrderSubmissionBlockStatus,
} from "../app/lib/customerOrderBlock.js";

test("blocks when avg days reaches threshold and no override", () => {
  const status = resolveOrderBlockStatus({ avgDaysToPay: ORDER_BLOCK_AVG_DAYS_THRESHOLD });
  assert.equal(status.blocked, true);
  assert.equal(status.isOverThreshold, true);
  assert.equal(status.isAdminUnblocked, false);
});

test("order submissions use the fixed 120-day threshold", () => {
  const status = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 127,
    threshold: 999,
  });
  assert.equal(status.threshold, ORDER_BLOCK_AVG_DAYS_THRESHOLD);
  assert.equal(status.blocked, true);
});

test("does not block when admin override is active", () => {
  const status = resolveOrderBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true },
  });
  assert.equal(status.blocked, false);
  assert.equal(status.isAdminUnblocked, true);
});

test("falls back to 6-month average when lifetime average is unavailable", () => {
  const status = resolveOrderBlockStatus({
    avgDaysToPay: null,
    avgDaysToPay6m: 130,
  });
  assert.equal(status.avgDaysToPay, 130);
  assert.equal(status.avgDaysToPay6m, 130);
  assert.equal(status.blocked, true);
});

test("parseOrderBlockOverride handles invalid JSON safely", () => {
  const override = parseOrderBlockOverride("{invalid");
  assert.equal(override.isUnblocked, false);
  assert.equal(override.note, "");
});

test("screen block uses the average already loaded and the override from the API", () => {
  const shown = resolveDisplayedOrderBlock({
    avgDaysToPay: 29,
    avgDaysToPay6m: 29,
    payload: {
      override: { isUnblocked: false, note: "", updatedAt: "", updatedBy: "" },
      canAdminOverride: true,
    },
  });
  assert.equal(shown.blocked, false);
  assert.equal(shown.avgDaysToPay, 29);
  assert.equal(shown.canAdminOverride, true);

  const blocked = resolveDisplayedOrderBlock({
    avgDaysToPay: 140,
    payload: { isAdminUnblocked: true },
  });
  assert.equal(blocked.blocked, false);
  assert.equal(blocked.isAdminUnblocked, true);
});

test("blocked message includes rounded average", () => {
  const message = blockedByAvgDaysMessage({ avgDaysToPay: 120.4, threshold: 120 });
  assert.match(message, /120/);
  assert.match(message, /Cash orders are still allowed/);
});

test("cash orders are allowed when the customer is over the avg-days threshold", () => {
  const credit = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 140,
    paymentType: "credit",
  });
  const cash = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 140,
    paymentType: " Cash ",
  });
  const customer = resolveOrderBlockStatus({ avgDaysToPay: 140 });

  assert.equal(credit.blocked, true);
  assert.equal(cash.blocked, false);
  assert.equal(cash.cashOrderAllowed, true);
  assert.equal(customer.blocked, true);
  assert.equal(isSalesOrderSubmissionBlocked(customer, "cash"), false);
  assert.equal(isSalesOrderSubmissionBlocked(customer, "credit"), true);
  assert.equal(isSalesOrderSubmissionBlocked(customer, ""), true);
  assert.match(cashOrderAllowedDespiteBlockMessage({ avgDaysToPay: 140.2, threshold: 120 }), /Cash order is allowed/);
});

test("admin override still allows a credit order", () => {
  const status = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true },
    paymentType: "credit",
  });
  assert.equal(status.blocked, false);
  assert.equal(status.cashOrderAllowed, false);
});
