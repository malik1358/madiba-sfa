import { isBuildingMaterialItem } from "./pricePayload.js";
import { isCatalogueProductCode } from "./productCatalogue.js";

function doNotUse(name) {
  return /do\s*not\s*use+/i.test(String(name || ""));
}

export function catalogueCategoryLabel(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "Unclassified";
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase()).replace(/\bPos\b/g, "POS");
}

function isBuildingCategory(category) {
  const compact = String(category || "").toLowerCase().replace(/[^a-z]/g, "");
  return compact.includes("buildingmaterial") || compact.includes("buidingmaterial");
}

function positivePriceCodes(priceMap) {
  const codes = new Set();
  for (const [key, value] of Object.entries(priceMap || {})) {
    const amount = Number(String(value ?? "").replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) codes.add(String(key || "").trim().toUpperCase());
  }
  return codes;
}

function rememberItem(byCode, row, { fromSheet = false } = {}) {
  const code = String(row?.item_code || row?.code || "").trim().toUpperCase();
  if (!code) return;
  const name = String(row?.item_name || row?.name || "").trim();
  const category = String(row?.category || "").trim();
  const existing = byCode.get(code);
  if (!existing) {
    byCode.set(code, {
      code,
      name,
      category,
      active: fromSheet || (row?.is_active !== false && row?.active !== false),
    });
    return;
  }
  if (name) existing.name = name;
  if (category) existing.category = category;
  if (fromSheet) existing.active = true;
}

export function countCataloguePhotosUploadedSince(photos = [], sinceMs = Date.now() - 24 * 60 * 60 * 1000) {
  let uploadedLast24h = 0;
  const items = new Set();
  for (const photo of photos) {
    const createdMs = Date.parse(String(photo?.created_at || ""));
    if (!Number.isFinite(createdMs) || createdMs < sinceMs) continue;
    uploadedLast24h += 1;
    const code = String(photo?.entity_id || photo?.code || "").trim().toUpperCase();
    if (code) items.add(code);
  }
  return {
    uploadedLast24h,
    itemsUploadedLast24h: items.size,
  };
}

export function missingCataloguePhotoReport({
  master = [],
  sheet = [],
  priceMap = {},
  photoCodes = [],
  photos = [],
  now = Date.now(),
} = {}) {
  const priced = positivePriceCodes(priceMap);
  const codes = photoCodes.length
    ? photoCodes
    : photos.map((photo) => photo?.entity_id || photo?.code);
  const photoSet = new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean));
  const byCode = new Map();
  for (const row of master) rememberItem(byCode, row);
  for (const row of sheet) rememberItem(byCode, row, { fromSheet: true });

  const rows = [];
  let excludedBuilding = 0;
  let withPhotos = 0;
  for (const item of byCode.values()) {
    if (!isCatalogueProductCode(item.code) || !priced.has(item.code)) continue;
    if (doNotUse(item.name)) continue;
    if (isBuildingCategory(item.category) || isBuildingMaterialItem({
      item_code: item.code,
      item_name: item.name,
      category: item.category,
    })) {
      excludedBuilding += 1;
      continue;
    }
    if (photoSet.has(item.code)) {
      withPhotos += 1;
      continue;
    }
    rows.push({
      code: item.code,
      name: item.name || item.code,
      category: catalogueCategoryLabel(item.category),
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
  const uploaded = countCataloguePhotosUploadedSince(photos, Number(now) - 24 * 60 * 60 * 1000);
  return {
    rows,
    summary: {
      missing: rows.length,
      withPhotos,
      excludedBuilding,
      uploadedLast24h: uploaded.uploadedLast24h,
      itemsUploadedLast24h: uploaded.itemsUploadedLast24h,
    },
  };
}
