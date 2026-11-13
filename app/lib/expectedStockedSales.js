/**
 * Expected monthly sales if every qualifying item is in stock.
 * Per item: second-highest completed monthly net sales after excluding
 * company seasonal peak months. Items need lifetime GP% > 10%.
 * Local-product codes (LP*) are excluded.
 */

import { monthKeyFromDateKey, salesDateKey } from "./categoryGrowth.js";
import { normalizeCategoryName, UNCLASSIFIED_CATEGORY } from "./categoryIdentity.js";
import { preferItemDisplayName, normalizeReportItemCode } from "./itemReportIdentity.js";
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
export const EXPECTED_STOCKED_SALES_MAX_SEASON_MONTHS = 3;
export const EXPECTED_STOCKED_SALES_SEASON_LIFT = 1.25;

export const EXPECTED_STOCKED_SALES_ITEM_FILTER_KEYS = [
  "itemCode",
  "itemName",
  "category",
  "gpPercent",
  "eligibleMonthCount",
  "peakMonth",
  "peakSales",
  "expectedMonth",
  "expectedQty",
  "expectedSales",
];

export const EXPECTED_STOCKED_SALES_CATEGORY_FILTER_KEYS = [
  "category",
  "itemCount",
  "expectedSales",
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
      qty: roundQty(row?.qty),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && Number.isFinite(row.sales))
    .sort((a, b) => b.sales - a.sales || b.month.localeCompare(a.month));

  if (!rows.length) return null;
  if (rows.length === 1) {
    return {
      expectedMonth: rows[0].month,
      expectedSales: rows[0].sales,
      expectedQty: rows[0].qty,
      peakMonth: rows[0].month,
      peakSales: rows[0].sales,
      eligibleMonthCount: 1,
    };
  }
  return {
    expectedMonth: rows[1].month,
    expectedSales: rows[1].sales,
    expectedQty: rows[1].qty,
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
    months: new Map(),
  };
}

/**
 * Aggregate active_sales lines into per-item lifetime totals and monthly nets.
 */
export function aggregateExpectedStockedSalesLines(rows = [], { incompleteMonth = "" } = {}) {
  const byItem = new Map();
  let firstDate = "";
  let lastDate = "";
  let sourceRowCount = 0;

  (rows || []).forEach((row) => {
    const itemCode = normalizeExpectedStockedItemCode(row?.item_code || row?.itemCode);
    if (!itemCode || isLocalProductItemCode(itemCode)) return;
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
    bucket.itemName = preferItemDisplayName(bucket.itemName, row?.item_name || row?.itemName, itemCode);
    const category = normalizeCategoryName(row?.category);
    if (category && category !== UNCLASSIFIED_CATEGORY) bucket.category = category;

    const safeSales = Number.isFinite(sales) ? sales : 0;
    const safeProfit = Number.isFinite(profit) ? profit : 0;
    const safeQty = Number.isFinite(qty) ? qty : 0;
    bucket.lifeSales += safeSales;
    bucket.lifeProfit += safeProfit;

    const monthRow = bucket.months.get(month) || { month, sales: 0, qty: 0 };
    monthRow.sales += safeSales;
    monthRow.qty += safeQty;
    bucket.months.set(month, monthRow);
  });

  return { byItem, firstDate, lastDate, sourceRowCount };
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

  const itemRows = [];
  byItem.forEach((bucket) => {
    const gpPercent = grossProfitPercent(bucket.lifeSales, bucket.lifeProfit);
    if (gpPercent == null || gpPercent <= Number(minGpPercent)) return;

    const eligibleMonths = [...bucket.months.values()]
      .filter((monthRow) => !isSeasonalMonthKey(monthRow.month, season.calendarMonths))
      .map((monthRow) => ({
        month: monthRow.month,
        sales: roundMoney(monthRow.sales),
        qty: roundQty(monthRow.qty),
      }));
    const picked = pickSecondHighestMonth(eligibleMonths);
    if (!picked || !(picked.expectedSales > 0)) return;

    itemRows.push({
      itemCode: bucket.itemCode,
      itemName: bucket.itemName || bucket.itemCode,
      category: bucket.category || UNCLASSIFIED_CATEGORY,
      gpPercent: roundPercent(gpPercent),
      lifeSales: roundMoney(bucket.lifeSales),
      lifeProfit: roundMoney(bucket.lifeProfit),
      eligibleMonthCount: picked.eligibleMonthCount,
      peakMonth: picked.peakMonth,
      peakSales: picked.peakSales,
      expectedMonth: picked.expectedMonth,
      expectedQty: picked.expectedQty,
      expectedSales: picked.expectedSales,
    });
  });

  itemRows.sort((a, b) => b.expectedSales - a.expectedSales
    || a.itemCode.localeCompare(b.itemCode));

  const totalExpectedSales = roundMoney(
    itemRows.reduce((sum, row) => sum + Number(row.expectedSales || 0), 0),
  );

  const categoryMap = new Map();
  itemRows.forEach((row) => {
    const key = row.category || UNCLASSIFIED_CATEGORY;
    const existing = categoryMap.get(key) || {
      category: key,
      itemCount: 0,
      expectedSales: 0,
    };
    existing.itemCount += 1;
    existing.expectedSales += Number(row.expectedSales || 0);
    categoryMap.set(key, existing);
  });

  const categoryRows = [...categoryMap.values()]
    .map((row) => ({
      category: row.category,
      itemCount: row.itemCount,
      expectedSales: roundMoney(row.expectedSales),
      sharePercent: totalExpectedSales > 0
        ? roundPercent((row.expectedSales / totalExpectedSales) * 100)
        : 0,
    }))
    .sort((a, b) => b.expectedSales - a.expectedSales || a.category.localeCompare(b.category));

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
    minGpPercent: Number(minGpPercent),
    rows: itemRows,
    categoryRows,
    summary: {
      itemCount: itemRows.length,
      categoryCount: categoryRows.length,
      expectedSales: totalExpectedSales,
    },
  };
}
