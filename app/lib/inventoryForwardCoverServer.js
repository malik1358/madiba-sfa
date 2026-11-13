import {
  buildEodStockReportRows,
  EOD_STOCK_CITIES,
  EOD_STOCK_DATASET_KEY,
  readEodStockDataset,
} from "./eodStock.js";
import {
  buildInventoryCoverModel,
  buildItemCoverRows,
  COVER_WINDOW_DAYS,
  enrichPhysicalCategoriesWithBuckets,
  trailingWindowStart,
} from "./inventoryForwardCover.js";
import { categoryByItemCodeFromSales } from "./interCityStockTransfer.js";
import { defaultMisAsOfDate } from "./misPrepared.js";
import { loadPreparedMisReport } from "./misReportServer.js";
import { getKsaDateString } from "./workdayActivity.js";

const PAGE_SIZE = 1000;
const SALES_SELECT = "item_code,item_name,category,sales_amount,transaction_date";

async function readSettingJson(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.setting_value;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
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

async function loadEodDataset(admin) {
  const payload = await readSettingJson(admin, EOD_STOCK_DATASET_KEY);
  try {
    return readEodStockDataset(payload) || {};
  } catch {
    return {};
  }
}

async function loadWholesaleRateByItem(admin) {
  const { data, error } = await admin
    .from("price_catalog_cache")
    .select("price_map,sheet_items")
    .eq("cache_key", "default")
    .maybeSingle();
  if (error) throw error;
  const rateByItem = new Map();
  const categoryBySheet = new Map();
  const priceMap = data?.price_map && typeof data.price_map === "object" ? data.price_map : {};
  for (const [code, rate] of Object.entries(priceMap)) {
    const key = String(code || "").trim().toUpperCase();
    const n = Number(rate);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    if (rate && typeof rate === "object") continue;
    rateByItem.set(key, n);
  }
  if (!rateByItem.size) {
    for (const [region, map] of Object.entries(priceMap)) {
      if (!map || typeof map !== "object" || Array.isArray(map)) continue;
      const preferRiyadh = String(region).toLowerCase().includes("riyadh");
      for (const [code, rate] of Object.entries(map)) {
        const key = String(code || "").trim().toUpperCase();
        const n = Number(rate);
        if (!key || !Number.isFinite(n) || n <= 0) continue;
        if (preferRiyadh || !rateByItem.has(key)) rateByItem.set(key, n);
      }
    }
  }
  for (const item of Array.isArray(data?.sheet_items) ? data.sheet_items : []) {
    const code = String(item?.item_code || item?.itemCode || "").trim().toUpperCase();
    const category = String(item?.category || "").trim();
    if (code && category && !categoryBySheet.has(code)) categoryBySheet.set(code, category);
  }
  return { rateByItem, categoryBySheet };
}

function aggregateSales30d(saleRows = []) {
  const sales30dByItem = new Map();
  let sales30d = 0;
  for (const row of saleRows || []) {
    const code = String(row.item_code || row.itemCode || "").trim().toUpperCase();
    const amount = Number(row.sales_amount);
    if (!code || !Number.isFinite(amount)) continue;
    sales30d += amount;
    sales30dByItem.set(code, (sales30dByItem.get(code) || 0) + amount);
  }
  for (const [code, value] of sales30dByItem) {
    sales30dByItem.set(code, Math.round(value));
  }
  return { sales30dByItem, sales30d: Math.round(sales30d) };
}

function eodStockLines(dataset) {
  const reportRows = buildEodStockReportRows(dataset);
  return reportRows
    .map((row) => {
      const uploadedValue = EOD_STOCK_CITIES.reduce(
        (sum, city) => sum + Number(row[`${city}Value`] || 0),
        0,
      );
      return {
        itemCode: String(row.itemCode || "").trim().toUpperCase(),
        itemName: row.itemName || row.itemCode,
        qty: Number(row.total || 0),
        uploadedValue,
      };
    })
    .filter((row) => row.itemCode && (row.qty > 0 || row.uploadedValue > 0));
}

export async function loadMisInventoryCover(admin, {
  source = "eod",
  asOfDate = "",
} = {}) {
  const mode = String(source || "eod").trim().toLowerCase() === "physical" ? "physical" : "eod";
  const asOf = String(asOfDate || defaultMisAsOfDate(getKsaDateString()) || getKsaDateString()).slice(0, 10);

  if (mode === "physical") {
    const loaded = await loadPreparedMisReport(admin, { asOfDate: asOf });
    const inventory = loaded?.report?.inventory || null;
    if (!inventory) {
      return {
        success: true,
        source: "physical",
        asOfDate: asOf,
        cover: null,
        message: "Published physical inventory is not available for this as-of date.",
      };
    }
    const categories = enrichPhysicalCategoriesWithBuckets(inventory.categories || []);
    const cover = buildInventoryCoverModel({
      source: "physical",
      stockDate: inventory.coverTo || asOf,
      categories,
      physical: inventory.physical,
      sales30d: inventory.sales30d,
      coverFrom: inventory.coverFrom,
      coverTo: inventory.coverTo,
      items: [],
    });
    return {
      success: true,
      source: "physical",
      asOfDate: asOf,
      builtAt: loaded.builtAt || null,
      cover,
    };
  }

  const coverTo = getKsaDateString();
  const coverFrom = trailingWindowStart(coverTo, COVER_WINDOW_DAYS);
  const [dataset, priceMaps, saleRows] = await Promise.all([
    loadEodDataset(admin),
    loadWholesaleRateByItem(admin),
    fetchPagedRows(
      admin,
      "active_sales",
      SALES_SELECT,
      (query) => query
        .gte("transaction_date", coverFrom)
        .lte("transaction_date", coverTo)
        .order("transaction_date", { ascending: true }),
    ),
  ]);

  const stockLines = eodStockLines(dataset);
  if (!stockLines.length) {
    return {
      success: true,
      source: "eod",
      asOfDate: asOf,
      cover: null,
      message: "Latest EOD stock is not uploaded yet.",
    };
  }

  const { sales30dByItem, sales30d } = aggregateSales30d(saleRows);
  const categoryBySales = categoryByItemCodeFromSales(saleRows);
  const categoryByItem = new Map(priceMaps.categoryBySheet);
  for (const [code, category] of categoryBySales) {
    if (!categoryByItem.has(code)) categoryByItem.set(code, category);
  }

  const items = buildItemCoverRows(stockLines, {
    sales30dByItem,
    rateByItem: priceMaps.rateByItem,
    categoryByItem,
  });

  const cover = buildInventoryCoverModel({
    source: "eod",
    stockDate: dataset?.stockDate || null,
    items,
    sales30d,
    coverFrom,
    coverTo,
  });

  return {
    success: true,
    source: "eod",
    asOfDate: asOf,
    cover,
  };
}
