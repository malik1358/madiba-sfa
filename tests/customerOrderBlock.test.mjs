import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  blockedByAvgDaysMessage,
  buildOrderBlockOverrideSettingValue,
  cashOrderAllowedDespiteBlockMessage,
  isOrderBlockOverrideActive,
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

test("does not block when admin override is active for today", () => {
  const status = resolveOrderBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    todayKsa: "2026-10-25",
  });
  assert.equal(status.blocked, false);
  assert.equal(status.isAdminUnblocked, true);
});

test("admin override expires on the next KSA day", () => {
  const sameDay = resolveOrderBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    todayKsa: "2026-10-25",
  });
  const nextDay = resolveOrderBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    todayKsa: "2026-10-26",
  });
  assert.equal(sameDay.blocked, false);
  assert.equal(nextDay.blocked, true);
  assert.equal(nextDay.isAdminUnblocked, false);
  assert.equal(isOrderBlockOverrideActive({
    isUnblocked: true,
    unblockedOnKsaDate: "2026-10-25",
  }, "2026-10-26"), false);
});

test("parseOrderBlockOverride treats yesterday's stored unblock as expired", () => {
  const stored = JSON.stringify({
    customer_code: "1257C",
    is_unblocked: true,
    note: "",
    updated_at: "2026-10-25T10:00:00.000Z",
    updated_by: "admin",
    unblocked_on_ksa_date: "2026-10-25",
  });
  const today = parseOrderBlockOverride(stored, "2026-10-25");
  const tomorrow = parseOrderBlockOverride(stored, "2026-10-26");
  assert.equal(today.isUnblocked, true);
  assert.equal(today.unblockedOnKsaDate, "2026-10-25");
  assert.equal(today.expiresNextKsaDay, true);
  assert.equal(tomorrow.isUnblocked, false);
  assert.equal(tomorrow.expiresNextKsaDay, true);
});

test("parseOrderBlockOverride falls back to updated_at KSA day when date field is missing", () => {
  // 2026-10-25 22:00 UTC is still 2026-10-26 01:00 in Asia/Riyadh.
  const stored = JSON.stringify({
    is_unblocked: true,
    updated_at: "2026-10-25T22:00:00.000Z",
    updated_by: "admin",
  });
  const onGrantDay = parseOrderBlockOverride(stored, "2026-10-26");
  const dayAfter = parseOrderBlockOverride(stored, "2026-10-27");
  assert.equal(onGrantDay.unblockedOnKsaDate, "2026-10-26");
  assert.equal(onGrantDay.isUnblocked, true);
  assert.equal(dayAfter.isUnblocked, false);
});

test("buildOrderBlockOverrideSettingValue stores the grant KSA day", () => {
  const value = buildOrderBlockOverrideSettingValue({
    customerCode: "1257c",
    note: "one day only",
    updatedBy: "user-1",
    updatedAt: "2026-10-25T08:00:00.000Z",
    todayKsa: "2026-10-25",
  });
  assert.equal(value.customer_code, "1257C");
  assert.equal(value.is_unblocked, true);
  assert.equal(value.unblocked_on_ksa_date, "2026-10-25");
  assert.equal(value.note, "one day only");
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
    payload: { isAdminUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    todayKsa: "2026-10-25",
  });
  assert.equal(blocked.blocked, false);
  assert.equal(blocked.isAdminUnblocked, true);
});

test("blocked message includes rounded average and mentions draft", () => {
  const message = blockedByAvgDaysMessage({ avgDaysToPay: 120.4, threshold: 120 });
  assert.match(message, /120/);
  assert.match(message, /Draft and submit are blocked/);
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
  assert.match(cashOrderAllowedDespiteBlockMessage({ avgDaysToPay: 140.2, threshold: 120 }), /Cash draft and submit are allowed/);
});

test("admin override still allows a credit order on the grant day only", () => {
  const status = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    paymentType: "credit",
    todayKsa: "2026-10-25",
  });
  assert.equal(status.blocked, false);
  assert.equal(status.cashOrderAllowed, false);

  const nextDay = resolveOrderSubmissionBlockStatus({
    avgDaysToPay: 150,
    override: { isUnblocked: true, unblockedOnKsaDate: "2026-10-25" },
    paymentType: "credit",
    todayKsa: "2026-10-26",
  });
  assert.equal(nextDay.blocked, true);
});
