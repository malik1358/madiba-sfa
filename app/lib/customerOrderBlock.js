export const ORDER_BLOCK_AVG_DAYS_THRESHOLD = 120;
export const ORDER_BLOCK_OVERRIDE_KEY_PREFIX = "customer_order_block_override:";

function toNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeOrderBlockCustomerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function orderBlockOverrideKey(customerCode) {
  return `${ORDER_BLOCK_OVERRIDE_KEY_PREFIX}${normalizeOrderBlockCustomerCode(customerCode)}`;
}

export function parseOrderBlockOverride(rawSettingValue) {
  try {
    const parsed = JSON.parse(String(rawSettingValue || "null"));
    return {
      isUnblocked: parsed?.is_unblocked === true,
      note: String(parsed?.note || "").trim(),
      updatedAt: String(parsed?.updated_at || "").trim(),
      updatedBy: String(parsed?.updated_by || "").trim(),
    };
  } catch {
    return { isUnblocked: false, note: "", updatedAt: "", updatedBy: "" };
  }
}

export function resolveOrderBlockStatus({
  avgDaysToPay,
  avgDaysToPay6m = null,
  override = null,
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
} = {}) {
  const avgDays = toNumber(avgDaysToPay);
  const avgDays6m = toNumber(avgDaysToPay6m);
  const effectiveAvgDays = avgDays ?? avgDays6m;
  const thresholdValue = toNumber(threshold) ?? ORDER_BLOCK_AVG_DAYS_THRESHOLD;
  const isOverThreshold = effectiveAvgDays != null && effectiveAvgDays >= thresholdValue;
  const isAdminUnblocked = Boolean(override?.isUnblocked);
  const blocked = isOverThreshold && !isAdminUnblocked;

  return {
    avgDaysToPay: effectiveAvgDays,
    avgDaysToPay6m: avgDays6m,
    threshold: thresholdValue,
    isOverThreshold,
    isAdminUnblocked,
    blocked,
  };
}

export function isCashOrderPaymentType(paymentType) {
  return String(paymentType || "").trim().toLowerCase() === "cash";
}

/** Customer stays blocked for credit. A cash order is allowed without an admin override. */
export function isSalesOrderSubmissionBlocked(blockStatus, paymentType = "credit") {
  if (!blockStatus?.blocked) return false;
  return !isCashOrderPaymentType(paymentType);
}

export function resolveOrderSubmissionBlockStatus({
  avgDaysToPay,
  avgDaysToPay6m = null,
  override = null,
  paymentType = "credit",
} = {}) {
  const status = resolveOrderBlockStatus({
    avgDaysToPay,
    avgDaysToPay6m,
    override,
    threshold: ORDER_BLOCK_AVG_DAYS_THRESHOLD,
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
    };
  }
  return {
    isUnblocked: payload.isAdminUnblocked === true,
    note: "",
    updatedAt: "",
    updatedBy: "",
  };
}

/** Screen badge: avg days already on the page, plus the admin override from the API. */
export function resolveDisplayedOrderBlock({
  avgDaysToPay = null,
  avgDaysToPay6m = null,
  payload = null,
} = {}) {
  if (!payload) return null;
  const override = orderBlockOverrideFromPayload(payload);
  return {
    ...resolveOrderBlockStatus({
      avgDaysToPay: avgDaysToPay ?? payload.avgDaysToPay ?? null,
      avgDaysToPay6m: avgDaysToPay6m ?? payload.avgDaysToPay6m ?? null,
      override,
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
  return `Sales order is blocked because this customer average days to pay ${clause}. Cash orders are still allowed.`;
}

export function cashOrderAllowedDespiteBlockMessage({
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  avgDaysToPay = null,
} = {}) {
  const clause = avgDaysBlockClause({ threshold, avgDaysToPay });
  return `Cash order is allowed. Credit orders stay blocked because this customer average days to pay ${clause}.`;
}
