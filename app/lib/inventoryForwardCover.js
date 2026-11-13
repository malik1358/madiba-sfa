/**
 * MIS inventory forward-cover days, cover buckets, and category/item rollups.
 * Cover = stockValue ÷ (sales30d ÷ 30).
 */

export const COVER_WINDOW_DAYS = 30;
export const COVER_BUCKET_KEYS = ["0-30", "31-60", "61-90", "91-120", ">120"];
export const MAX_INVENTORY_COVER_ITEMS = 8000;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function moneyRound(value) {
  return Math.round(toNumber(value));
}

export function normCat(value) {
  return String(value || "").trim().toLowerCase();
}

/** Inclusive window start for a trailing dayCount ending on endYmd. */
export function trailingWindowStart(endYmd, dayCount = COVER_WINDOW_DAYS) {
  const [y, m, d] = String(endYmd || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d - (Math.max(1, dayCount) - 1)));
  return dt.toISOString().slice(0, 10);
}

/**
 * Forward cover / days on hand from stock vs sales pace over a fixed window.
 * stock ÷ (windowSales ÷ windowDays)
 */
export function forwardCoverDays(stock, windowSales, windowDays = COVER_WINDOW_DAYS) {
  const stockN = moneyRound(stock);
  const salesN = moneyRound(windowSales);
  const days = Math.max(1, Number(windowDays) || COVER_WINDOW_DAYS);
  if (!Number.isFinite(stockN) || !salesN) return null;
  return Math.round(stockN / (salesN / days));
}

export function emptyBucketAmounts() {
  return Object.fromEntries(COVER_BUCKET_KEYS.map((key) => [key, 0]));
}

/** Assign a cover-day value to AR-style bands: 0-30, 31-60, 61-90, 91-120, >120. */
export function assignCoverBucket(days) {
  if (days == null || !Number.isFinite(Number(days))) return null;
  const d = Number(days);
  if (d < 0) return null;
  if (d <= 30) return "0-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  if (d <= 120) return "91-120";
  return ">120";
}

/** Place the full stock amount into the single band matching category/item cover. */
export function bucketAmountsFromCover(stockAmount, days) {
  const amounts = emptyBucketAmounts();
  const key = assignCoverBucket(days);
  if (key) amounts[key] = moneyRound(stockAmount);
  return amounts;
}

/**
 * Stock SAR for cover bands: uploaded closing value first, else qty × sales unit rate
 * (sales_amount ÷ qty — same unit as EOD qty), else qty × catalogue wholesale.
 * Catalogue pack rates must not win over piece-level sales rates.
 */
export function resolveItemStockValue({
  qty = 0,
  uploadedValue = 0,
  unitRate = 0,
  salesUnitRate = 0,
} = {}) {
  const uploaded = toNumber(uploadedValue);
  if (uploaded > 0) return moneyRound(uploaded);
  const q = toNumber(qty);
  const salesRate = toNumber(salesUnitRate);
  if (q > 0 && salesRate > 0) return moneyRound(q * salesRate);
  const rate = toNumber(unitRate);
  if (q > 0 && rate > 0) return moneyRound(q * rate);
  return 0;
}

function addBucketAmount(target, key, amount) {
  if (!key || !Object.prototype.hasOwnProperty.call(target, key)) return;
  target[key] = moneyRound(toNumber(target[key]) + moneyRound(amount));
}

function mapGet(mapOrObj, code) {
  if (!mapOrObj) return 0;
  if (typeof mapOrObj.get === "function") return toNumber(mapOrObj.get(code));
  return toNumber(mapOrObj[code]);
}

export function buildItemCoverRows(stockRows = [], {
  sales30dByItem = null,
  rateByItem = null,
  salesRateByItem = null,
  categoryByItem = null,
} = {}) {
  const catGet = (code) => {
    if (!categoryByItem) return "";
    if (typeof categoryByItem.get === "function") return String(categoryByItem.get(code) || "").trim();
    return String(categoryByItem[code] || "").trim();
  };

  const rows = [];
  for (const row of stockRows || []) {
    const itemCode = String(row.itemCode || row.item_code || "").trim().toUpperCase();
    if (!itemCode) continue;
    const qty = toNumber(row.qty ?? row.total ?? 0);
    const uploadedValue = toNumber(row.uploadedValue ?? row.value ?? 0);
    const amount = resolveItemStockValue({
      qty,
      uploadedValue,
      salesUnitRate: mapGet(salesRateByItem, itemCode),
      unitRate: mapGet(rateByItem, itemCode),
    });
    if (!amount) continue;
    const sales30d = moneyRound(mapGet(sales30dByItem, itemCode));
    const days = forwardCoverDays(amount, sales30d, COVER_WINDOW_DAYS);
    const bucket = assignCoverBucket(days);
    const category = String(row.category || catGet(itemCode) || "").trim() || "(blank)";
    rows.push({
      itemCode,
      itemName: String(row.itemName || row.item_name || itemCode).trim() || itemCode,
      category,
      qty: Math.round(qty * 1000) / 1000,
      amount,
      sales30d,
      forwardCoverDays: days,
      bucket,
      bucketAmounts: bucketAmountsFromCover(amount, days),
    });
  }
  rows.sort((a, b) => b.amount - a.amount || a.itemCode.localeCompare(b.itemCode));
  return rows;
}

export function rollCategoriesFromItems(items = []) {
  const byCat = new Map();
  for (const item of items || []) {
    const label = String(item.category || "").trim() || "(blank)";
    const key = normCat(label);
    const entry = byCat.get(key) || {
      category: label,
      amount: 0,
      sales30d: 0,
      bucketAmounts: emptyBucketAmounts(),
      itemCount: 0,
    };
    entry.amount = moneyRound(entry.amount + moneyRound(item.amount));
    entry.sales30d = moneyRound(entry.sales30d + moneyRound(item.sales30d));
    entry.itemCount += 1;
    if (item.bucket) addBucketAmount(entry.bucketAmounts, item.bucket, item.amount);
    if (entry.category === "(blank)" && label !== "(blank)") entry.category = label;
    byCat.set(key, entry);
  }

  return [...byCat.values()]
    .map((row) => {
      const days = forwardCoverDays(row.amount, row.sales30d, COVER_WINDOW_DAYS);
      return {
        category: row.category,
        amount: row.amount,
        sales30d: row.sales30d,
        days,
        forwardCoverDays: days,
        bucketAmounts: { ...row.bucketAmounts },
        itemCount: row.itemCount,
      };
    })
    .filter((row) => row.amount)
    .sort((a, b) => b.amount - a.amount);
}

export function enrichPhysicalCategoriesWithBuckets(categories = []) {
  return (categories || []).map((row) => {
    const amount = moneyRound(row.amount);
    const days = row.forwardCoverDays != null
      ? row.forwardCoverDays
      : row.days != null
        ? row.days
        : forwardCoverDays(amount, row.sales30d, COVER_WINDOW_DAYS);
    return {
      ...row,
      amount,
      days,
      forwardCoverDays: days,
      bucketAmounts: row.bucketAmounts && typeof row.bucketAmounts === "object"
        ? { ...emptyBucketAmounts(), ...row.bucketAmounts }
        : bucketAmountsFromCover(amount, days),
    };
  });
}

export function sumBucketAmounts(rows = []) {
  const totals = emptyBucketAmounts();
  for (const row of rows || []) {
    const buckets = row.bucketAmounts || emptyBucketAmounts();
    for (const key of COVER_BUCKET_KEYS) {
      addBucketAmount(totals, key, buckets[key]);
    }
  }
  return totals;
}

export function buildInventoryCoverModel({
  source = "physical",
  stockDate = null,
  items = null,
  categories = null,
  physical = null,
  sales30d = null,
  coverFrom = null,
  coverTo = null,
} = {}) {
  let itemRows = Array.isArray(items) ? items : null;
  let categoryRows;

  if (itemRows && itemRows.length) {
    if (itemRows.length > MAX_INVENTORY_COVER_ITEMS) {
      itemRows = itemRows.slice(0, MAX_INVENTORY_COVER_ITEMS);
    }
    categoryRows = rollCategoriesFromItems(itemRows);
  } else {
    categoryRows = enrichPhysicalCategoriesWithBuckets(categories || []);
    itemRows = [];
  }

  const stockTotal = physical != null && Number.isFinite(Number(physical))
    ? moneyRound(physical)
    : moneyRound(categoryRows.reduce((sum, row) => sum + toNumber(row.amount), 0));
  const salesTotal = sales30d != null && Number.isFinite(Number(sales30d))
    ? moneyRound(sales30d)
    : moneyRound(categoryRows.reduce((sum, row) => sum + toNumber(row.sales30d), 0));
  const days = forwardCoverDays(stockTotal, salesTotal, COVER_WINDOW_DAYS);

  return {
    source: source === "eod" ? "eod" : "physical",
    stockDate: stockDate || null,
    physical: stockTotal,
    sales30d: salesTotal,
    coverWindowDays: COVER_WINDOW_DAYS,
    coverFrom: coverFrom || null,
    coverTo: coverTo || null,
    days,
    forwardCoverDays: days,
    bucketsTotal: sumBucketAmounts(categoryRows),
    categories: categoryRows,
    items: itemRows,
    itemCount: itemRows.length,
    truncated: Array.isArray(items) && items.length > MAX_INVENTORY_COVER_ITEMS,
  };
}
