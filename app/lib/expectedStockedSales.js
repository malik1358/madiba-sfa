/**
 * Expected monthly sales if every qualifying item is in stock.
 * Per item: second-highest completed monthly net sales after excluding
 * company seasonal peak months. Items need lifetime GP% > 10%.
 * Local-product codes (LP*) are excluded.
 */

import { monthKeyFromDateKey, salesDateKey } from "./categoryGrowth.js";
import { normalizeCategoryName, UNCLASSIFIED_CATEGORY } from "./categoryIdentity.js";
import { resolveCanonicalItemCode } from "./itemCodeAliases.js";
import { preferItemDisplayName, normalizeReportItemCode, isDoNotUseItemName } from "./itemReportIdentity.js";
import { getKsaDateString } from "./workdayActivity.js";
import { grossProfitPercent } from "./madibaBrandGp.js";

export const EXPECTED_STOCKED_SALES_SELECT = [
  "transaction_date",
  "item_code",
  "item_name",
  "category",
  "quantity",
  "sales_amount",
  "profit_amount",
].join(",");

export const EXPECTED_STOCKED_SALES_MIN_GP_PERCENT = 10;
export const EXPECTED_STOCKED_SALES_PROFITABLE_GP_PERCENT = 0;
export const EXPECTED_STOCKED_SALES_MAX_SEASON_MONTHS = 3;
export const EXPECTED_STOCKED_SALES_SEASON_LIFT = 1.25;

export const EXPECTED_STOCKED_SALES_ITEM_FILTER_KEYS = [
  "itemCode",
  "itemName",
  "category",
  "mergedFrom",
  "gpPercent",
  "eligibleMonthCount",
  "peakMonth",
  "peakSales",
  "expectedMonth",
  "expectedQty",
  "expectedSales",
  "expectedProfit",
  "expectedGpPercent",
];

export const EXPECTED_STOCKED_SALES_CATEGORY_FILTER_KEYS = [
  "category",
  "itemCount",
  "expectedSales",
  "expectedProfit",
  "expectedGpPercent",
  "sharePercent",
];

function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function roundQty(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return 0;
  return Math.round(qty * 1000) / 1000;
}

function roundPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

export function normalizeExpectedStockedItemCode(value) {
  return normalizeReportItemCode(value);
}

/** Local products (building / local pack) — excluded from this report. */
export function isLocalProductItemCode(value) {
  return /^LP/i.test(normalizeExpectedStockedItemCode(value));
}

/**
 * Pack-count-insensitive product key so old 100pcs gloves match new 70pcs gloves.
 * Explicit PRICE_CODE_ALIASES still win; this catches unnamed successors.
 */
export function expectedStockedItemFamilyKey(name = "") {
  let text = String(name || "").toUpperCase();
  if (!text) return "";
  text = text.replace(/^[A-Z]\d+(?:\/\d+)?_/, "");
  text = text.replace(/DO\s*NOT\s*USE+/g, " ");
  text = text.replace(/\([^)]*\)/g, " ");

  text = text.replace(
    /\bGLOVES?,?\s*CLEAR\s*VINYL,?\s*(XL|S|M|L)\b/g,
    (_, size) => {
      const map = { S: "SMALL", M: "MEDIUM", L: "LARGE", XL: "XL" };
      return `VINYL GLOVES SIZE ${map[size] || size}`;
    },
  );
  text = text.replace(/\bSIZE\s+S\b/g, "SIZE SMALL");
  text = text.replace(/\bSIZE\s+M\b/g, "SIZE MEDIUM");
  text = text.replace(/\bSIZE\s+L\b/g, "SIZE LARGE");

  text = text.replace(
    /\b\d+\s*(?:PCS?|PIECES?|PC|SHEETS?|SHEE|RM|ROLLS?|BOXES?|BAGS?|PACKETS?|PACKS?|CTN|CARTONS?|TRAYS?|SHR(?:INK)?|MTRS?|GM|KG|LTR|ML)\b/g,
    " ",
  );
  text = text.replace(/\b\d+\s*[X×]\s*\d+(?:\s*[X×]\s*\d+)*\b/g, " ");
  text = text.replace(/\b(?:TRANSPARENT|CLEAR|COLOU?R|BOXES?|BOX|CARTONS?|CARTON|CTN|PACKS?|PACKETS?|BAGS?|TRAYS?|SHRINK)\b/g, " ");
  text = text.replace(/[^A-Z0-9"]+/g, " ").trim().replace(/\s+/g, " ");
  return text;
}

function stripOptionalBrandPrefix(key = "") {
  return String(key || "").replace(/^(?:MADIBA|OMNIA|PAPERLINE|GOLDEN\s+STAR)\s+/i, "").trim();
}

export function expectedStockedFamilyKeysMatch(left = "", right = "") {
  const rawA = String(left || "").trim();
  const rawB = String(right || "").trim();
  if (!rawA || !rawB) return false;
  const a = stripOptionalBrandPrefix(rawA);
  const b = stripOptionalBrandPrefix(rawB);
  if (!a || !b) return false;
  if (a === b || rawA === rawB) return true;
  if (a.length < 12 || b.length < 12) return false;
  return a.endsWith(` ${b}`) || b.endsWith(` ${a}`) || a.endsWith(b) || b.endsWith(a)
    || rawA.endsWith(` ${rawB}`) || rawB.endsWith(` ${rawA}`) || rawA.endsWith(rawB) || rawB.endsWith(rawA);
}

export function currentIncompleteMonthKey(now = new Date()) {
  return getKsaDateString(now).slice(0, 7);
}

/**
 * Calendar months (MM) whose completed year-months are the company seasonal peaks.
 * Peaks = up to 3 completed months with sales ≥ median × lift, then those MM codes.
 */
export function detectSeasonalCalendarMonths(companyMonthlySales = [], {
  maxSeasonMonths = EXPECTED_STOCKED_SALES_MAX_SEASON_MONTHS,
  seasonLift = EXPECTED_STOCKED_SALES_SEASON_LIFT,
  incompleteMonth = "",
} = {}) {
  const months = (companyMonthlySales || [])
    .map((row) => ({
      month: String(row?.month || "").slice(0, 7),
      sales: Number(row?.sales || 0),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month)
      && row.month !== incompleteMonth
      && Number.isFinite(row.sales));

  if (!months.length) {
    return {
      calendarMonths: [],
      peakYearMonths: [],
      medianSales: 0,
    };
  }

  const sortedSales = months.map((row) => row.sales).sort((a, b) => a - b);
  const mid = Math.floor(sortedSales.length / 2);
  const medianSales = sortedSales.length % 2 === 0
    ? (sortedSales[mid - 1] + sortedSales[mid]) / 2
    : sortedSales[mid];
  const threshold = medianSales * Number(seasonLift || EXPECTED_STOCKED_SALES_SEASON_LIFT);

  const peakYearMonths = [...months]
    .sort((a, b) => b.sales - a.sales || b.month.localeCompare(a.month))
    .filter((row) => row.sales >= threshold)
    .slice(0, Math.max(0, Math.floor(Number(maxSeasonMonths) || 0)))
    .map((row) => row.month);

  const calendarMonths = [...new Set(peakYearMonths.map((month) => month.slice(5, 7)))]
    .sort((a, b) => a.localeCompare(b));

  return {
    calendarMonths,
    peakYearMonths,
    medianSales: roundMoney(medianSales),
  };
}

export function isSeasonalMonthKey(monthKey, seasonalCalendarMonths = []) {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const cal = month.slice(5, 7);
  return (seasonalCalendarMonths || []).includes(cal);
}

/**
 * Second-highest monthly sales among eligible months.
 * One month only → that month. None → null.
 */
export function pickSecondHighestMonth(monthlyRows = []) {
  const rows = (monthlyRows || [])
    .map((row) => ({
      month: String(row?.month || "").slice(0, 7),
      sales: roundMoney(row?.sales),
      profit: roundMoney(row?.profit),
      qty: roundQty(row?.qty),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && Number.isFinite(row.sales))
    .sort((a, b) => b.sales - a.sales || b.month.localeCompare(a.month));

  if (!rows.length) return null;
  const pick = (row) => ({
    expectedMonth: row.month,
    expectedSales: row.sales,
    expectedProfit: row.profit,
    expectedQty: row.qty,
    expectedGpPercent: roundPercent(grossProfitPercent(row.sales, row.profit)),
  });
  if (rows.length === 1) {
    return {
      ...pick(rows[0]),
      peakMonth: rows[0].month,
      peakSales: rows[0].sales,
      eligibleMonthCount: 1,
    };
  }
  return {
    ...pick(rows[1]),
    peakMonth: rows[0].month,
    peakSales: rows[0].sales,
    eligibleMonthCount: rows.length,
  };
}

function emptyItemBucket(itemCode) {
  return {
    itemCode,
    itemName: "",
    category: UNCLASSIFIED_CATEGORY,
    lifeSales: 0,
    lifeProfit: 0,
    lastSaleDate: "",
    sourceCodes: new Set([itemCode]),
    months: new Map(),
  };
}

function mergeItemBucketInto(target, source) {
  if (!target || !source || target === source) return target;
  target.itemName = preferItemDisplayName(target.itemName, source.itemName, target.itemCode);
  if ((!target.category || target.category === UNCLASSIFIED_CATEGORY)
    && source.category
    && source.category !== UNCLASSIFIED_CATEGORY) {
    target.category = source.category;
  }
  target.lifeSales += Number(source.lifeSales || 0);
  target.lifeProfit += Number(source.lifeProfit || 0);
  if (source.lastSaleDate && (!target.lastSaleDate || source.lastSaleDate > target.lastSaleDate)) {
    target.lastSaleDate = source.lastSaleDate;
  }
  (source.sourceCodes || []).forEach((code) => target.sourceCodes.add(code));
  source.months.forEach((monthRow, month) => {
    const existing = target.months.get(month) || { month, sales: 0, profit: 0, qty: 0 };
    existing.sales += Number(monthRow.sales || 0);
    existing.profit += Number(monthRow.profit || 0);
    existing.qty += Number(monthRow.qty || 0);
    target.months.set(month, existing);
  });
  return target;
}

function preferLiveItemBucket(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftDnu = isDoNotUseItemName(left?.itemName);
  const rightDnu = isDoNotUseItemName(right?.itemName);
  if (leftDnu && !rightDnu) return right;
  if (!leftDnu && rightDnu) return left;
  const leftLast = String(left?.lastSaleDate || "");
  const rightLast = String(right?.lastSaleDate || "");
  if (leftLast !== rightLast) return leftLast > rightLast ? left : right;
  return String(left?.itemCode || "").localeCompare(String(right?.itemCode || "")) >= 0 ? left : right;
}

/**
 * Collapse replacement codes into one bucket (aliases + pack-changed name families).
 */
export function collapseExpectedStockedItemBuckets(byItem = new Map()) {
  const working = new Map();
  (byItem || new Map()).forEach((bucket, code) => {
    const copy = emptyItemBucket(code);
    mergeItemBucketInto(copy, bucket);
    working.set(code, copy);
  });
  if (working.size <= 1) return working;

  const parent = new Map();
  function find(code) {
    const key = normalizeExpectedStockedItemCode(code);
    if (!parent.has(key)) parent.set(key, key);
    const root = parent.get(key);
    if (root !== key) {
      const resolved = find(root);
      parent.set(key, resolved);
      return resolved;
    }
    return key;
  }
  function union(a, b) {
    const left = find(a);
    const right = find(b);
    if (left === right) return;
    const keep = preferLiveItemBucket(working.get(left), working.get(right));
    const dropCode = keep.itemCode === left ? right : left;
    parent.set(dropCode, keep.itemCode);
  }

  // Known replacement families (PRICE_CODE_ALIASES) — already canonicalized on ingest,
  // but keep this for any residual source codes still present as separate buckets.
  [...working.keys()].forEach((code) => {
    const canonical = resolveCanonicalItemCode(code);
    if (!canonical || canonical === code) return;
    if (!working.has(canonical)) {
      const moved = emptyItemBucket(canonical);
      mergeItemBucketInto(moved, working.get(code));
      working.set(canonical, moved);
      working.delete(code);
      parent.set(code, canonical);
      parent.set(canonical, canonical);
      return;
    }
    union(canonical, code);
  });

  // Pack-changed / renamed successors that share a family key.
  const keyed = [...working.values()]
    .map((bucket) => ({
      code: bucket.itemCode,
      key: expectedStockedItemFamilyKey(bucket.itemName),
    }))
    .filter((entry) => entry.key);

  for (let i = 0; i < keyed.length; i += 1) {
    for (let j = i + 1; j < keyed.length; j += 1) {
      if (!expectedStockedFamilyKeysMatch(keyed[i].key, keyed[j].key)) continue;
      union(keyed[i].code, keyed[j].code);
    }
  }

  const merged = new Map();
  working.forEach((bucket, code) => {
    const root = find(code);
    let target = merged.get(root);
    if (!target) {
      target = emptyItemBucket(root);
      merged.set(root, target);
    }
    mergeItemBucketInto(target, bucket);
    target.itemCode = root;
  });
  return merged;
}

/**
 * Aggregate active_sales lines into per-item lifetime totals and monthly nets.
 * Replacement item codes (aliases / pack changes) are collapsed so history is not double-counted.
 */
export function aggregateExpectedStockedSalesLines(rows = [], { incompleteMonth = "" } = {}) {
  const byItem = new Map();
  let firstDate = "";
  let lastDate = "";
  let sourceRowCount = 0;

  (rows || []).forEach((row) => {
    const rawCode = normalizeExpectedStockedItemCode(row?.item_code || row?.itemCode);
    if (!rawCode || isLocalProductItemCode(rawCode)) return;
    const itemCode = resolveCanonicalItemCode(rawCode) || rawCode;
    const dateKey = salesDateKey(row?.transaction_date);
    const month = monthKeyFromDateKey(dateKey);
    if (!month || month === incompleteMonth) return;

    const sales = Number(row?.sales_amount ?? row?.salesAmount);
    const profit = Number(row?.profit_amount ?? row?.profitAmount);
    const qty = Number(row?.quantity);
    if (!Number.isFinite(sales) && !Number.isFinite(profit) && !Number.isFinite(qty)) return;

    sourceRowCount += 1;
    if (!firstDate || dateKey < firstDate) firstDate = dateKey;
    if (!lastDate || dateKey > lastDate) lastDate = dateKey;

    let bucket = byItem.get(itemCode);
    if (!bucket) {
      bucket = emptyItemBucket(itemCode);
      byItem.set(itemCode, bucket);
    }
    bucket.sourceCodes.add(rawCode);
    bucket.itemName = preferItemDisplayName(bucket.itemName, row?.item_name || row?.itemName, itemCode);
    const category = normalizeCategoryName(row?.category);
    if (category && category !== UNCLASSIFIED_CATEGORY) bucket.category = category;
    if (!bucket.lastSaleDate || dateKey > bucket.lastSaleDate) bucket.lastSaleDate = dateKey;

    const safeSales = Number.isFinite(sales) ? sales : 0;
    const safeProfit = Number.isFinite(profit) ? profit : 0;
    const safeQty = Number.isFinite(qty) ? qty : 0;
    bucket.lifeSales += safeSales;
    bucket.lifeProfit += safeProfit;

    const monthRow = bucket.months.get(month) || { month, sales: 0, profit: 0, qty: 0 };
    monthRow.sales += safeSales;
    monthRow.profit += safeProfit;
    monthRow.qty += safeQty;
    bucket.months.set(month, monthRow);
  });

  const collapsed = collapseExpectedStockedItemBuckets(byItem);
  return { byItem: collapsed, firstDate, lastDate, sourceRowCount };
}

function buildCohortFromBuckets(byItem, {
  seasonCalendarMonths = [],
  minGpPercent = EXPECTED_STOCKED_SALES_MIN_GP_PERCENT,
} = {}) {
  const itemRows = [];
  byItem.forEach((bucket) => {
    const gpPercent = grossProfitPercent(bucket.lifeSales, bucket.lifeProfit);
    if (gpPercent == null || gpPercent <= Number(minGpPercent)) return;

    const eligibleMonths = [...bucket.months.values()]
      .filter((monthRow) => !isSeasonalMonthKey(monthRow.month, seasonCalendarMonths))
      .map((monthRow) => ({
        month: monthRow.month,
        sales: roundMoney(monthRow.sales),
        profit: roundMoney(monthRow.profit),
        qty: roundQty(monthRow.qty),
      }));
    const picked = pickSecondHighestMonth(eligibleMonths);
    if (!picked || !(picked.expectedSales > 0)) return;

    const mergedFrom = [...(bucket.sourceCodes || [])]
      .map((code) => normalizeExpectedStockedItemCode(code))
      .filter((code) => code && code !== bucket.itemCode)
      .sort((a, b) => a.localeCompare(b));

    itemRows.push({
      itemCode: bucket.itemCode,
      itemName: bucket.itemName || bucket.itemCode,
      category: bucket.category || UNCLASSIFIED_CATEGORY,
      mergedFrom: mergedFrom.join(", "),
      gpPercent: roundPercent(gpPercent),
      lifeSales: roundMoney(bucket.lifeSales),
      lifeProfit: roundMoney(bucket.lifeProfit),
      eligibleMonthCount: picked.eligibleMonthCount,
      peakMonth: picked.peakMonth,
      peakSales: picked.peakSales,
      expectedMonth: picked.expectedMonth,
      expectedQty: picked.expectedQty,
      expectedSales: picked.expectedSales,
      expectedProfit: picked.expectedProfit,
      expectedGpPercent: picked.expectedGpPercent,
    });
  });

  itemRows.sort((a, b) => b.expectedSales - a.expectedSales
    || a.itemCode.localeCompare(b.itemCode));

  const totalExpectedSales = roundMoney(
    itemRows.reduce((sum, row) => sum + Number(row.expectedSales || 0), 0),
  );
  const totalExpectedProfit = roundMoney(
    itemRows.reduce((sum, row) => sum + Number(row.expectedProfit || 0), 0),
  );

  const categoryMap = new Map();
  itemRows.forEach((row) => {
    const key = row.category || UNCLASSIFIED_CATEGORY;
    const existing = categoryMap.get(key) || {
      category: key,
      itemCount: 0,
      expectedSales: 0,
      expectedProfit: 0,
    };
    existing.itemCount += 1;
    existing.expectedSales += Number(row.expectedSales || 0);
    existing.expectedProfit += Number(row.expectedProfit || 0);
    categoryMap.set(key, existing);
  });

  const categoryRows = [...categoryMap.values()]
    .map((row) => ({
      category: row.category,
      itemCount: row.itemCount,
      expectedSales: roundMoney(row.expectedSales),
      expectedProfit: roundMoney(row.expectedProfit),
      expectedGpPercent: roundPercent(grossProfitPercent(row.expectedSales, row.expectedProfit)),
      sharePercent: totalExpectedSales > 0
        ? roundPercent((row.expectedSales / totalExpectedSales) * 100)
        : 0,
    }))
    .sort((a, b) => b.expectedSales - a.expectedSales || a.category.localeCompare(b.category));

  return {
    minGpPercent: Number(minGpPercent),
    rows: itemRows,
    categoryRows,
    summary: {
      itemCount: itemRows.length,
      categoryCount: categoryRows.length,
      expectedSales: totalExpectedSales,
      expectedProfit: totalExpectedProfit,
      expectedGpPercent: roundPercent(grossProfitPercent(totalExpectedSales, totalExpectedProfit)),
    },
  };
}

export function buildExpectedStockedSalesReport(rows = [], {
  now = new Date(),
  minGpPercent = EXPECTED_STOCKED_SALES_MIN_GP_PERCENT,
  maxSeasonMonths = EXPECTED_STOCKED_SALES_MAX_SEASON_MONTHS,
  seasonLift = EXPECTED_STOCKED_SALES_SEASON_LIFT,
} = {}) {
  const incompleteMonth = currentIncompleteMonthKey(now);
  const { byItem, firstDate, lastDate, sourceRowCount } = aggregateExpectedStockedSalesLines(rows, {
    incompleteMonth,
  });

  const companyMonthly = new Map();
  byItem.forEach((bucket) => {
    bucket.months.forEach((monthRow) => {
      companyMonthly.set(
        monthRow.month,
        (companyMonthly.get(monthRow.month) || 0) + monthRow.sales,
      );
    });
  });
  const companyMonthlySales = [...companyMonthly.entries()]
    .map(([month, sales]) => ({ month, sales: roundMoney(sales) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const season = detectSeasonalCalendarMonths(companyMonthlySales, {
    maxSeasonMonths,
    seasonLift,
    incompleteMonth,
  });

  const primary = buildCohortFromBuckets(byItem, {
    seasonCalendarMonths: season.calendarMonths,
    minGpPercent,
  });
  const profitable = buildCohortFromBuckets(byItem, {
    seasonCalendarMonths: season.calendarMonths,
    minGpPercent: EXPECTED_STOCKED_SALES_PROFITABLE_GP_PERCENT,
  });

  return {
    asOfDate: getKsaDateString(now),
    incompleteMonth,
    span: { firstDate, lastDate },
    sourceRowCount,
    season: {
      calendarMonths: season.calendarMonths,
      peakYearMonths: season.peakYearMonths,
      medianSales: season.medianSales,
      lift: Number(seasonLift),
    },
    minGpPercent: primary.minGpPercent,
    rows: primary.rows,
    categoryRows: primary.categoryRows,
    summary: primary.summary,
    profitableMinGpPercent: profitable.minGpPercent,
    profitableRows: profitable.rows,
    profitableCategoryRows: profitable.categoryRows,
    profitableSummary: profitable.summary,
  };
}
