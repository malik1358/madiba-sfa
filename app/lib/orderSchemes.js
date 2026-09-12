import { getRelatedItemCodes } from "./itemCodeAliases.js";

export const ORDER_SCHEMES_CACHE_KEY = "order_schemes";
export const SCHEME_TYPE_CONDITIONAL_UNIT = "conditional_unit_discount";

export const DEFAULT_ORDER_SCHEMES = [
  {
    id: "default-a005425-mix-40",
    name: "A005425 + mix 40 CTN",
    active: true,
    type: SCHEME_TYPE_CONDITIONAL_UNIT,
    rewardItemCode: "A005425",
    rewardEveryQty: 40,
    applyTo: "complete_lots",
    unitDiscountSar: 1.83,
    qualifierItemCodes: ["A004224", "A004225", "A004226", "A004227"],
    qualifierMinQty: 1,
    qualifierMode: "any",
    // Mix carton deal is already steep; do not stack cash % on top.
    excludeCashDiscount: true,
  },
];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseItemCodeList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeCode).filter(Boolean))];
  }

  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map(normalizeCode)
      .filter(Boolean),
  )];
}

function parseExcludeCashDiscount(source, rewardItemCode = "") {
  const raw = source?.excludeCashDiscount ?? source?.exclude_cash_discount;
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  // Built-in mix deal and legacy rows without the flag must not stack cash %.
  return rewardItemCode === "A005425" || String(source?.id || "").includes("a005425-mix");
}

export function createEmptySchemeDraft() {
  return {
    id: "",
    name: "",
    active: true,
    type: SCHEME_TYPE_CONDITIONAL_UNIT,
    rewardItemCode: "",
    rewardEveryQty: 40,
    applyTo: "complete_lots",
    unitDiscountSar: 0,
    qualifierItemCodes: [],
    qualifierMinQty: 1,
    qualifierMode: "any",
    excludeCashDiscount: true,
  };
}

export function normalizeOrderScheme(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rewardItemCode = normalizeCode(source.rewardItemCode || source.reward_item_code);
  const unitDiscountSar = toPositiveNumber(source.unitDiscountSar ?? source.unit_discount_sar, 0);
  const rewardEveryQty = toPositiveNumber(source.rewardEveryQty ?? source.reward_every_qty, 1);
  const qualifierMinQty = toPositiveNumber(source.qualifierMinQty ?? source.qualifier_min_qty, 1);
  const applyTo = String(source.applyTo || source.apply_to || "complete_lots").trim().toLowerCase() === "all_units"
    ? "all_units"
    : "complete_lots";
  const qualifierMode = String(source.qualifierMode || source.qualifier_mode || "any").trim().toLowerCase() === "all"
    ? "all"
    : "any";
  const id = String(source.id || "").trim() || `scheme-${index + 1}-${rewardItemCode || "item"}`;

  if (!rewardItemCode || !(unitDiscountSar > 0)) return null;

  return {
    id,
    name: String(source.name || "").trim() || `${rewardItemCode} scheme`,
    active: source.active !== false,
    type: SCHEME_TYPE_CONDITIONAL_UNIT,
    rewardItemCode,
    rewardEveryQty,
    applyTo,
    unitDiscountSar,
    qualifierItemCodes: parseItemCodeList(source.qualifierItemCodes || source.qualifier_item_codes),
    qualifierMinQty,
    qualifierMode,
    excludeCashDiscount: parseExcludeCashDiscount(source, rewardItemCode),
  };
}

export function normalizeOrderSchemes(rawSchemes) {
  return (Array.isArray(rawSchemes) ? rawSchemes : [])
    .map((scheme, index) => normalizeOrderScheme(scheme, index))
    .filter(Boolean);
}

export function resolveStoredOrderSchemes(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (Array.isArray(source.schemes)) {
    return normalizeOrderSchemes(source.schemes);
  }
  if (Array.isArray(source)) {
    return normalizeOrderSchemes(source);
  }
  return normalizeOrderSchemes(DEFAULT_ORDER_SCHEMES);
}

export function quantityMapFromValues(quantities = {}) {
  const next = {};
  Object.entries(quantities || {}).forEach(([key, value]) => {
    const code = normalizeCode(key);
    if (!code) return;
    next[code] = toNonNegativeNumber(value, 0) + Number(next[code] || 0);
  });
  return next;
}

export function quantityMapFromLines(lines = []) {
  const next = {};
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const code = normalizeCode(line?.item_code);
    if (!code) return;
    next[code] = toNonNegativeNumber(line?.quantity ?? line?.order_quantity, 0) + Number(next[code] || 0);
  });
  return next;
}

function qualifierSatisfied(qtyMap, scheme) {
  const codes = scheme.qualifierItemCodes || [];
  if (codes.length === 0) return true;
  const minQty = scheme.qualifierMinQty || 1;
  if (scheme.qualifierMode === "all") {
    return codes.every((code) => Number(qtyMap[code] || 0) >= minQty);
  }
  return codes.some((code) => Number(qtyMap[code] || 0) >= minQty);
}

function discountedRewardQty(rewardQty, everyQty, applyTo) {
  if (!(rewardQty > 0) || !(everyQty > 0) || rewardQty < everyQty) return 0;
  if (applyTo === "all_units") return rewardQty;
  return Math.floor(rewardQty / everyQty) * everyQty;
}

export function emptySchemeApplication() {
  return {
    unitDiscount: 0,
    discountedQty: 0,
    schemeAmount: 0,
    schemeNames: [],
    schemeIds: [],
    excludeCashDiscount: false,
  };
}

export function evaluateOrderSchemes(quantities = {}, schemes = []) {
  const qtyMap = Array.isArray(quantities)
    ? quantityMapFromLines(quantities)
    : quantityMapFromValues(quantities);
  const applications = {};

  normalizeOrderSchemes(schemes).forEach((scheme) => {
    if (!scheme.active) return;
    if (!qualifierSatisfied(qtyMap, scheme)) return;

    const familyCodes = getRelatedItemCodes(scheme.rewardItemCode);
    const rewardQty = familyCodes.reduce((sum, code) => sum + Number(qtyMap[code] || 0), 0);
    const discountedQty = discountedRewardQty(rewardQty, scheme.rewardEveryQty, scheme.applyTo);
    if (!(discountedQty > 0)) return;

    const familyAmount = discountedQty * scheme.unitDiscountSar;
    familyCodes.forEach((code) => {
      const codeQty = Number(qtyMap[code] || 0);
      if (!(codeQty > 0)) return;
      const shareAmount = rewardQty > 0 ? familyAmount * (codeQty / rewardQty) : 0;
      const current = applications[code] || emptySchemeApplication();
      const nextAmount = current.schemeAmount + shareAmount;
      applications[code] = {
        unitDiscount: codeQty > 0 ? nextAmount / codeQty : 0,
        discountedQty: codeQty,
        schemeAmount: nextAmount,
        schemeNames: [...current.schemeNames, scheme.name],
        schemeIds: [...current.schemeIds, scheme.id],
        excludeCashDiscount: current.excludeCashDiscount || scheme.excludeCashDiscount === true,
      };
    });
  });

  return applications;
}

export function lookupSchemeApplication(applications, itemCode) {
  const code = normalizeCode(itemCode);
  return applications?.[code] || emptySchemeApplication();
}

export function formatSchemeDetail(application) {
  const amount = Number(application?.schemeAmount || 0);
  if (!(amount > 0)) return "—";
  const names = (application?.schemeNames || []).filter(Boolean);
  const prefix = names.length ? `${names.join(", ")} · ` : "";
  return `${prefix}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

export function describeOrderScheme(scheme) {
  const normalized = normalizeOrderScheme(scheme);
  if (!normalized) return "";
  const qualifier = normalized.qualifierItemCodes.length
    ? `${normalized.qualifierMode === "all" ? "all of" : "any of"} ${normalized.qualifierItemCodes.join(", ")} (≥ ${normalized.qualifierMinQty} CTN)`
    : "no extra item";
  const applyLabel = normalized.applyTo === "all_units"
    ? `all ${normalized.rewardItemCode} cartons once ${normalized.rewardEveryQty} CTN is reached`
    : `each complete ${normalized.rewardEveryQty} CTN of ${normalized.rewardItemCode}`;
  const cashRule = normalized.excludeCashDiscount
    ? " Does not combine with cash discount."
    : "";
  return `On ${applyLabel}, if the order includes ${qualifier}, take ${normalized.unitDiscountSar} SAR off each discounted carton.${cashRule}`;
}
