/**
 * Live Management MIS (month-end style pack) from sales, receipts, and outstanding.
 * Repeat sale = line where the customer bought the same item name in an earlier month.
 * New / repeat customers = first-ever purchase month vs prior buyers who purchased again.
 */

import { receivableDays, receivableYtdDays } from "./receivableDays.js";

const PORTFOLIO_EXCLUDE = new Set([
  "electronics",
  "building material",
  "office supplies",
  "stationery",
  "stationary",
]);

const MADIBA_FOCUS = new Set(["sundry", "personal care", "fragrance", "baby care"]);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function monthKey(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : "";
}

function lastDayOfMonth(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return "";
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Inclusive window start for a trailing dayCount ending on endYmd. */
function trailingWindowStart(endYmd, dayCount = 30) {
  const [y, m, d] = String(endYmd || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d - (Math.max(1, dayCount) - 1)));
  return dt.toISOString().slice(0, 10);
}

/**
 * Forward cover / days on hand from stock vs sales pace over a fixed window.
 * stock ÷ (windowSales ÷ windowDays)
 */
function forwardCoverDays(stock, windowSales, windowDays = 30) {
  const stockN = moneyRound(stock);
  const salesN = moneyRound(windowSales);
  const days = Math.max(1, Number(windowDays) || 30);
  if (!Number.isFinite(stockN) || !salesN) return null;
  return Math.round(stockN / (salesN / days));
}

function normCat(value) {
  return String(value || "").trim().toLowerCase();
}

function moneyRound(value) {
  return Math.round(toNumber(value));
}

function pctChange(current, previous) {
  const cur = toNumber(current);
  const prev = toNumber(previous);
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur / prev) - 1) * 1000) / 10;
}

function gpPct(sales, gp) {
  const s = toNumber(sales);
  if (!s) return 0;
  return Math.round((toNumber(gp) / s) * 1000) / 10;
}

function listMonthsThrough(asOfYm) {
  const [year, month] = String(asOfYm).split("-").map(Number);
  const out = [];
  for (let m = 1; m <= month; m += 1) {
    out.push(`${year}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

function quarterKey(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return "";
  const q = Math.ceil(m / 3);
  return `Q${q}_${String(y).slice(2)}`;
}

/**
 * @param {object} input
 * @param {Array<object>} input.salesRows
 * @param {Array<object>} input.receiptRows
 * @param {Array<object>} input.outstandingRows
 * @param {string} input.asOfDate YYYY-MM-DD
 * @param {number|null} [input.inventoryPhysical]
 */
export function buildMisReport({
  salesRows = [],
  receiptRows = [],
  outstandingRows = [],
  asOfDate,
  inventoryPhysical = null,
  /** Optional prior outstanding snapshot for MoM on AR / collection days. */
  priorOutstanding = null,
} = {}) {
  const asOf = String(asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOfDate must be YYYY-MM-DD");
  }
  const asOfYm = asOf.slice(0, 7);
  const year = asOfYm.slice(0, 4);
  const months = listMonthsThrough(asOfYm);
  const prevYm = months.length > 1 ? months[months.length - 2] : null;

  const firstCustomer = new Map();
  const firstItem = new Map();
  for (const row of salesRows) {
    const amount = toNumber(row.sales_amount);
    if (amount <= 0) continue;
    const customer = String(row.customer_code || "").trim();
    const day = String(row.transaction_date || "").slice(0, 10);
    if (!customer || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const prev = firstCustomer.get(customer);
    if (!prev || day < prev) firstCustomer.set(customer, day);
    const item = String(row.item_name || "").trim().toLowerCase();
    if (!item) continue;
    const key = `${customer}||${item}`;
    const prevItem = firstItem.get(key);
    if (!prevItem || day < prevItem) firstItem.set(key, day);
  }

  const monthly = Object.fromEntries(months.map((ym) => [ym, {
    sales: 0,
    gp: 0,
    newSales: 0,
    repeatSales: 0,
    newCustomers: new Set(),
    repeatCustomers: new Set(),
  }]));

  const categoryByPeriod = new Map();
  const salesmanByPeriod = new Map();
  const madibaByPeriod = new Map();
  const monthlyMadibaSales = Object.fromEntries(months.map((ym) => [ym, 0]));
  const monthlyMadibaByCategory = Object.fromEntries(months.map((ym) => [ym, {
    Sundry: 0,
    "Personal Care": 0,
    Fragrance: 0,
    "Baby Care": 0,
  }]));
  const portfolioMonthly = Object.fromEntries(months.map((ym) => [ym, {
    sales: 0,
    gp: 0,
    skus: new Set(),
    customers: new Set(),
  }]));

  for (const row of salesRows) {
    const day = String(row.transaction_date || "").slice(0, 10);
    const ym = monthKey(day);
    if (!ym || !ym.startsWith(year) || ym > asOfYm) continue;
    const amount = toNumber(row.sales_amount);
    const profit = toNumber(row.profit_amount);
    const bucket = monthly[ym];
    if (!bucket) continue;
    bucket.sales += amount;
    bucket.gp += profit;

    const customer = String(row.customer_code || "").trim();
    const item = String(row.item_name || "").trim().toLowerCase();
    const custFirst = customer ? firstCustomer.get(customer) : null;
    const custFirstYm = monthKey(custFirst);
    if (customer && amount > 0 && custFirstYm) {
      if (custFirstYm === ym) bucket.newCustomers.add(customer);
      else if (custFirstYm < ym) bucket.repeatCustomers.add(customer);
    }
    const itemFirst = customer && item ? firstItem.get(`${customer}||${item}`) : null;
    const itemFirstYm = monthKey(itemFirst);
    if (itemFirstYm && itemFirstYm < ym) bucket.repeatSales += amount;
    else bucket.newSales += amount;

    const cat = String(row.category || "").trim() || "(blank)";
    // Quarter rollups for history + the as-of month as its own column.
    const periodKeys = new Set([quarterKey(ym), ym === asOfYm ? asOfYm : null].filter(Boolean));

    for (const period of periodKeys) {
      const catKey = `${period}||${cat}`;
      const catRow = categoryByPeriod.get(catKey) || { period, category: cat, sales: 0, gp: 0 };
      catRow.sales += amount;
      catRow.gp += profit;
      categoryByPeriod.set(catKey, catRow);

      const salesman = String(row.salesman_name || row.salesman_code || "?").trim().toUpperCase() || "?";
      const smKey = `${period}||${salesman}`;
      const smRow = salesmanByPeriod.get(smKey) || { period, salesman, sales: 0 };
      smRow.sales += amount;
      salesmanByPeriod.set(smKey, smRow);
    }

    const catNorm = normCat(cat);
    if (!PORTFOLIO_EXCLUDE.has(catNorm) && portfolioMonthly[ym]) {
      portfolioMonthly[ym].sales += amount;
      portfolioMonthly[ym].gp += profit;
      if (row.item_code) portfolioMonthly[ym].skus.add(String(row.item_code));
      if (customer && amount > 0) portfolioMonthly[ym].customers.add(customer);
    }

    const itemName = String(row.item_name || "").toLowerCase();
    if (itemName.includes("madiba") && MADIBA_FOCUS.has(catNorm)) {
      const focus = catNorm === "personal care" ? "Personal Care"
        : catNorm === "baby care" ? "Baby Care"
          : catNorm === "fragrance" ? "Fragrance"
            : "Sundry";
      if (monthlyMadibaSales[ym] != null) {
        monthlyMadibaSales[ym] += amount;
        monthlyMadibaByCategory[ym][focus] += amount;
      }
      for (const period of periodKeys) {
        const key = `${period}||${focus}`;
        const focusRow = madibaByPeriod.get(key) || { period, category: focus, sales: 0, gp: 0 };
        focusRow.sales += amount;
        focusRow.gp += profit;
        madibaByPeriod.set(key, focusRow);
      }
    }
  }

  const monthlySales = {};
  const monthlyGp = {};
  const monthlyRepeat = {};
  for (const ym of months) {
    const row = monthly[ym];
    monthlySales[ym] = moneyRound(row.sales);
    monthlyGp[ym] = moneyRound(row.gp);
    monthlyRepeat[ym] = {
      sales: moneyRound(row.repeatSales),
      pct: gpPct(row.sales, row.repeatSales),
      newCustomers: row.newCustomers.size,
      repeatCustomers: row.repeatCustomers.size,
    };
  }

  const collections = {};
  for (const ym of months) collections[ym] = 0;
  for (const row of receiptRows) {
    const ym = monthKey(row.receipt_date);
    if (!ym || !Object.prototype.hasOwnProperty.call(collections, ym)) continue;
    const vch = String(row.vch_type || "").toLowerCase();
    if (!vch.includes("receipt")) continue;
    if (!String(row.customer_code || "").trim()) continue;
    collections[ym] += toNumber(row.amount);
  }
  for (const ym of months) collections[ym] = moneyRound(collections[ym]);

  let totalAr = 0;
  let gt90 = 0;
  const arBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "91-120": 0, ">120": 0 };
  for (const row of outstandingRows) {
    const total = toNumber(row.total_outstanding ?? row.totalOutstanding);
    totalAr += total;
    const buckets = row.buckets || {};
    for (const key of Object.keys(arBuckets)) {
      arBuckets[key] += toNumber(buckets[key]);
    }
    gt90 += toNumber(buckets["91-120"]) + toNumber(buckets[">120"]);
  }

  const cur = monthly[asOfYm];
  const prev = prevYm ? monthly[prevYm] : null;
  const curSales = moneyRound(cur.sales);
  const prevSales = prev ? moneyRound(prev.sales) : 0;
  const curGp = moneyRound(cur.gp);
  const prevGp = prev ? moneyRound(prev.gp) : 0;
  const ytdSales = moneyRound(months.reduce((sum, ym) => sum + monthly[ym].sales, 0));
  const previousYtdSales = moneyRound(
    months.filter((ym) => prevYm && ym <= prevYm).reduce((sum, ym) => sum + monthly[ym].sales, 0),
  );
  const ytdGp = moneyRound(months.reduce((sum, ym) => sum + monthly[ym].gp, 0));
  const previousYtdGp = moneyRound(
    months.filter((ym) => prevYm && ym <= prevYm).reduce((sum, ym) => sum + monthly[ym].gp, 0),
  );

  // Match BI Net receivable days: (AR ÷ YTD sales) × days YTD — not AR ÷ (month sales / 30).
  const collectionDays = receivableDays(totalAr, ytdSales, receivableYtdDays(asOfYm, asOf));
  const previousCollectionDays = prevYm && priorOutstanding?.totalAr != null
    ? receivableDays(
      priorOutstanding.totalAr,
      previousYtdSales,
      receivableYtdDays(prevYm),
    )
    : null;
  const collectionDaysMomPct = collectionDays != null && previousCollectionDays != null
    ? pctChange(collectionDays, previousCollectionDays)
    : null;

  const FORWARD_COVER_WINDOW_DAYS = 30;
  const coverEnd = asOf;
  const coverStart = trailingWindowStart(coverEnd, FORWARD_COVER_WINDOW_DAYS);
  const prevCoverEnd = prevYm ? lastDayOfMonth(prevYm) : "";
  const prevCoverStart = prevCoverEnd
    ? trailingWindowStart(prevCoverEnd, FORWARD_COVER_WINDOW_DAYS)
    : "";
  let sales30d = 0;
  let previousSales30d = 0;
  const sales30dByCat = new Map();
  for (const row of salesRows) {
    const day = String(row.transaction_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const amount = toNumber(row.sales_amount);
    if (coverStart && day >= coverStart && day <= coverEnd) {
      sales30d += amount;
      const cat = String(row.category || "").trim() || "(blank)";
      const key = normCat(cat);
      sales30dByCat.set(key, (sales30dByCat.get(key) || 0) + amount);
    }
    if (prevCoverStart && day >= prevCoverStart && day <= prevCoverEnd) {
      previousSales30d += amount;
    }
  }
  sales30d = moneyRound(sales30d);
  previousSales30d = moneyRound(previousSales30d);

  const inventoryInput = inventoryPhysical && typeof inventoryPhysical === "object"
    ? inventoryPhysical
    : inventoryPhysical == null
      ? null
      : { physical: inventoryPhysical };
  const inventoryPhysicalAmount = inventoryInput == null
    ? null
    : Number(inventoryInput.physical ?? inventoryInput.amount ?? inventoryInput.total);
  const previousInventoryPhysical = inventoryInput?.previousPhysical != null
    ? Number(inventoryInput.previousPhysical)
    : inventoryInput?.previous?.physical != null
      ? Number(inventoryInput.previous.physical)
      : null;
  // Days on hand / forward cover = stock ÷ (last-30-day sales ÷ 30).
  const inventoryDays = forwardCoverDays(
    inventoryPhysicalAmount,
    sales30d,
    FORWARD_COVER_WINDOW_DAYS,
  );
  const previousInventoryDays = forwardCoverDays(
    previousInventoryPhysical,
    previousSales30d,
    FORWARD_COVER_WINDOW_DAYS,
  );
  const inventoryCategories = inventoryInput?.byCategory && typeof inventoryInput.byCategory === "object"
    ? Object.entries(inventoryInput.byCategory)
      .map(([category, amount]) => {
        const label = String(category || "").trim() || "(blank)";
        const stockAmount = moneyRound(amount);
        const catSales30d = moneyRound(sales30dByCat.get(normCat(label)) || 0);
        const days = forwardCoverDays(stockAmount, catSales30d, FORWARD_COVER_WINDOW_DAYS);
        return {
          category: label,
          amount: stockAmount,
          sales30d: catSales30d,
          days,
          forwardCoverDays: days,
        };
      })
      .filter((row) => row.amount)
      .sort((a, b) => b.amount - a.amount)
    : [];
  const inventory = Number.isFinite(inventoryPhysicalAmount) ? {
    physical: moneyRound(inventoryPhysicalAmount),
    previousPhysical: Number.isFinite(previousInventoryPhysical)
      ? moneyRound(previousInventoryPhysical)
      : null,
    physicalMomPct: Number.isFinite(previousInventoryPhysical)
      ? pctChange(inventoryPhysicalAmount, previousInventoryPhysical)
      : null,
    sales30d,
    previousSales30d: previousSales30d || null,
    coverWindowDays: FORWARD_COVER_WINDOW_DAYS,
    coverFrom: coverStart || null,
    coverTo: coverEnd || null,
    days: inventoryDays,
    previousDays: previousInventoryDays,
    daysMomPct: inventoryDays != null && previousInventoryDays != null
      ? pctChange(inventoryDays, previousInventoryDays)
      : null,
    categories: inventoryCategories,
  } : null;

  const portfolio = {};
  for (const ym of months) {
    const row = portfolioMonthly[ym];
    portfolio[ym] = {
      sales: moneyRound(row.sales),
      gp: moneyRound(row.gp),
      gpPct: gpPct(row.sales, row.gp),
      skus: row.skus.size,
      customers: row.customers.size,
    };
  }

  const categoryRows = [...categoryByPeriod.values()]
    .map((row) => ({
      ...row,
      sales: moneyRound(row.sales),
      gp: moneyRound(row.gp),
    }))
    .sort((a, b) => a.period.localeCompare(b.period) || b.sales - a.sales);

  const salesmanRows = [...salesmanByPeriod.values()]
    .map((row) => ({ ...row, sales: moneyRound(row.sales) }))
    .filter((row) => Math.abs(row.sales) >= 1000)
    .sort((a, b) => a.period.localeCompare(b.period) || b.sales - a.sales);

  const madibaRows = [...madibaByPeriod.values()]
    .map((row) => ({
      ...row,
      sales: moneyRound(row.sales),
      gp: moneyRound(row.gp),
      gpPct: gpPct(row.sales, row.gp),
    }))
    .sort((a, b) => a.period.localeCompare(b.period) || b.sales - a.sales);

  return {
    asOfDate: asOf,
    asOfMonth: asOfYm,
    previousMonth: prevYm,
    months,
    headline: {
      sales: curSales,
      salesMomPct: pctChange(curSales, prevSales),
      gp: curGp,
      gpMomPct: pctChange(curGp, prevGp),
      gpPct: gpPct(curSales, curGp),
      previousSales: prevSales,
      previousGp: prevGp,
      previousGpPct: gpPct(prevSales, prevGp),
      ytdSales,
      previousYtdSales,
      ytdMomPct: pctChange(ytdSales, previousYtdSales),
      ytdGp,
      previousYtdGp,
      ytdGpMomPct: pctChange(ytdGp, previousYtdGp),
      repeatSales: monthlyRepeat[asOfYm].sales,
      repeatPct: monthlyRepeat[asOfYm].pct,
      previousRepeatSales: prevYm ? monthlyRepeat[prevYm].sales : 0,
      previousRepeatPct: prevYm ? monthlyRepeat[prevYm].pct : 0,
      repeatMomPct: pctChange(
        monthlyRepeat[asOfYm].pct,
        prevYm ? monthlyRepeat[prevYm].pct : 0,
      ),
      repeatSalesMomPct: pctChange(
        monthlyRepeat[asOfYm].sales,
        prevYm ? monthlyRepeat[prevYm].sales : 0,
      ),
      newCustomers: monthlyRepeat[asOfYm].newCustomers,
      repeatCustomers: monthlyRepeat[asOfYm].repeatCustomers,
      previousNewCustomers: prevYm ? monthlyRepeat[prevYm].newCustomers : 0,
      previousRepeatCustomers: prevYm ? monthlyRepeat[prevYm].repeatCustomers : 0,
      newCustomersMomPct: pctChange(
        monthlyRepeat[asOfYm].newCustomers,
        prevYm ? monthlyRepeat[prevYm].newCustomers : 0,
      ),
      collection: collections[asOfYm] || 0,
      previousCollection: prevYm ? collections[prevYm] || 0 : 0,
      collectionMomPct: pctChange(collections[asOfYm] || 0, prevYm ? collections[prevYm] || 0 : 0),
      collectionDays,
      previousCollectionDays,
      collectionDaysMomPct,
      totalAr: moneyRound(totalAr),
      previousTotalAr: priorOutstanding?.totalAr != null ? moneyRound(priorOutstanding.totalAr) : null,
      totalArMomPct: priorOutstanding?.totalAr != null
        ? pctChange(totalAr, priorOutstanding.totalAr)
        : null,
      gt90Ar: moneyRound(gt90),
      previousGt90Ar: priorOutstanding?.gt90Ar != null ? moneyRound(priorOutstanding.gt90Ar) : null,
      gt90ArMomPct: priorOutstanding?.gt90Ar != null
        ? pctChange(gt90, priorOutstanding.gt90Ar)
        : null,
      arBuckets: Object.fromEntries(
        Object.entries(arBuckets).map(([k, v]) => [k, moneyRound(v)]),
      ),
      previousArBuckets: priorOutstanding?.arBuckets
        ? Object.fromEntries(
          Object.entries(priorOutstanding.arBuckets).map(([k, v]) => [k, moneyRound(v)]),
        )
        : null,
      arBucketMomPct: priorOutstanding?.arBuckets
        ? Object.fromEntries(
          Object.keys(arBuckets).map((key) => [
            key,
            pctChange(arBuckets[key], priorOutstanding.arBuckets[key] || 0),
          ]),
        )
        : null,
    },
    monthlySales,
    monthlyGp,
    monthlyRepeat,
    monthlyMadibaSales: Object.fromEntries(
      months.map((ym) => [ym, moneyRound(monthlyMadibaSales[ym])]),
    ),
    monthlyMadibaByCategory: Object.fromEntries(
      months.map((ym) => [ym, Object.fromEntries(
        Object.entries(monthlyMadibaByCategory[ym]).map(([cat, value]) => [cat, moneyRound(value)]),
      )]),
    ),
    collections,
    inventory,
    portfolio,
    categories: categoryRows,
    salesmen: salesmanRows,
    madiba: madibaRows,
    remarks: buildMisRemarks({
      asOfYm,
      prevYm,
      curSales,
      prevSales,
      curGp,
      prevGp,
      gpPctNow: gpPct(curSales, curGp),
      gpPctPrev: gpPct(prevSales, prevGp),
      repeatPct: monthlyRepeat[asOfYm].pct,
      prevRepeatPct: prevYm ? monthlyRepeat[prevYm].pct : 0,
      gt90: moneyRound(gt90),
      collectionDays,
      portfolioGpPct: portfolio[asOfYm]?.gpPct || 0,
    }),
  };
}

function buildMisRemarks({
  asOfYm,
  prevYm,
  curSales,
  prevSales,
  curGp,
  prevGp,
  gpPctNow,
  gpPctPrev,
  repeatPct,
  prevRepeatPct,
  gt90,
  collectionDays,
  portfolioGpPct,
}) {
  const salesMom = pctChange(curSales, prevSales);
  const gpMom = pctChange(curGp, prevGp);
  const monthLabel = asOfYm;
  const prevLabel = prevYm || "prior month";
  return {
    momentum: salesMom >= 0
      ? `${monthLabel} sales rose ${salesMom}% vs ${prevLabel} while GP moved ${gpMom >= 0 ? "up" : "down"} ${Math.abs(gpMom)}%.`
      : `${monthLabel} sales normalized ${salesMom}% vs ${prevLabel} while absolute GP ${gpMom >= 0 ? "improved" : "softened"} (${gpMom}%).`,
    margin: `GP% ${gpPctNow}% vs ${gpPctPrev}% in ${prevLabel}.`,
    repeat: `Repeat mix ${repeatPct}% (was ${prevRepeatPct}%); path to >50% by year-end remains the commercial priority.`,
    receivables: `>90-day AR is SAR ${(gt90 / 1000).toFixed(0)}K; collection days ~${collectionDays ?? "—"}. Drive aged AR below SAR 1.0M.`,
    portfolio: `Selected high-margin portfolio GP% ${portfolioGpPct}% — protect and rebuild volume without diluting margin.`,
    bottomLine: salesMom >= 0
      ? "Preserve quality while converting growth into cash and repeat depth."
      : "Hold scale near the recent run-rate, protect margin engines, and convert receivables.",
  };
}

export const MIS_PORTFOLIO_EXCLUDE = [...PORTFOLIO_EXCLUDE];
