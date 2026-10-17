import { buildModuleAccess, isManagementRole } from "./moduleAccess.js";
import { rowsFromSheetMatrix } from "./stockTakeMasterImport.js";
import { getPricedOrderLine, lookupDiscountRate } from "./regionalPricing.js";
import { lookupSchemeApplication } from "./orderSchemes.js";

export const MAX_PRODUCT_PHOTO_BYTES = 3 * 1024 * 1024;

export function normalizeCatalogueCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function hasCataloguePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

export function catalogueItemsWithPhotos(items, details = {}) {
  return (items || []).filter((item) => {
    const code = item?.item_code;
    const detail = details?.[code] || details?.[normalizeCatalogueCode(code)] || {};
    return (detail.photos || []).some((photo) => String(photo?.id || "").trim());
  });
}

export function catalogueFrontPhoto(photos) {
  return (photos || []).find((photo) => String(photo?.id || "").trim()) || null;
}

export const CATALOGUE_RETURN_PATH = "/management/product-catalogue";
const CATALOGUE_RETURN_KEY = "madiba-return-path";

export function cataloguePageGate({ loading = false, signedIn = null, canView = false } = {}) {
  if (loading || signedIn == null) return "loading";
  if (!signedIn) return "sign-in";
  if (!canView) return "denied";
  return "open";
}

export function rememberCatalogueReturn(storage) {
  storage?.setItem(CATALOGUE_RETURN_KEY, CATALOGUE_RETURN_PATH);
}

export function readCatalogueReturn(storage) {
  return storage?.getItem(CATALOGUE_RETURN_KEY) === CATALOGUE_RETURN_PATH
    ? CATALOGUE_RETURN_PATH
    : "";
}

export function clearCatalogueReturn(storage) {
  storage?.removeItem(CATALOGUE_RETURN_KEY);
}

function catalogueRecommendationRows(itemsByCode, list, limit, historyReady) {
  if (!historyReady) return [];
  return (list || []).slice(0, limit)
    .map((item) => itemsByCode.get(normalizeCatalogueCode(item.item_code)) || item)
    .filter((item) => normalizeCatalogueCode(item?.item_code));
}

export function catalogueItemGroups(items, newItems, historyReady, notBoughtRecently = [], buyingLess = []) {
  const byCode = new Map(items.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const seen = new Set();
  function unique(list) {
    const rows = [];
    for (const item of list) {
      const code = normalizeCatalogueCode(item.item_code);
      if (seen.has(code)) continue;
      seen.add(code);
      rows.push(item);
    }
    return rows;
  }
  const recommended = unique(catalogueRecommendationRows(byCode, newItems, 3, historyReady));
  const stale = unique(catalogueRecommendationRows(byCode, notBoughtRecently, 2, historyReady));
  const declining = unique(catalogueRecommendationRows(byCode, buyingLess, 2, historyReady));
  return {
    recommended,
    notBoughtRecently: stale,
    buyingLess: declining,
    browse: items.filter((item) => !seen.has(normalizeCatalogueCode(item.item_code))),
  };
}

export function catalogueCardPrice(item, {
  price, quantity, paymentType, cashDiscountMap, valueDiscountMap, schemeApplications,
}) {
  const scheme = lookupSchemeApplication(schemeApplications, item.item_code);
  return getPricedOrderLine({
    wholesaleRate: price,
    quantity: quantity > 0 ? quantity : 1,
    paymentType,
    cashDiscountRate: lookupDiscountRate(cashDiscountMap, item.item_code),
    valueDiscountRate: quantity > 0 ? lookupDiscountRate(valueDiscountMap, item.item_code) : 0,
    schemeUnitDiscount: scheme.unitDiscount,
    schemeDiscountedQty: scheme.discountedQty,
    excludeCashDiscount: scheme.excludeCashDiscount === true,
    item_code: item.item_code,
    item_name: item.item_name,
    category: item.category,
  });
}

export function catalogueSheetPacking(matrix) {
  const headerIndex = matrix.findIndex((row) =>
    String(row[1] || "").trim().toLowerCase() === "product code" &&
    String(row[38] || "").trim().toLowerCase() === "unit description");
  if (headerIndex < 0) throw new Error("Packing sheet must contain Product Code in B and Unit description in AM.");
  const packingByCode = {};
  for (const row of rowsFromSheetMatrix(matrix.slice(headerIndex))) {
    const code = normalizeCatalogueCode(row["Product Code"]);
    const packing = String(row["Unit description"] || "").trim();
    if (code && packing) packingByCode[code] = packing;
  }
  return packingByCode;
}

export function cataloguePermissions(profile, user = {}, options = {}) {
  const context = {
    role: profile?.role,
    salesmanCode: profile?.salesman_code,
    collectionOnlyMetadata: Boolean(user.user_metadata?.collection_only || user.app_metadata?.collection_only),
    roleModuleMatrix: options.roleModuleMatrix || null,
  };
  const canView = Boolean(profile?.is_active) && buildModuleAccess(context).canAccess("productCatalogue");
  return {
    canView,
    canManagePhotos: canView && isManagementRole(profile?.role),
  };
}

export function cataloguePacking(item = {}, product = {}, stockItem = {}) {
  const sellingUnit = String(item.tally_unit || product.unit || "").trim();
  const masterUnit = String(stockItem.master_uom || "").trim();
  const baseUnit = String(stockItem.base_uom || "").trim();
  const midUnit = String(stockItem.mid_uom || "").trim();
  const baseSize = Number(stockItem.base_uom_pack_size);
  const midSize = Number(stockItem.mid_uom_pack_size);
  const parts = [];
  if (masterUnit && baseUnit && Number.isFinite(baseSize) && baseSize > 0) {
    parts.push(`${baseSize} ${baseUnit} / ${masterUnit}`);
  }
  if (midUnit && baseUnit && Number.isFinite(midSize) && midSize > 0) {
    parts.push(`${midSize} ${baseUnit} / ${midUnit}`);
  }
  return { sellingUnit, packing: parts.join(" · ") };
}

export function validateCataloguePhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  }
  if (!file.size || file.size > MAX_PRODUCT_PHOTO_BYTES) {
    throw new Error("Photos must be no larger than 3 MB.");
  }
}
