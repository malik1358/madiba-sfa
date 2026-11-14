/**
 * Master-unit stock display: when an item has a Master UOM + conversion
 * (Power BI T_Master Unit Converation / item_master_analysis.tally_master_unit_conv),
 * stock qty in base units is shown as round(qty / conv) Master UOM.
 *
 * Order entry / saved order lines / Tally export stay in selling-unit qty.
 */

export function normalizeUnitKey(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function unitsMatch(a, b) {
  const left = normalizeUnitKey(a);
  const right = normalizeUnitKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const aliases = {
    ctn: ["ctn", "carton", "cartons", "cx", "box", "boxes"],
    pcs: ["pcs", "pc", "piece", "pieces"],
    rm: ["rm", "rim", "ream", "reams"],
  };
  for (const group of Object.values(aliases)) {
    if (group.includes(left) && group.includes(right)) return true;
  }
  return false;
}

export function parseMasterConv(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/**
 * Build compact itemCode → { masterUom, baseUom, conv } from item_master_analysis rows.
 * Prefers rows with a Master UOM (tally_alt_uom) and conv > 1.
 */
export function buildMasterUnitConvMap(rows = []) {
  const byCode = new Map();

  function consider(code, row) {
    const key = String(code || "").trim().toUpperCase();
    if (!key) return;
    const masterUom = String(row?.tally_alt_uom || row?.masterUom || "").trim();
    const baseUom = String(row?.tally_base_uom || row?.baseUom || "").trim();
    const conv = parseMasterConv(row?.tally_master_unit_conv ?? row?.conv);
    if (!masterUom || conv == null || !(conv > 0)) return;

    const next = { masterUom, baseUom, conv };
    const prev = byCode.get(key);
    if (!prev) {
      byCode.set(key, next);
      return;
    }
    // Prefer a real multi-unit conversion over identity (1).
    if (prev.conv <= 1 && next.conv > 1) {
      byCode.set(key, next);
      return;
    }
    if (prev.conv > 1 && next.conv <= 1) return;
    if (next.conv > prev.conv) byCode.set(key, next);
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    consider(row?.tally_item_code || row?.itemCode, row);
    consider(row?.google_article_no || row?.articleNo, row);
  }

  return Object.fromEntries(byCode);
}

export function lookupMasterUnitConv(map, itemCode) {
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code || !map || typeof map !== "object") return null;
  const entry = map[code];
  if (!entry || typeof entry !== "object") return null;
  const conv = parseMasterConv(entry.conv ?? entry.tally_master_unit_conv);
  const masterUom = String(entry.masterUom || entry.tally_alt_uom || "").trim();
  if (!masterUom || conv == null || !(conv > 0)) return null;
  return {
    masterUom,
    baseUom: String(entry.baseUom || entry.tally_base_uom || "").trim(),
    conv,
  };
}

/**
 * Convert a stock qty to master units when appropriate.
 * @returns {{ qty: number, unit: string, converted: boolean, rawQty: number }}
 */
export function toMasterStockQty(rawQty, {
  stockUnit = "",
  masterUom = "",
  baseUom = "",
  conv = null,
} = {}) {
  const qty = Number(rawQty);
  const safeRaw = Number.isFinite(qty) ? qty : 0;
  const factor = parseMasterConv(conv);
  const master = String(masterUom || "").trim();
  const base = String(baseUom || "").trim();
  const stock = String(stockUnit || "").trim();

  if (!master || factor == null || !(factor > 0)) {
    return { qty: safeRaw, unit: stock || base || "", converted: false, rawQty: safeRaw };
  }

  // Already expressed in master UOM — do not divide again.
  if (stock && unitsMatch(stock, master)) {
    return { qty: Math.round(safeRaw), unit: master, converted: false, rawQty: safeRaw };
  }

  // Identity conversion (1 base = 1 master).
  if (factor <= 1) {
    return { qty: Math.round(safeRaw), unit: master, converted: false, rawQty: safeRaw };
  }

  // Convert when stock unit is blank, matches base, or is clearly not master.
  if (!stock || (base && unitsMatch(stock, base)) || !unitsMatch(stock, master)) {
    return {
      qty: Math.round(safeRaw / factor),
      unit: master,
      converted: true,
      rawQty: safeRaw,
    };
  }

  return { qty: Math.round(safeRaw), unit: master, converted: false, rawQty: safeRaw };
}

export function formatMasterStockQty(qty, unit = "") {
  const n = Math.round(Number(qty) || 0);
  const qtyText = n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const u = String(unit || "").trim();
  return u ? `${qtyText} ${u}` : qtyText;
}

/**
 * Apply master-unit conversion to an EOD availability snapshot for one item.
 */
export function resolveEodStockMasterDisplay(availability, itemCode, rawQty) {
  const code = String(itemCode || "").trim().toUpperCase();
  const stock = availability && typeof availability === "object" ? availability : {};
  const stockUnit = code ? String(stock.units?.[code] || "").trim() : "";
  const master = lookupMasterUnitConv(stock.masterUnits, code);
  if (!master) {
    return {
      qty: Number.isFinite(Number(rawQty)) ? Number(rawQty) : 0,
      unit: stockUnit,
      converted: false,
      rawQty: Number.isFinite(Number(rawQty)) ? Number(rawQty) : 0,
    };
  }
  return toMasterStockQty(rawQty, {
    stockUnit,
    masterUom: master.masterUom,
    baseUom: master.baseUom,
    conv: master.conv,
  });
}
