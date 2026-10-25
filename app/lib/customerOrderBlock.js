import { getKsaDateString } from "./workdayActivity.js";

export const ORDER_BLOCK_AVG_DAYS_THRESHOLD = 120;
export const ORDER_BLOCK_OVERRIDE_KEY_PREFIX = "customer_order_block_override:";

function toNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKsaDateString(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  return raw;
}

export function normalizeOrderBlockCustomerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function orderBlockOverrideKey(customerCode) {
  return `${ORDER_BLOCK_OVERRIDE_KEY_PREFIX}${normalizeOrderBlockCustomerCode(customerCode)}`;
}

/** Resolve the KSA calendar day an admin unblock applies to. */
export function resolveOrderBlockUnblockedOnKsaDate(raw = {}) {
  const explicit = normalizeKsaDateString(raw.unblocked_on_ksa_date || raw.unblockedOnKsaDate);
  if (explicit) return explicit;
  const updatedAt = String(raw.updated_at || raw.updatedAt || "").trim();
  if (!updatedAt) return "";
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) return "";
  return getKsaDateString(new Date(parsed));
}

/**
 * Admin unblock lasts only for the KSA day it was granted.
 * Next KSA day the automatic avg-days block applies again.
 * A payload that already carries the effective `isUnblocked` flag and has no
 * KSA date (for example after `parseOrderBlockOverride`) is trusted as-is.
 */
export function isOrderBlockOverrideActive(override = null, todayKsa = getKsaDateString()) {
  if (!override?.isUnblocked) return false;
  const unblockedOn = normalizeKsaDateString(
    override.unblockedOnKsaDate || resolveOrderBlockUnblockedOnKsaDate(override),
  );
  const today = normalizeKsaDateString(todayKsa) || getKsaDateString();
  if (!unblockedOn) return true;
  return unblockedOn === today;
}

export function parseOrderBlockOverride(rawSettingValue, todayKsa = getKsaDateString()) {
  try {
    const parsed = JSON.parse(String(rawSettingValue || "null"));
    const unblockedOnKsaDate = resolveOrderBlockUnblockedOnKsaDate(parsed || {});
    const storedUnblocked = parsed?.is_unblocked === true;
    const today = normalizeKsaDateString(todayKsa) || getKsaDateString();
    // Stored overrides must name a KSA day; otherwise they are treated as expired.
    const active = storedUnblocked && Boolean(unblockedOnKsaDate) && unblockedOnKsaDate === today;
    return {
      isUnblocked: active,
      note: String(parsed?.note || "").trim(),
      updatedAt: String(parsed?.updated_at || "").trim(),
      updatedBy: String(parsed?.updated_by || "").trim(),
      unblockedOnKsaDate,
      expiresNextKsaDay: storedUnblocked,
    };
  } catch {
    return {
      isUnblocked: false,
      note: "",
      updatedAt: "",
      updatedBy: "",
      unblockedOnKsaDate: "",
      expiresNextKsaDay: false,
    };
  }
}

export function resolveOrderBlockStatus({
  avgDaysToPay,
  avgDaysToPay6m = null,
  override = null,
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  todayKsa = getKsaDateString(),
} = {}) {
  const avgDays = toNumber(avgDaysToPay);
  const avgDays6m = toNumber(avgDaysToPay6m);
  const effectiveAvgDays = avgDays ?? avgDays6m;
  const thresholdValue = toNumber(threshold) ?? ORDER_BLOCK_AVG_DAYS_THRESHOLD;
  const isOverThreshold = effectiveAvgDays != null && effectiveAvgDays >= thresholdValue;
  const isAdminUnblocked = isOrderBlockOverrideActive(override, todayKsa);
  const blocked = isOverThreshold && !isAdminUnblocked;

  return {
    avgDaysToPay: effectiveAvgDays,
    avgDaysToPay6m: avgDays6m,
    threshold: thresholdValue,
    isOverThreshold,
    isAdminUnblocked,
    unblockedOnKsaDate: normalizeKsaDateString(
      override?.unblockedOnKsaDate || resolveOrderBlockUnblockedOnKsaDate(override || {}),
    ),
    blocked,
  };
}

export function isCashOrderPaymentType(paymentType) {
  return String(paymentType || "").trim().toLowerCase() === "cash";
}

/** Customer stays blocked for credit draft/submit. A cash order is allowed without an admin override. */
export function isSalesOrderSubmissionBlocked(blockStatus, paymentType = "credit") {
  if (!blockStatus?.blocked) return false;
  return !isCashOrderPaymentType(paymentType);
}

export function resolveOrderSubmissionBlockStatus({
  avgDaysToPay,
  avgDaysToPay6m = null,
  override = null,
  paymentType = "credit",
  todayKsa = getKsaDateString(),
} = {}) {
  const status = resolveOrderBlockStatus({
    avgDaysToPay,
    avgDaysToPay6m,
    override,
    threshold: ORDER_BLOCK_AVG_DAYS_THRESHOLD,
    todayKsa,
  });
  const cashOrder = isCashOrderPaymentType(paymentType);
  return {
    ...status,
    paymentType: cashOrder ? "cash" : "credit",
    cashOrderAllowed: cashOrder && status.blocked,
    blocked: status.blocked && !cashOrder,
  };
}

export function orderBlockOverrideFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.override && typeof payload.override === "object") {
    return {
      isUnblocked: payload.override.isUnblocked === true,
      note: String(payload.override.note || "").trim(),
      updatedAt: String(payload.override.updatedAt || "").trim(),
      updatedBy: String(payload.override.updatedBy || "").trim(),
      unblockedOnKsaDate: normalizeKsaDateString(
        payload.override.unblockedOnKsaDate || resolveOrderBlockUnblockedOnKsaDate(payload.override),
      ),
    };
  }
  return {
    isUnblocked: payload.isAdminUnblocked === true,
    note: "",
    updatedAt: "",
    updatedBy: "",
    unblockedOnKsaDate: normalizeKsaDateString(
      payload.unblockedOnKsaDate || resolveOrderBlockUnblockedOnKsaDate(payload),
    ),
  };
}

/** Screen badge: avg days already on the page, plus the admin override from the API. */
export function resolveDisplayedOrderBlock({
  avgDaysToPay = null,
  avgDaysToPay6m = null,
  payload = null,
  todayKsa = getKsaDateString(),
} = {}) {
  if (!payload) return null;
  const override = orderBlockOverrideFromPayload(payload);
  return {
    ...resolveOrderBlockStatus({
      avgDaysToPay: avgDaysToPay ?? payload.avgDaysToPay ?? null,
      avgDaysToPay6m: avgDaysToPay6m ?? payload.avgDaysToPay6m ?? null,
      override,
      todayKsa,
    }),
    override,
    canAdminOverride: payload.canAdminOverride === true,
  };
}

function avgDaysBlockClause({
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  avgDaysToPay = null,
} = {}) {
  const avg = toNumber(avgDaysToPay);
  if (avg == null) return `reached ${threshold}`;
  return `is ${Math.round(avg)} (threshold ${threshold})`;
}

export function blockedByAvgDaysMessage({
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  avgDaysToPay = null,
} = {}) {
  const clause = avgDaysBlockClause({ threshold, avgDaysToPay });
  return `Draft and submit are blocked because this customer average days to pay ${clause}. Cash orders are still allowed.`;
}

export function cashOrderAllowedDespiteBlockMessage({
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  avgDaysToPay = null,
} = {}) {
  const clause = avgDaysBlockClause({ threshold, avgDaysToPay });
  return `Cash draft and submit are allowed. Credit stays blocked because this customer average days to pay ${clause}.`;
}

export function buildOrderBlockOverrideSettingValue({
  customerCode,
  note = "",
  updatedBy = "",
  updatedAt = new Date().toISOString(),
  todayKsa = getKsaDateString(),
} = {}) {
  return {
    customer_code: normalizeOrderBlockCustomerCode(customerCode),
    is_unblocked: true,
    note: String(note || "").trim(),
    updated_at: String(updatedAt || new Date().toISOString()),
    updated_by: String(updatedBy || "").trim(),
    unblocked_on_ksa_date: normalizeKsaDateString(todayKsa) || getKsaDateString(),
  };
}
