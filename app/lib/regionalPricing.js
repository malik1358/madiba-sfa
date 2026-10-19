export const PRICING_REGIONS = ["riyadh", "dammam", "jeddah"];
export const DEFAULT_PRICING_REGION = "riyadh";
export const DEFAULT_PAYMENT_TYPE = "credit";
export const VALUE_DISCOUNT_THRESHOLD_SAR = 5000;
export const VAT_RATE = 0.15;

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

export function formatAppliedDiscount(rate, applied) {
  const label = formatDiscountPercent(rate);
  if (label === "—") return "—";
  return applied ? `${label} applied` : label;
}

export function formatMoneyAmount(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDiscountDetail(rate, applied, amount) {
  const label = formatDiscountPercent(rate);
  if (label === "—") return "—";
  if (!applied) return label;
  return `${label} applied · ${formatMoneyAmount(amount)}`;
}

export function lookupDiscountRate(discountMap, itemCode) {
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return 0;
  return Number(discountMap?.[code] ?? discountMap?.[itemCode] ?? 0);
}

export function lookupQuantity(quantities, itemCode) {
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return 0;
  if (quantities?.[code] != null) return Number(quantities[code] || 0);
  const match = Object.entries(quantities || {}).find(([key]) => String(key || "").trim().toUpperCase() === code);
  return match ? Number(match[1] || 0) : 0;
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
  schemeUnitDiscount = 0,
  schemeDiscountedQty = 0,
} = {}) {
  const qty = Number(quantity || 0);
  const wholesale = Number(wholesaleRate || 0);
  const cashRate = Number(cashDiscountRate || 0);
  const valueRate = Number(valueDiscountRate || 0);
  const lineBeforeDiscount = qty * wholesale;

  let rate = wholesale;
  const applied = { cash: false, value: false, scheme: false };

  if (lineBeforeDiscount >= valueThreshold && valueRate > 0) {
    rate *= (1 - valueRate);
    applied.value = true;
  }

  if (normalizePaymentType(paymentType) === "cash" && cashRate > 0) {
    rate *= (1 - cashRate);
    applied.cash = true;
  }

  const safeQty = Number.isFinite(qty) ? Math.max(qty, 0) : 0;
  const wholesaleLineValue = safeQty * wholesale;
  const schemeQty = Math.min(Math.max(Number(schemeDiscountedQty || 0), 0), safeQty);
  const schemeRate = Math.max(Number(schemeUnitDiscount || 0), 0);
  const schemeDiscountAmount = schemeQty * schemeRate;
  const lineValue = Math.max(0, (safeQty * rate) - schemeDiscountAmount);
  if (schemeDiscountAmount > 0) {
    applied.scheme = true;
    rate = safeQty > 0 ? lineValue / safeQty : rate;
  }
  const valueDiscountAmount = applied.value ? wholesaleLineValue * valueRate : 0;
  const cashDiscountAmount = applied.cash ? (wholesaleLineValue - valueDiscountAmount) * cashRate : 0;
  const vatAmount = lineValue * VAT_RATE;

  return {
    wholesaleRate: wholesale,
    rate,
    quantity: safeQty,
    wholesaleLineValue,
    valueDiscountAmount,
    cashDiscountAmount,
    schemeDiscountAmount,
    lineValue,
    vatAmount,
    lineTotalInclVat: lineValue + vatAmount,
    applied,
  };
}

export function summarizePricedLines(lines = []) {
  const empty = {
    wholesaleTotal: 0,
    cashDiscountTotal: 0,
    valueDiscountTotal: 0,
    schemeDiscountTotal: 0,
    amountExclVat: 0,
    vatAmount: 0,
    amountInclVat: 0,
  };

  return (Array.isArray(lines) ? lines : []).reduce((totals, line) => {
    const wholesaleTotal = totals.wholesaleTotal + Number(line.wholesaleLineValue || 0);
    const cashDiscountTotal = totals.cashDiscountTotal + Number(line.cashDiscountAmount || 0);
    const valueDiscountTotal = totals.valueDiscountTotal + Number(line.valueDiscountAmount || 0);
    const schemeDiscountTotal = totals.schemeDiscountTotal + Number(line.schemeDiscountAmount || 0);
    const amountExclVat = totals.amountExclVat + Number(line.lineValue || line.lineTotal || 0);
    const vatAmount = amountExclVat * VAT_RATE;
    return {
      wholesaleTotal,
      cashDiscountTotal,
      valueDiscountTotal,
      schemeDiscountTotal,
      amountExclVat,
      vatAmount,
      amountInclVat: amountExclVat + vatAmount,
    };
  }, empty);
}

export function buildEffectivePriceList({
  wholesaleMap = {},
  cashDiscountMap = {},
  valueDiscountMap = {},
  paymentType = DEFAULT_PAYMENT_TYPE,
  quantities = {},
  schemeApplications = {},
} = {}) {
  const next = {};

  Object.entries(wholesaleMap || {}).forEach(([rawCode, wholesaleRate]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return;

    const scheme = schemeApplications?.[code] || schemeApplications?.[rawCode] || {};
    const priced = getPricedOrderLine({
      wholesaleRate,
      quantity: lookupQuantity(quantities, code) || lookupQuantity(quantities, rawCode),
      paymentType,
      cashDiscountRate: lookupDiscountRate(cashDiscountMap, code) || lookupDiscountRate(cashDiscountMap, rawCode),
      valueDiscountRate: lookupDiscountRate(valueDiscountMap, code) || lookupDiscountRate(valueDiscountMap, rawCode),
      schemeUnitDiscount: Number(scheme.unitDiscount || 0),
      schemeDiscountedQty: Number(scheme.discountedQty || 0),
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

  return normalizePricingRegion(currentUserRegion || salesmanRegion);
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
