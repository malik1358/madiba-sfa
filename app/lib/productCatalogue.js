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

export function catalogueItemGroups(items, newItems, historyReady) {
  const byCode = new Map(items.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const recommended = historyReady ? newItems.slice(0, 3)
    .map((item) => byCode.get(normalizeCatalogueCode(item.item_code))).filter(Boolean) : [];
  const codes = new Set(recommended.map((item) => normalizeCatalogueCode(item.item_code)));
  return {
    recommended,
    browse: items.filter((item) => !codes.has(normalizeCatalogueCode(item.item_code))),
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

export function cataloguePermissions(profile, user = {}) {
  const context = {
    role: profile?.role,
    salesmanCode: profile?.salesman_code,
    collectionOnlyMetadata: Boolean(user.user_metadata?.collection_only || user.app_metadata?.collection_only),
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

export function validateCataloguePreview(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo for the temporary preview.");
  }
  if (!file.size || file.size > MAX_PRODUCT_PHOTO_BYTES) {
    throw new Error("Preview photos must be no larger than 3 MB.");
  }
}
