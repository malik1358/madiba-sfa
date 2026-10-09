import { buildModuleAccess, normalizeAccessRole } from "./moduleAccess.js";

export const MAX_PRODUCT_PHOTO_BYTES = 3 * 1024 * 1024;

export function normalizeCatalogueCode(value) {
  return String(value || "").trim().toUpperCase();
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
    canManagePhotos: canView && ["admin", "manager"].includes(normalizeAccessRole(profile?.role)),
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
