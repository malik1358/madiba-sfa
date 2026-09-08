import { normalizeBarcode, normalizeStockTakeCode, parsePackSize } from "./stockTake.js";

function headerKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(row, keys) {
  const map = new Map();
  Object.entries(row || {}).forEach(([key, value]) => {
    map.set(headerKey(key), value);
  });
  for (const key of keys) {
    if (map.has(key) && String(map.get(key) ?? "").trim() !== "") {
      return map.get(key);
    }
  }
  return "";
}

function pickBestHeaderRow(matrix) {
  const scores = (matrix || []).slice(0, 12).map((row, index) => {
    const keys = (row || []).map((cell) => headerKey(cell));
    let score = 0;
    if (keys.some((key) => key.includes("product code") || key === "item code" || key === "sku")) score += 5;
    if (keys.some((key) => key.includes("item name") || key === "name")) score += 4;
    if (keys.some((key) => key.includes("pack size") || key.includes("packsize"))) score += 3;
    if (keys.some((key) => key.includes("barcode"))) score += 3;
    if (keys.some((key) => key.includes("base"))) score += 1;
    if (keys.some((key) => key.includes("mid"))) score += 1;
    if (keys.some((key) => key.includes("master"))) score += 1;
    return { index, score, keys };
  });
  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best?.score >= 5 ? best.index : 0;
}

export function rowsFromSheetMatrix(matrix) {
  const rows = Array.isArray(matrix) ? matrix.filter((row) => Array.isArray(row)) : [];
  if (!rows.length) return [];
  const headerIndex = pickBestHeaderRow(rows);
  const headers = rows[headerIndex] || [];
  return rows.slice(headerIndex + 1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      const key = String(header || "").trim();
      if (!key) return;
      object[key] = row[index];
    });
    return object;
  });
}

export function parseStockTakeMasterRow(row) {
  const itemCode = normalizeStockTakeCode(firstValue(row, [
    "product code",
    "item code",
    "stock code",
    "sku",
    "file number",
  ]));
  if (!itemCode) return null;

  const baseUomPackSize = parsePackSize(firstValue(row, [
    "base uom pack size",
    "base pack size",
    "pack size",
    "packsize",
    "unit pack",
  ]));
  const midUomPackSize = parsePackSize(firstValue(row, [
    "mid uom pack size",
    "mid pack size",
    "middle pack size",
    "mid pack",
    "middle pack",
    "midpack",
  ]));

  const barcodeBase = normalizeBarcode(firstValue(row, [
    "base barcode",
    "barcode base",
    "unit barcode",
    "ean",
    "barcode",
  ]));
  const barcodeMid = normalizeBarcode(firstValue(row, [
    "mid barcode",
    "barcode mid",
    "middle barcode",
    "2nd unit barcode",
  ]));
  const barcodeMaster = normalizeBarcode(firstValue(row, [
    "master barcode",
    "barcode master",
    "carton barcode",
    "ctn barcode",
    "3rd unit barcode",
  ]));

  return {
    item_code: itemCode,
    item_name: String(firstValue(row, ["item name", "product name", "name", "product code name"]) || itemCode).trim(),
    base_uom: String(firstValue(row, ["base uom", "base unit", "unit", "1st unit", "std unit"]) || "PCS").trim() || "PCS",
    mid_uom: String(firstValue(row, ["mid uom", "mid unit", "middle unit", "2nd unit", "middle pack"]) || "MID").trim() || "MID",
    master_uom: String(firstValue(row, ["master uom", "master unit", "3rd unit", "carton", "ctn", "ctn bag", "master"]) || "CTN").trim() || "CTN",
    base_uom_pack_size: baseUomPackSize,
    mid_uom_pack_size: midUomPackSize,
    barcode_base: barcodeBase || null,
    barcode_mid: barcodeMid || null,
    barcode_master: barcodeMaster || null,
  };
}

export function parseStockTakeMasterRows(rows) {
  const byCode = new Map();
  let skipped = 0;

  (rows || []).forEach((row) => {
    const parsed = parseStockTakeMasterRow(row);
    if (!parsed) {
      skipped += 1;
      return;
    }
    byCode.set(parsed.item_code, parsed);
  });

  return {
    items: [...byCode.values()],
    skipped,
  };
}

export function parseSystemInventoryRow(row) {
  const itemCode = normalizeStockTakeCode(firstValue(row, [
    "product code",
    "item code",
    "stock code",
    "sku",
  ]));
  if (!itemCode) return null;
  const qtyBase = parsePackSize(firstValue(row, [
    "qty base",
    "base qty",
    "quantity base",
    "system qty",
    "qty",
    "quantity",
    "stock",
  ]));
  return {
    item_code: itemCode,
    qty_base: qtyBase,
    item_name: String(firstValue(row, ["item name", "product name", "name"]) || "").trim(),
  };
}

export function parseSystemInventoryRows(rows) {
  const byCode = new Map();
  (rows || []).forEach((row) => {
    const parsed = parseSystemInventoryRow(row);
    if (!parsed) return;
    byCode.set(parsed.item_code, parsed);
  });
  return [...byCode.values()];
}
