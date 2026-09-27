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

export function blockedByAvgDaysMessage({
  threshold = ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  avgDaysToPay = null,
} = {}) {
  const avg = toNumber(avgDaysToPay);
  if (avg == null) {
    return `Sales order is blocked because this customer average days to pay reached ${threshold}.`;
  }
  return `Sales order is blocked because this customer average days to pay is ${Math.round(avg)} (threshold ${threshold}).`;
}
