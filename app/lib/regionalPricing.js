export const PRICING_REGIONS = ["riyadh", "dammam", "jeddah"];
export const DEFAULT_PRICING_REGION = "riyadh";
export const DEFAULT_PAYMENT_TYPE = "credit";
export const VALUE_DISCOUNT_THRESHOLD_SAR = 5000;

export const REGION_PRICE_COLUMNS = {
  riyadh: "CB",
  dammam: "CF",
  jeddah: "CJ",
};

export const SCHEME_COLUMNS = {
  valueDiscount: "CL",
  cashDiscount: "CM",
};

export function normalizePricingRegion(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "dammam") return "dammam";
  if (text === "jeddah") return "jeddah";
  return DEFAULT_PRICING_REGION;
}

export function pricingRegionLabel(value) {
  const region = normalizePricingRegion(value);
  if (region === "dammam") return "Dammam";
  if (region === "jeddah") return "Jeddah";
  return "Riyadh";
}

export function normalizePaymentType(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "cash" ? "cash" : DEFAULT_PAYMENT_TYPE;
}

function toFiniteNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDiscountPercent(rate) {
  const value = Number(rate || 0);
  if (!(value > 0)) return "—";
  return `${Number((value * 100).toFixed(2))}%`;
}

export function lookupDiscountRate(discountMap, itemCode) {
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return 0;
  return Number(discountMap?.[code] || 0);
}

export function parseDiscountRate(value) {
  const text = String(value ?? "").trim();
  if (!text || /#/.test(text)) return 0;

  const parsed = toFiniteNumber(text);
  if (!(parsed > 0)) return 0;

  if (text.includes("%") || parsed > 1) {
    return Math.min(parsed / 100, 1);
  }

  return Math.min(parsed, 1);
}

export function getPricedOrderLine({
  wholesaleRate = 0,
  quantity = 0,
  paymentType = DEFAULT_PAYMENT_TYPE,
  cashDiscountRate = 0,
  valueDiscountRate = 0,
  valueThreshold = VALUE_DISCOUNT_THRESHOLD_SAR,
} = {}) {
  const qty = Number(quantity || 0);
  const wholesale = Number(wholesaleRate || 0);
  const cashRate = Number(cashDiscountRate || 0);
  const valueRate = Number(valueDiscountRate || 0);
  const lineBeforeDiscount = qty * wholesale;

  let rate = wholesale;
  const applied = { cash: false, value: false };

  if (lineBeforeDiscount > valueThreshold && valueRate > 0) {
    rate *= (1 - valueRate);
    applied.value = true;
  }

  if (normalizePaymentType(paymentType) === "cash" && cashRate > 0) {
    rate *= (1 - cashRate);
    applied.cash = true;
  }

  const safeQty = Number.isFinite(qty) ? Math.max(qty, 0) : 0;
  return {
    wholesaleRate: wholesale,
    rate,
    quantity: safeQty,
    lineValue: safeQty * rate,
    applied,
  };
}

export function buildEffectivePriceList({
  wholesaleMap = {},
  cashDiscountMap = {},
  valueDiscountMap = {},
  paymentType = DEFAULT_PAYMENT_TYPE,
  quantities = {},
} = {}) {
  const next = {};

  Object.entries(wholesaleMap || {}).forEach(([rawCode, wholesaleRate]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return;

    const priced = getPricedOrderLine({
      wholesaleRate,
      quantity: quantities?.[code] ?? quantities?.[rawCode] ?? 0,
      paymentType,
      cashDiscountRate: cashDiscountMap?.[code] ?? cashDiscountMap?.[rawCode] ?? 0,
      valueDiscountRate: valueDiscountMap?.[code] ?? valueDiscountMap?.[rawCode] ?? 0,
    });

    next[code] = priced.rate;
  });

  return next;
}

export function resolveOrderPricingRegion({
  currentUserRegion,
  customerSalesmanCode,
  pricingRegionBySalesmanCode = {},
} = {}) {
  const salesmanCode = String(customerSalesmanCode || "").trim().toUpperCase();
  const salesmanRegion = salesmanCode
    ? pricingRegionBySalesmanCode[salesmanCode]
    : "";

  return normalizePricingRegion(salesmanRegion || currentUserRegion);
}

export function emptyRegionPriceMaps() {
  return {
    riyadh: {},
    dammam: {},
    jeddah: {},
  };
}

export function withRegionFallbacks(regionPriceMaps = {}, fallbackMap = {}) {
  const riyadh = { ...(regionPriceMaps.riyadh || fallbackMap || {}) };
  const next = {
    riyadh,
    dammam: { ...riyadh, ...(regionPriceMaps.dammam || {}) },
    jeddah: { ...riyadh, ...(regionPriceMaps.jeddah || {}) },
  };

  PRICING_REGIONS.forEach((region) => {
    Object.entries(fallbackMap || {}).forEach(([code, rate]) => {
      if (!(toFiniteNumber(next[region][code]) > 0) && toFiniteNumber(rate) > 0) {
        next[region][code] = rate;
      }
    });
  });

  return next;
}

export function regionPriceMapFor(regionPriceMaps, region, fallbackMap = {}) {
  const maps = withRegionFallbacks(regionPriceMaps, fallbackMap);
  return maps[normalizePricingRegion(region)] || maps.riyadh || fallbackMap || {};
}
