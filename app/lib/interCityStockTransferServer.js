import { EOD_STOCK_DATASET_KEY, readEodStockDataset } from "./eodStock.js";
import {
  applyCbmToInterCityReport,
  applyMasterUnitsToInterCityReport,
  buildInterCityStockTransferReport,
  findInterCityStockImbalances,
  normalizeInterCityItemCode,
  resolveInterCitySalesWindow,
} from "./interCityStockTransfer.js";
import { loadMasterUnitConvMap } from "./masterUnitQtyServer.js";
import { PRICE_SHEET_GID, PRICE_SHEET_ID } from "./priceApiConfig.js";
import { parseCsvToRows, parsePricePayload } from "./pricePayload.js";
import { loadCatalogueSheetPacking } from "./productCatalogueServer.js";

const PAGE_SIZE = 1000;
const CODE_CHUNK = 200;
const SALES_SELECT = "item_code,item_name,category,quantity,sales_amount,transaction_date,voucher_type";

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = admin.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function queryItemCodes(itemCodes = []) {
  const codes = new Set();
  (itemCodes || []).forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    codes.add(raw);
    codes.add(raw.toUpperCase());
  });
  return [...codes];
}

async function loadEodStockDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", EOD_STOCK_DATASET_KEY)
    .maybeSingle();
  if (error) throw error;
  try {
    return readEodStockDataset(data?.setting_value) || {};
  } catch {
    return {};
  }
}

async function loadCitySalesForItems(admin, { fromDate, toDate }, itemCodes = []) {
  const codes = queryItemCodes(itemCodes);
  if (!codes.length) return [];

  const rows = [];
  for (const chunk of chunkList(codes, CODE_CHUNK)) {
    const page = await fetchPagedRows(
      admin,
      "active_sales",
      SALES_SELECT,
      (query) => query
        .in("item_code", chunk)
        .gte("transaction_date", fromDate)
        .lte("transaction_date", toDate)
        .order("transaction_date", { ascending: true }),
    );
    rows.push(...page);
  }
  return rows;
}

function cleanCbmMap(source) {
  const next = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return next;
  Object.entries(source).forEach(([rawCode, rawCbm]) => {
    const code = normalizeInterCityItemCode(rawCode);
    const cbm = Number(rawCbm);
    if (code && Number.isFinite(cbm) && cbm > 0) next[code] = cbm;
  });
  return next;
}

async function loadCbmFromPricingRulesCache(admin) {
  const { data, error } = await admin
    .from("price_catalog_cache")
    .select("price_map")
    .eq("cache_key", "pricing_rules")
    .maybeSingle();
  if (error) throw error;
  return cleanCbmMap(data?.price_map?.cbmPerCtnMap);
}

async function loadCbmFromCostingSheet() {
  const sheetId = String(PRICE_SHEET_ID || "").trim();
  const sheetGid = String(PRICE_SHEET_GID || "").trim();
  if (!sheetId) return {};
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid || "0"}`;
  const response = await fetch(exportUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Costing sheet request failed (${response.status}).`);
  const text = await response.text();
  if (!text || /<!DOCTYPE html|<html/i.test(text.slice(0, 200))) {
    throw new Error("Costing sheet returned no CSV data.");
  }
  const rows = parseCsvToRows(text);
  if (rows.length < 2) return {};
  return cleanCbmMap(parsePricePayload(rows).cbmPerCtnMap);
}

/** CBM per carton: pricing_rules cache (written by price sync) first, else the costing sheet CSV. */
export async function loadCbmPerCtnMap(admin) {
  try {
    const cached = await loadCbmFromPricingRulesCache(admin);
    if (Object.keys(cached).length) return cached;
  } catch {
    // Cache table/key missing — fall through to the sheet.
  }
  try {
    return await loadCbmFromCostingSheet();
  } catch {
    return {};
  }
}

export async function loadInterCityStockTransferReport(admin, { now = new Date() } = {}) {
  const dataset = await loadEodStockDataset(admin);
  const stockRows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const window = resolveInterCitySalesWindow({ now });
  const imbalances = findInterCityStockImbalances(stockRows);
  const itemCodes = [
    ...new Set([
      ...imbalances.riyadhToDammam.map((row) => normalizeInterCityItemCode(row.itemCode)),
      ...imbalances.dammamToRiyadh.map((row) => normalizeInterCityItemCode(row.itemCode)),
      ...(imbalances.riyadhToStore || []).map((row) => normalizeInterCityItemCode(row.itemCode)),
      ...(imbalances.storeToRiyadh || []).map((row) => normalizeInterCityItemCode(row.itemCode)),
    ].filter(Boolean)),
  ];

  const saleRows = await loadCitySalesForItems(admin, window, itemCodes);
  const report = buildInterCityStockTransferReport({
    stockRows,
    saleRows,
    now,
    stockDate: dataset?.stockDate || "",
    fileName: dataset?.fileName || "",
    citiesPresent: Array.isArray(dataset?.citiesPresent) ? dataset.citiesPresent : [],
  });
  const masterUnits = await loadMasterUnitConvMap(admin, {
    loadSheetPacking: loadCatalogueSheetPacking,
  }).catch(() => ({}));
  const cbmPerCtnMap = await loadCbmPerCtnMap(admin).catch(() => ({}));
  return applyCbmToInterCityReport(
    applyMasterUnitsToInterCityReport(report, masterUnits),
    cbmPerCtnMap,
  );
}
