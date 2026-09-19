import {
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_PRICING_REGION,
  normalizePaymentType,
  normalizePricingRegion,
  vatAmountFromExcl,
  vatRateForProduct,
} from "./regionalPricing.js";

export const TALLY_UNIT_SOURCE_EXCEL = "excel_import";
export const TALLY_UNIT_SOURCE_INVOICE_PDF = "invoice_pdf";
export const TALLY_UNIT_SOURCE_MANUAL = "manual";

export const TALLY_EXPORT_COLUMNS = [
  "DATE",
  "VOUCHER TYPE",
  "PARTY A/C NAME",
  "ORDER NO",
  "SALS LEDGER",
  "COST CENTER",
  "SALES TEAM",
  "ITEM NAME",
  "ITEM QTY",
  "ITEM RATE",
  "GODOWN",
  "OUTPUT VAT",
  "Item Unit",
  "Discount",
];

const KNOWN_UNITS = [
  "CTN",
  "RIM",
  "PCS",
  "PC",
  "EA",
  "NOS",
  "KG",
  "BAG",
  "BALE",
  "BOX",
  "CBM",
  "RL",
  "ROLL",
  "SHEET",
  "SHEETS",
  "DRUM",
  "PAIRS",
  "PAIR",
];

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
    if (keys.some((key) => key.includes("tally item") || key === "item name" || key.includes("item name"))) score += 5;
    if (keys.some((key) => key.includes("master unit") || key === "unit" || key.includes("item unit"))) score += 5;
    if (keys.some((key) => key.includes("item code") || key === "sku")) score += 3;
    return { index, score };
  });
  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best?.score >= 5 ? best.index : 0;
}

export function rowsFromSheetMatrix(matrix) {
  const rows = Array.isArray(matrix) ? matrix.filter((row) => Array.isArray(row)) : [];
  if (!rows.length) return [];
  const headerIndex = pickBestHeaderRow(rows);
  const headers = [...(rows[headerIndex] || [])];
  const width = Math.max(headers.length, ...rows.map((row) => row.length));
  while (headers.length < width) headers.push("");
  return rows.slice(headerIndex + 1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      const key = String(header || "").trim() || `__col_${index}`;
      object[key] = row[index];
    });
    return object;
  });
}

export function normalizeItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeTallyUnit(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  const known = KNOWN_UNITS.find((unit) => unit === upper);
  return known || text;
}

export function splitTallyItemName(rawName) {
  const name = String(rawName || "").trim();
  if (!name) return { itemCode: "", tallyItemName: "", itemName: "" };

  const underscore = name.indexOf("_");
  if (underscore > 0) {
    const itemCode = normalizeItemCode(name.slice(0, underscore));
    const itemName = name.slice(underscore + 1).trim();
    return {
      itemCode,
      tallyItemName: name,
      itemName: itemName || name,
    };
  }

  return {
    itemCode: normalizeItemCode(name),
    tallyItemName: name,
    itemName: name,
  };
}

export function parseTallyItemMasterRow(row) {
  const tallyName = String(firstValue(row, [
    "tally item name",
    "item name",
    "stock item",
    "name",
  ]) || "").trim();
  const unit = normalizeTallyUnit(firstValue(row, [
    "master unit",
    "item unit",
    "unit",
    "uom",
  ]));
  const explicitCode = normalizeItemCode(firstValue(row, [
    "item code",
    "product code",
    "sku",
    "code",
  ]));

  const split = splitTallyItemName(tallyName);
  const itemCode = explicitCode || split.itemCode;
  if (!itemCode || !unit) return null;

  return {
    item_code: itemCode,
    tally_item_name: split.tallyItemName || `${itemCode}_${split.itemName || itemCode}`,
    tally_unit: unit,
    item_name: split.itemName || itemCode,
  };
}

export function parseTallyItemMasterRows(rows) {
  const byCode = new Map();
  let skipped = 0;

  (rows || []).forEach((row) => {
    const parsed = parseTallyItemMasterRow(row);
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

function salesmanHaystack(order = {}) {
  return `${order.salesman_code || ""} ${order.salesman_name || ""}`.toUpperCase();
}

export function resolveTallySalesRouting(order = {}, pricingRegion = DEFAULT_PRICING_REGION) {
  const haystack = salesmanHaystack(order);
  const region = normalizePricingRegion(pricingRegion);

  if (/\bZIA\b/.test(haystack) || haystack.includes("ZIA")) {
    return {
      costCenter: "BM",
      salesTeam: "ZIA",
      godown: "RIYADH W/H 1",
      area: "RIYADH",
    };
  }

  if (/\bASRAR\b/.test(haystack) || haystack.includes("ASRAR")) {
    return {
      costCenter: "BM",
      salesTeam: "ASRAR",
      godown: "RIYADH W/H 1",
      area: "RIYADH",
    };
  }

  const godownByRegion = {
    riyadh: "RIYADH W/H 2",
    dammam: "DAMMAM W/H 1",
    jeddah: "JEDDAH W/H 1",
  };

  return {
    costCenter: "OTHER",
    salesTeam: "OTHER THAN ZIA & ASRAR",
    godown: godownByRegion[region] || godownByRegion.riyadh,
    area: region.toUpperCase(),
  };
}

export function formatTallyVoucherType(pricingRegion, paymentType) {
  const region = normalizePricingRegion(pricingRegion);
  const payment = normalizePaymentType(paymentType);
  return `${region} w/s ${payment}`;
}

export function formatTallyDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatTallyDate(new Date());
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export function buildTallyItemName(line = {}, unitMap = {}) {
  const code = normalizeItemCode(line.item_code);
  const mapped = unitMap[code] || unitMap[line.item_code] || null;
  if (mapped?.tally_item_name) return String(mapped.tally_item_name).trim();

  const rawName = String(line.item_name || "").trim();
  if (!code) return rawName || "-";
  if (rawName.toUpperCase().startsWith(`${code}_`)) return rawName;
  if (rawName) return `${code}_${rawName}`;
  return code;
}

export function resolveItemUnit(line = {}, unitMap = {}) {
  const code = normalizeItemCode(line.item_code);
  const mapped = unitMap[code] || unitMap[line.item_code] || null;
  const unit = normalizeTallyUnit(mapped?.tally_unit || line.tally_unit || line.unit || "");
  return unit || "CTN";
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function discountPercentFromRates(wholesaleRate, netRate) {
  const wholesale = Number(wholesaleRate || 0);
  const net = Number(netRate || 0);
  if (!(wholesale > 0) || !(net >= 0) || net >= wholesale) return 0;
  return round2(((wholesale - net) / wholesale) * 100);
}

/**
 * Build one Excel row per order line for Tally sales voucher import.
 */
export function buildTallyOrderExportRows({
  order,
  lines = [],
  unitMap = {},
  orderNumber = "",
  pricingRegion = DEFAULT_PRICING_REGION,
  paymentType = DEFAULT_PAYMENT_TYPE,
  exportDate = new Date(),
} = {}) {
  const region = normalizePricingRegion(pricingRegion);
  const payment = normalizePaymentType(paymentType);
  const routing = resolveTallySalesRouting(order, region);
  const voucherType = formatTallyVoucherType(region, payment);
  const dateText = formatTallyDate(exportDate);
  const partyName = String(order?.customer_name || order?.customer_code || "").trim() || "-";
  const orderNo = String(orderNumber || order?.order_number || order?.id || "").trim();

  return (Array.isArray(lines) ? lines : []).map((line) => {
    const qty = Number(line.quantity || 0);
    const rate = Number(line.rate || 0);
    const wholesale = Number(line.wholesaleRate || line.wholesale_rate || rate);
    const lineValue = Number(
      line.lineValue
      ?? line.line_value
      ?? line.lineTotal
      ?? (qty * rate),
    );
    const vatRate = Number.isFinite(Number(line.vatRate))
      ? Math.max(0, Number(line.vatRate))
      : vatRateForProduct(line);
    const vatAmount = Number.isFinite(Number(line.vatAmount))
      ? Number(line.vatAmount)
      : vatAmountFromExcl(lineValue, vatRate);
    const discount = Number.isFinite(Number(line.discountPercent))
      ? Number(line.discountPercent)
      : discountPercentFromRates(wholesale, rate);

    return {
      DATE: dateText,
      "VOUCHER TYPE": voucherType,
      "PARTY A/C NAME": partyName,
      "ORDER NO": orderNo,
      "SALS LEDGER": "sales wholesale",
      "COST CENTER": routing.costCenter,
      "SALES TEAM": routing.salesTeam,
      "ITEM NAME": buildTallyItemName(line, unitMap),
      "ITEM QTY": round2(qty),
      "ITEM RATE": round2(rate),
      GODOWN: routing.godown,
      "OUTPUT VAT": round2(vatAmount),
      "Item Unit": resolveItemUnit(line, unitMap),
      Discount: round2(discount),
    };
  });
}

export function unitMapFromItems(items = []) {
  const map = {};
  (items || []).forEach((item) => {
    const code = normalizeItemCode(item?.item_code);
    if (!code) return;
    map[code] = {
      item_code: code,
      tally_unit: normalizeTallyUnit(item.tally_unit),
      tally_item_name: String(item.tally_item_name || "").trim(),
    };
  });
  return map;
}

/**
 * Best-effort unit extraction from invoice PDF text for future master updates.
 * Looks for known UOM tokens on the same line as an item code.
 */
export function extractUnitsFromInvoicePdfText(pdfText, orderLines = []) {
  const lines = String(pdfText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const updates = [];
  const seen = new Set();

  (orderLines || []).forEach((orderLine) => {
    const code = normalizeItemCode(orderLine?.item_code);
    if (!code || seen.has(code)) return;

    const matching = lines.find((line) => line.toUpperCase().includes(code));
    if (!matching) return;

    const upper = matching.toUpperCase();
    const unitMatch = KNOWN_UNITS.find((unit) => {
      const pattern = new RegExp(`(?:^|[^A-Z0-9])${unit}(?:[^A-Z0-9]|$)`);
      return pattern.test(upper);
    });
    if (!unitMatch) return;

    seen.add(code);
    updates.push({
      item_code: code,
      tally_unit: unitMatch,
      tally_item_name: buildTallyItemName(orderLine, {}),
      source: TALLY_UNIT_SOURCE_INVOICE_PDF,
    });
  });

  return updates;
}

/**
 * Upsert tally units on items_master. Safe no-op when columns are missing.
 */
export async function applyTallyUnitUpdates(admin, updates = [], {
  source = TALLY_UNIT_SOURCE_EXCEL,
  createMissing = false,
} = {}) {
  const rows = (updates || []).filter((row) => row?.item_code && row?.tally_unit);
  if (!rows.length) {
    return { updated: 0, created: 0, skipped: 0 };
  }

  const nowIso = new Date().toISOString();
  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const itemCode = normalizeItemCode(row.item_code);
    const payload = {
      tally_unit: normalizeTallyUnit(row.tally_unit),
      tally_unit_source: String(row.source || source).trim() || source,
      tally_unit_updated_at: nowIso,
      updated_at: nowIso,
    };
    if (row.tally_item_name) {
      payload.tally_item_name = String(row.tally_item_name).trim();
    }

    const { data: existing, error: lookupError } = await admin
      .from("items_master")
      .select("id,item_code")
      .eq("item_code", itemCode)
      .maybeSingle();

    if (lookupError) {
      if (isMissingTallyUnitColumn(lookupError)) {
        throw new Error("Run sql/setup_tally_item_units.sql in Supabase to enable Tally item units.");
      }
      throw lookupError;
    }

    if (existing?.id) {
      const { error } = await admin
        .from("items_master")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
      updated += 1;
      continue;
    }

    if (!createMissing) {
      skipped += 1;
      continue;
    }

    const { error } = await admin.from("items_master").insert({
      item_code: itemCode,
      item_name: row.item_name || row.tally_item_name || itemCode,
      is_active: true,
      ...payload,
    });
    if (error) throw error;
    created += 1;
  }

  return { updated, created, skipped };
}

export function isMissingTallyUnitColumn(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return message.includes("tally_unit")
    || message.includes("tally_item_name")
    || message.includes("tally_unit_source")
    || message.includes("tally_unit_updated_at");
}

/**
 * Future path: refresh master units from an uploaded invoice PDF text.
 * Returns applied counts; does not fail the invoice upload if extraction finds nothing.
 */
export async function updateMasterUnitsFromInvoicePdf(admin, {
  pdfText = "",
  orderLines = [],
} = {}) {
  const updates = extractUnitsFromInvoicePdfText(pdfText, orderLines);
  if (!updates.length) {
    return { found: 0, updated: 0, created: 0, skipped: 0 };
  }

  try {
    const result = await applyTallyUnitUpdates(admin, updates, {
      source: TALLY_UNIT_SOURCE_INVOICE_PDF,
      createMissing: false,
    });
    return { found: updates.length, ...result };
  } catch (error) {
    if (isMissingTallyUnitColumn(error) || String(error?.message || "").includes("setup_tally_item_units")) {
      return { found: updates.length, updated: 0, created: 0, skipped: updates.length, deferred: true };
    }
    throw error;
  }
}
