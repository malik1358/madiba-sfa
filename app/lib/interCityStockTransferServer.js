import { EOD_STOCK_DATASET_KEY, readEodStockDataset } from "./eodStock.js";
import {
  applyMasterUnitsToInterCityReport,
  buildInterCityStockTransferReport,
  findInterCityStockImbalances,
  normalizeInterCityItemCode,
  resolveInterCitySalesWindow,
} from "./interCityStockTransfer.js";
import { loadMasterUnitConvMap } from "./masterUnitQtyServer.js";

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
  const masterUnits = await loadMasterUnitConvMap(admin).catch(() => ({}));
  return applyMasterUnitsToInterCityReport(report, masterUnits);
}
