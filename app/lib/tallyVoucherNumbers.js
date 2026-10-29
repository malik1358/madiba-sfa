import {
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_PRICING_REGION,
  normalizePaymentType,
  normalizePricingRegion,
} from "./regionalPricing.js";

export const TALLY_VOUCHER_PAD = 4;

export const TALLY_VOUCHER_SERIES = Object.freeze({
  dammam_cash: { seriesKey: "dammam_cash", prefix: "DC", seedLast: 67 },
  dammam_credit: { seriesKey: "dammam_credit", prefix: "DNFD", seedLast: 133 },
  jeddah_cash: { seriesKey: "jeddah_cash", prefix: "JC", seedLast: 1 },
  jeddah_credit: { seriesKey: "jeddah_credit", prefix: "JNFD", seedLast: 10 },
  riyadh_cash: { seriesKey: "riyadh_cash", prefix: "RC", seedLast: 142 },
  riyadh_credit: { seriesKey: "riyadh_credit", prefix: "RNFD", seedLast: 637 },
});

export function resolveTallyVoucherSeries({
  pricingRegion = DEFAULT_PRICING_REGION,
  paymentType = DEFAULT_PAYMENT_TYPE,
} = {}) {
  const region = normalizePricingRegion(pricingRegion);
  const payment = normalizePaymentType(paymentType);
  const seriesKey = `${region}_${payment}`;
  const series = TALLY_VOUCHER_SERIES[seriesKey];
  if (!series) {
    throw new Error(`No Tally voucher series for ${region} ${payment}.`);
  }
  return series;
}

export function formatTallyVoucherNumber(prefix, number, pad = TALLY_VOUCHER_PAD) {
  const n = Number(number);
  if (!Number.isFinite(n) || n < 0) return "";
  const cleanPrefix = String(prefix || "").trim().replace(/\/+$/, "");
  if (!cleanPrefix) return "";
  return `${cleanPrefix}/${String(Math.trunc(n)).padStart(Math.max(1, Number(pad) || TALLY_VOUCHER_PAD), "0")}`;
}

export function nextTallyVoucherNumber(series, lastNumber) {
  const setup = typeof series === "string" ? TALLY_VOUCHER_SERIES[series] : series;
  if (!setup?.prefix) return "";
  const last = Number.isFinite(Number(lastNumber)) ? Number(lastNumber) : Number(setup.seedLast || 0);
  return formatTallyVoucherNumber(setup.prefix, last + 1);
}

/**
 * Reuse the order's saved voucher, or allocate the next number for its city + payment.
 */
export async function allocateTallyVoucherNumberForOrder(admin, {
  orderId,
  pricingRegion = DEFAULT_PRICING_REGION,
  paymentType = DEFAULT_PAYMENT_TYPE,
} = {}) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("A saved order is required before a Tally voucher number can be assigned.");
  }

  const series = resolveTallyVoucherSeries({ pricingRegion, paymentType });
  const { data, error } = await admin.rpc("allocate_tally_voucher_number", {
    p_order_id: id,
    p_series_key: series.seriesKey,
  });

  if (error) throw error;
  const voucherNumber = String(data || "").trim();
  if (!voucherNumber) {
    throw new Error("Unable to allocate a Tally voucher number for this order.");
  }

  return {
    voucherNumber,
    seriesKey: series.seriesKey,
    prefix: series.prefix,
  };
}
