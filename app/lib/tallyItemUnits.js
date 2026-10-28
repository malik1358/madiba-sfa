import {
  canonicalCustomerCode,
  isProspectCustomerCode,
  splitPartyByLeadingCode,
} from "./customerCode.js";
import { lookupPositiveRate } from "./itemCodeAliases.js";
import {
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_PRICING_REGION,
  normalizePaymentType,
  normalizePricingRegion,
  regionPriceMapFor,
  vatRateForProduct,
} from "./regionalPricing.js";

export const TALLY_UNIT_SOURCE_EXCEL = "excel_import";
export const TALLY_UNIT_SOURCE_INVOICE_PDF = "invoice_pdf";
export const TALLY_UNIT_SOURCE_MANUAL = "manual";

export const TALLY_VAT_LEDGER = "Output VAT 15% - Non Food Division";

export const TALLY_EXPORT_COLUMNS = [
  "Voucher Date",
  "Voucher Type Name",
  "Voucher Number",
  "Ref.No",
  "Ref.Date",
  "CUSTOMER NAME",
  "PriceListName",
  "Charge.Ledgers VAT/Freight",
  "Barcode",
  "Item Name",
  "order no",
  "Order.Date",
  "Tracking No.",
  "Barcode.Qty",
  "Barcode.UOM",
  "Billed Quantity",
  "Billed Quantity Unit",
  "Item Rate",
  "Discount",
  "Amount",
  "godown",
  "SALES LEDGER",
  "SALES TEAM",
  "COST CENTER",
  "Narration",
  "VAT PERC",
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

export function resolveTallySalesChannel(order = {}) {
  const haystack = `${order.sales_channel || ""} ${order.channel || ""} ${order.salesman_code || ""} ${order.salesman_name || ""}`.toUpperCase();
  if (/\bE-?COMM\b|\bONLINE\b/.test(haystack)) return "ecomm";
  if (/\bSTORE\b/.test(haystack)) return "store";
  if (/\bRETAIL\b/.test(haystack)) return "retail";
  return "wholesale";
}

export function resolveTallySalesLedger(channel = "wholesale") {
  if (channel === "ecomm") return "SALES ONLINE";
  if (channel === "retail" || channel === "store") return "SALES RETAIL";
  return "SALES WHOLESALE";
}

/**
 * Table 1: voucher type and price list.
 * BM (ZIA / ASRAR) and e-comm use SALES NON FOOD DIVISION / MANUAL.
 */
export function resolveTallyVoucherSetup({
  pricingRegion = DEFAULT_PRICING_REGION,
  paymentType = DEFAULT_PAYMENT_TYPE,
  routing = null,
  channel = "wholesale",
} = {}) {
  const region = normalizePricingRegion(pricingRegion);
  const payment = normalizePaymentType(paymentType);
  const salesLedger = resolveTallySalesLedger(channel);
  const isBm = routing?.costCenter === "BM";

  if (isBm || channel === "ecomm") {
    return {
      voucherType: "SALES NON FOOD DIVISION",
      priceList: "MANUAL",
      salesLedger,
    };
  }

  const regionLabel = region === "dammam" ? "DAMMAM" : region === "jeddah" ? "JEDDAH" : "RIYADH";

  if (channel === "retail" && region !== "jeddah") {
    return {
      voucherType: `${regionLabel} RETAIL SALES`,
      priceList: `${regionLabel} RETAIL`,
      salesLedger,
    };
  }

  if (channel === "store" && region === "riyadh") {
    return {
      voucherType: "RIYADH STORE SALES",
      priceList: "RIYADH STORE",
      salesLedger,
    };
  }

  if (payment === "cash") {
    return {
      voucherType: `${regionLabel} CASH SALES`,
      priceList: `${regionLabel} W/S`,
      salesLedger,
    };
  }

  return {
    voucherType: `${regionLabel} W/S CREDIT`,
    priceList: `${regionLabel} W/S`,
    salesLedger,
  };
}

export function formatTallyVoucherType(pricingRegion, paymentType, options = {}) {
  return resolveTallyVoucherSetup({
    pricingRegion,
    paymentType,
    routing: options.routing,
    channel: options.channel,
  }).voucherType;
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

export function tallyVatPercentCell(vatRate) {
  const rate = Number(vatRate);
  if (!(rate > 0)) return "";
  const percent = rate <= 1 ? Math.round(rate * 100) : Math.round(rate);
  return percent > 0 ? percent : "";
}

export function discountPercentFromRates(wholesaleRate, netRate) {
  const wholesale = Number(wholesaleRate || 0);
  const net = Number(netRate || 0);
  if (!(wholesale > 0) || !(net >= 0) || net >= wholesale) return 0;
  return round2(((wholesale - net) / wholesale) * 100);
}

export function discountAmountPerUnit(listRate, netRate) {
  const list = Number(listRate || 0);
  const net = Number(netRate || 0);
  if (!(list > 0) || !(net >= 0) || net >= list) return 0;
  return round2(list - net);
}

export function ledgerNamesFromSalesRows(rows = []) {
  const names = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const party = row?.source_data?.["Party Name"] || row?.party_name || row?.partyName;
    if (party) names.push(party);
    if (row?.customer_name) names.push(row.customer_name);
  });
  return names;
}

/**
 * Pick the imported Tally ledger string for this account.
 * Spacing is kept as it arrived in the sales file, for example
 * "1037  AL-IBTIKAR LIBRARY FOR TRADING EST."
 */
export function chooseTallyLedgerName(customerCode, candidates = []) {
  const code = canonicalCustomerCode(customerCode);
  if (!code) return "";

  const counts = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((raw) => {
    const ledger = String(raw || "").trim();
    if (!ledger) return;
    const parsed = splitPartyByLeadingCode(ledger);
    if (canonicalCustomerCode(parsed.customer_code) !== code || !parsed.customer_name) return;
    counts.set(ledger, (counts.get(ledger) || 0) + 1);
  });

  let best = "";
  let bestCount = 0;
  counts.forEach((count, ledger) => {
    if (count > bestCount || (count === bestCount && ledger.length > best.length)) {
      best = ledger;
      bestCount = count;
    }
  });
  return best;
}

export function resolveTallyCustomerLedgerName(order = {}) {
  const explicit = String(order?.tally_ledger_name || order?.tallyLedgerName || "").trim();
  if (explicit) return explicit;

  const code = String(order?.customer_code || "").trim();
  const name = String(order?.customer_name || "").trim();
  if (isProspectCustomerCode(code)) return name || code || "-";

  const fromName = chooseTallyLedgerName(code, [name]);
  if (fromName) return fromName;
  if (code && name) return `${code} ${name}`.trim();
  return name || code || "-";
}

export function resolveTallySalesTeamName(order = {}) {
  const name = String(order?.salesman_name || order?.salesmanName || "").trim();
  if (name) return name;
  return String(order?.salesman_code || order?.salesmanCode || "").trim();
}

/**
 * Stamp the regional price-list rate onto lines whose saved rate is already
 * the net price. Saved line rates stay as billed so the discount is the gap.
 */
export function withTallyCatalogRates(lines = [], {
  pricingCatalog = null,
  pricingRegion = DEFAULT_PRICING_REGION,
} = {}) {
  if (!pricingCatalog) return lines;
  const priceMap = regionPriceMapFor(
    pricingCatalog.regionPriceMaps,
    normalizePricingRegion(pricingRegion),
    pricingCatalog.priceMap || {},
  );

  return (Array.isArray(lines) ? lines : []).map((line) => {
    const catalogRate = lookupPositiveRate(priceMap, line?.item_code, 0);
    if (!(catalogRate > 0)) return line;
    const netRate = Number(line?.rate || 0);
    const existing = Number(line?.wholesaleRate || line?.wholesale_rate || 0);
    if (existing > netRate && existing > 0) return line;
    return { ...line, wholesaleRate: catalogRate };
  });
}

/**
 * Build one Excel row per order line for Tally sales voucher import.
 */
export function resolveItemBarcode(line = {}, unitMap = {}) {
  const code = normalizeItemCode(line.item_code);
  const mapped = unitMap[code] || unitMap[line.item_code] || null;
  return String(
    mapped?.barcode
    || mapped?.tally_barcode
    || line.barcode
    || line.tally_barcode
    || "",
  ).trim();
}

export function buildTallyOrderExportRows({
  order,
  lines = [],
  unitMap = {},
  orderNumber = "",
  pricingRegion = DEFAULT_PRICING_REGION,
  paymentType = DEFAULT_PAYMENT_TYPE,
  exportDate = new Date(),
  orderDate = null,
} = {}) {
  const region = normalizePricingRegion(pricingRegion);
  const payment = normalizePaymentType(paymentType);
  const routing = resolveTallySalesRouting(order, region);
  const channel = resolveTallySalesChannel(order);
  const setup = resolveTallyVoucherSetup({
    pricingRegion: region,
    paymentType: payment,
    routing,
    channel,
  });
  const voucherDate = formatTallyDate(exportDate);
  const orderDateText = formatTallyDate(orderDate || order?.created_at || order?.submitted_at || exportDate);
  const partyName = resolveTallyCustomerLedgerName(order);
  const orderNo = String(orderNumber || order?.order_number || order?.id || "").trim();

  let vatTotal = 0;
  let vatPercent = "";
  const itemRows = (Array.isArray(lines) ? lines : []).map((line) => {
    const qty = Number(line.quantity || 0);
    const rate = Number(line.rate || 0);
    const wholesale = Number(line.wholesaleRate || line.wholesale_rate || rate);
    const listRate = wholesale > 0 ? wholesale : rate;
    const lineValue = Number(
      line.lineValue
      ?? line.line_value
      ?? line.lineTotal
      ?? (qty * rate),
    );
    const vatRate = Number.isFinite(Number(line.vatRate))
      ? Math.max(0, Number(line.vatRate))
      : vatRateForProduct(line);
    const discount = discountAmountPerUnit(listRate, rate);
    const unit = resolveItemUnit(line, unitMap);
    const amount = Number.isFinite(lineValue) && lineValue > 0
      ? round2(lineValue)
      : round2(qty * (rate > 0 ? rate : listRate));
    const explicitVat = Number(line.vatAmount);
    const lineVat = !(vatRate > 0) || !(amount > 0)
      ? 0
      : Number.isFinite(explicitVat) && line.vatAmount != null && line.vatAmount !== ""
        ? round2(explicitVat)
        : round2(amount * vatRate);
    vatTotal += lineVat;
    const vatPerc = tallyVatPercentCell(vatRate);
    if (vatPerc !== "" && vatPercent === "") vatPercent = vatPerc;

    return {
      "Voucher Date": voucherDate,
      "Voucher Type Name": setup.voucherType,
      "Voucher Number": "",
      "Ref.No": orderNo,
      "Ref.Date": orderDateText,
      "CUSTOMER NAME": partyName,
      PriceListName: setup.priceList,
      "Charge.Ledgers VAT/Freight": "",
      Barcode: resolveItemBarcode(line, unitMap),
      "Item Name": buildTallyItemName(line, unitMap),
      "order no": orderNo,
      "Order.Date": orderDateText,
      "Tracking No.": "",
      "Barcode.Qty": round2(qty),
      "Barcode.UOM": unit,
      "Billed Quantity": round2(qty),
      "Billed Quantity Unit": unit,
      "Item Rate": round2(listRate),
      Discount: round2(discount),
      Amount: amount,
      godown: routing.godown,
      "SALES LEDGER": setup.salesLedger,
      "SALES TEAM": resolveTallySalesTeamName(order) || routing.salesTeam,
      "COST CENTER": routing.costCenter,
      Narration: "",
      "VAT PERC": vatPerc,
    };
  });

  vatTotal = round2(vatTotal);
  if (!(vatTotal > 0)) return itemRows;

  const vatRow = Object.fromEntries(TALLY_EXPORT_COLUMNS.map((column) => [column, ""]));
  vatRow["Voucher Date"] = voucherDate;
  vatRow["Voucher Type Name"] = setup.voucherType;
  vatRow["Ref.Date"] = orderDateText;
  vatRow["Charge.Ledgers VAT/Freight"] = TALLY_VAT_LEDGER;
  vatRow.Amount = vatTotal;
  vatRow["VAT PERC"] = vatPercent;
  return [...itemRows, vatRow];
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
      barcode: String(item.tally_barcode || item.barcode || "").trim(),
      tally_barcode: String(item.tally_barcode || item.barcode || "").trim(),
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
 * Existing rows are updated in chunks; missing codes are skipped unless createMissing.
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
  const byCode = new Map();
  rows.forEach((row) => {
    const itemCode = normalizeItemCode(row.item_code);
    if (!itemCode) return;
    byCode.set(itemCode, {
      item_code: itemCode,
      item_name: row.item_name || row.tally_item_name || itemCode,
      tally_unit: normalizeTallyUnit(row.tally_unit),
      tally_item_name: String(row.tally_item_name || "").trim() || null,
      tally_unit_source: String(row.source || source).trim() || source,
      tally_unit_updated_at: nowIso,
      updated_at: nowIso,
    });
  });

  // Map upper(code) -> actual item_code casing stored in DB.
  const existingByUpper = new Map();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("items_master")
      .select("item_code")
      .range(from, from + pageSize - 1);

    if (error) {
      if (isMissingTallyUnitColumn(error)) {
        throw new Error("Run sql/setup_tally_item_units.sql in Supabase to enable Tally item units.");
      }
      throw error;
    }

    const page = data || [];
    page.forEach((row) => {
      const code = String(row.item_code || "").trim();
      if (!code) return;
      existingByUpper.set(normalizeItemCode(code), code);
    });

    if (page.length < pageSize) break;
    from += pageSize;
  }

  const toUpdate = [];
  const toCreate = [];
  let skipped = 0;

  byCode.forEach((row, upperCode) => {
    const existingCode = existingByUpper.get(upperCode);
    if (existingCode) {
      const payload = {
        item_code: existingCode,
        tally_unit: row.tally_unit,
        tally_unit_source: row.tally_unit_source,
        tally_unit_updated_at: row.tally_unit_updated_at,
        updated_at: row.updated_at,
      };
      if (row.tally_item_name) payload.tally_item_name = row.tally_item_name;
      toUpdate.push(payload);
      return;
    }
    if (createMissing) {
      toCreate.push({
        item_code: row.item_code,
        item_name: row.item_name,
        is_active: true,
        tally_unit: row.tally_unit,
        tally_item_name: row.tally_item_name,
        tally_unit_source: row.tally_unit_source,
        tally_unit_updated_at: row.tally_unit_updated_at,
        updated_at: row.updated_at,
      });
      return;
    }
    skipped += 1;
  });

  for (let index = 0; index < toUpdate.length; index += 100) {
    const chunk = toUpdate.slice(index, index + 100);
    const { error } = await admin
      .from("items_master")
      .upsert(chunk, { onConflict: "item_code" });
    if (error) {
      if (isMissingTallyUnitColumn(error)) {
        throw new Error("Run sql/setup_tally_item_units.sql in Supabase to enable Tally item units.");
      }
      throw error;
    }
  }

  for (let index = 0; index < toCreate.length; index += 100) {
    const chunk = toCreate.slice(index, index + 100);
    const { error } = await admin.from("items_master").insert(chunk);
    if (error) throw error;
  }

  return {
    updated: toUpdate.length,
    created: toCreate.length,
    skipped,
  };
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
