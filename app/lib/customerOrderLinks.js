import { isCatalogueProductCode, hasCataloguePrice, normalizeCatalogueCode } from "./productCatalogue.js";
import {
  filterItemsWithPositiveCountryEodStock,
  hasPositiveCountryEodStockQty,
  normalizeEodStockAvailability,
} from "./eodStock.js";
import { lookupMasterUnitConv } from "./masterUnitQty.js";
import { lookupPositiveRate } from "./itemCodeAliases.js";

export const CUSTOMER_ORDER_LINK_TTL_HOURS = 36;
export const CUSTOMER_ORDER_LINK_PATH_PREFIX = "/order/";

export function isPublicCustomerOrderPath(pathname) {
  const path = String(pathname || "").trim().split("?")[0];
  return path === "/order" || path.startsWith("/order/");
}

export function normalizeOrderLinkToken(value) {
  return String(value || "").trim();
}

export function isValidOrderLinkTokenShape(token) {
  const text = normalizeOrderLinkToken(token);
  return text.length >= 24 && text.length <= 128 && /^[A-Za-z0-9_-]+$/.test(text);
}

export function customerOrderLinkExpiresAt(createdAt = new Date(), ttlHours = CUSTOMER_ORDER_LINK_TTL_HOURS) {
  const base = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt || ""));
  const start = Number.isFinite(base) ? base : Date.now();
  const hours = Math.max(1, Number(ttlHours) || CUSTOMER_ORDER_LINK_TTL_HOURS);
  return new Date(start + hours * 3600 * 1000);
}

export function isCustomerOrderLinkExpired(link, now = new Date()) {
  const expiresAt = Date.parse(String(link?.expires_at || link?.expiresAt || ""));
  if (!Number.isFinite(expiresAt)) return true;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  return !Number.isFinite(nowMs) || nowMs >= expiresAt;
}

export function buildCustomerOrderLinkPath(token) {
  const safe = normalizeOrderLinkToken(token);
  if (!safe) return "";
  return `${CUSTOMER_ORDER_LINK_PATH_PREFIX}${encodeURIComponent(safe)}`;
}

export function buildCustomerOrderLinkUrl(origin, token) {
  const base = String(origin || "").trim().replace(/\/+$/, "");
  const path = buildCustomerOrderLinkPath(token);
  if (!base || !path) return "";
  return `${base}${path}`;
}

/**
 * Customer-facing catalog: priced catalogue codes that are in stock.
 * When no EOD snapshot is loaded, return an empty list (do not dump the full price book).
 */
export function buildCustomerFacingCatalogItems({
  sheetItems = [],
  regionPriceMap = {},
  eodStock = null,
  masterUnits = null,
} = {}) {
  const stock = normalizeEodStockAvailability(eodStock);
  if (!stock.active) return [];

  const units = masterUnits || stock.masterUnits || null;
  const priced = (Array.isArray(sheetItems) ? sheetItems : [])
    .map((item) => {
      const code = normalizeCatalogueCode(item?.item_code);
      if (!code || !isCatalogueProductCode(code)) return null;
      const price = lookupPositiveRate(regionPriceMap, code, item?.rate ?? item?.price ?? 0);
      if (!hasCataloguePrice(price)) return null;
      if (!hasPositiveCountryEodStockQty(stock, code)) return null;
      const master = lookupMasterUnitConv(units, code);
      return {
        item_code: code,
        item_name: String(item?.item_name || code).trim() || code,
        category: String(item?.category || "").trim(),
        price,
        master_unit: String(master?.masterUom || "").trim(),
      };
    })
    .filter(Boolean);

  const inStock = filterItemsWithPositiveCountryEodStock(priced, stock);
  inStock.sort((a, b) => {
    const cat = String(a.category || "").localeCompare(String(b.category || ""), undefined, { sensitivity: "base" });
    if (cat !== 0) return cat;
    return String(a.item_name || "").localeCompare(String(b.item_name || ""), undefined, { sensitivity: "base" });
  });
  return inStock;
}

/** Strip fields that must never reach the customer browser. */
export function requireCustomerOrderLinkPricing({ pricingRegion, pricingType } = {}) {
  const region = String(pricingRegion || "").trim().toLowerCase();
  const type = String(pricingType || "").trim().toLowerCase();
  if (!["riyadh", "dammam", "jeddah"].includes(region)) {
    return { ok: false, error: "Select which city price to send (Riyadh, Dammam, or Jeddah)." };
  }
  if (!["wholesale", "retail"].includes(type)) {
    return { ok: false, error: "Select wholesale or retail for this order link." };
  }
  return { ok: true, pricingRegion: region, pricingType: type };
}

export function sanitizeCustomerOrderLinkCatalogPayload(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items.map((item) => ({
    item_code: String(item.item_code || "").trim().toUpperCase(),
    item_name: String(item.item_name || "").trim(),
    category: String(item.category || "").trim(),
    price: Number(item.price) || 0,
    master_unit: String(item.master_unit || "").trim(),
    packing: String(item.packing || "").trim(),
    photos: Array.isArray(item.photos)
      ? item.photos
        .map((photo) => ({ id: String(photo?.id || "").trim() }))
        .filter((photo) => photo.id)
      : [],
  })).filter((item) => item.item_code && item.price > 0) : [];

  const schemes = Array.isArray(payload.schemes)
    ? payload.schemes
      .filter((scheme) => scheme && scheme.active !== false)
      .map((scheme) => ({
        id: String(scheme.id || "").trim(),
        name: String(scheme.name || "").trim(),
        rewardItemCode: String(scheme.rewardItemCode || "").trim().toUpperCase(),
        rewardEveryQty: Number(scheme.rewardEveryQty) || 0,
        unitDiscountSar: Number(scheme.unitDiscountSar) || 0,
        qualifierItemCodes: Array.isArray(scheme.qualifierItemCodes)
          ? scheme.qualifierItemCodes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)
          : [],
        qualifierMinQty: Number(scheme.qualifierMinQty) || 0,
        excludeCashDiscount: scheme.excludeCashDiscount === true,
      }))
      .filter((scheme) => scheme.id && scheme.rewardItemCode)
    : [];

  return {
    customerCode: String(payload.customerCode || "").trim(),
    customerName: String(payload.customerName || "").trim(),
    isProspect: Boolean(payload.isProspect),
    paymentType: String(payload.paymentType || "credit").trim().toLowerCase() === "cash" ? "cash" : "credit",
    pricingRegion: ["riyadh", "dammam", "jeddah"].includes(String(payload.pricingRegion || "").trim().toLowerCase())
      ? String(payload.pricingRegion).trim().toLowerCase()
      : "riyadh",
    pricingType: String(payload.pricingType || "wholesale").trim().toLowerCase() === "retail" ? "retail" : "wholesale",
    expiresAt: String(payload.expiresAt || "").trim(),
    submittedOrder: payload.submittedOrder && typeof payload.submittedOrder === "object"
      ? {
        orderId: Number(payload.submittedOrder.orderId) || null,
        orderNumber: String(payload.submittedOrder.orderNumber || "").trim(),
        submittedAt: String(payload.submittedOrder.submittedAt || "").trim(),
        totalValue: Number(payload.submittedOrder.totalValue) || 0,
        lines: Array.isArray(payload.submittedOrder.lines)
          ? payload.submittedOrder.lines.map((line) => ({
            item_code: String(line.item_code || "").trim().toUpperCase(),
            item_name: String(line.item_name || "").trim(),
            quantity: Number(line.quantity) || 0,
            rate: Number(line.rate) || 0,
            line_value: Number(line.line_value) || 0,
          }))
          : [],
      }
      : null,
    readOnly: Boolean(payload.readOnly || payload.submittedOrder),
    cashDiscountMap: payload.cashDiscountMap && typeof payload.cashDiscountMap === "object"
      ? Object.fromEntries(
        Object.entries(payload.cashDiscountMap)
          .map(([code, rate]) => [String(code || "").trim().toUpperCase(), Number(rate) || 0])
          .filter(([code, rate]) => code && rate > 0),
      )
      : {},
    valueDiscountMap: payload.valueDiscountMap && typeof payload.valueDiscountMap === "object"
      ? payload.valueDiscountMap
      : {},
    schemes,
    items,
  };
}
