/**
 * Active Customers report: a customer is active as of month M when they have
 * at least one positive ordinary sale in the inclusive 120-day window ending
 * on the last day of M (or the report as-of date for the open month).
 * Net sales in each month cell use that same 120-day window so count and
 * sales match. Credit notes / returns do not count as a purchase but reduce
 * net sales. Company, salesman, and team views share that definition.
 */

import {
  growthPercent,
  monthChangeTone,
  monthKeyFromDateKey,
  previousMonthKey,
  salesDateKey,
  selectRecentGrowthMonths,
} from "./categoryGrowth.js";
import { isCreditNoteTransaction } from "./paymentBehavior.js";
import { netKpiSalesAmount } from "./performanceKpis.js";
import { reportSalesmanLabel } from "./salesmanReportIdentity.js";
import { isExcludedSalesmanMomRow } from "./salesmanMom.js";
import {
  isEcomSalesmanIdentity,
  isStoreSalesVoucher,
  resolveTeamBucket,
  salesmanRowIdentity,
} from "./salesmanTeamMom.js";
import { getKsaDateString } from "./workdayActivity.js";

export const ACTIVE_CUSTOMERS_WINDOW_DAYS = 120;

/** @deprecated Use ACTIVE_CUSTOMERS_WINDOW_DAYS. Kept for older callers. */
export const ACTIVE_CUSTOMERS_WINDOW_MONTHS = 4;

export const ACTIVE_CUSTOMERS_SELECT = [
  "id",
  "transaction_date",
  "customer_code",
  "salesman_code",
  "salesman_name",
  "voucher_type",
  "voucher_number",
  "reference",
  "sales_amount",
].join(",");

export function normalizeActiveCustomerCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function purchaseCountsTowardActive(row = {}) {
  if (isCreditNoteTransaction(row)) return false;
  const amount = Number(row?.sales_amount);
  return Number.isFinite(amount) && amount > 0;
}

export function shiftDateKey(dateKey, deltaDays) {
  const key = salesDateKey(dateKey);
  if (!key) return "";
  const days = Number(deltaDays);
  if (!Number.isFinite(days) || days === 0) return key;
  const dt = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return "";
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Last calendar day of YYYY-MM, or "" when invalid. */
export function monthEndDateKey(monthKey) {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return "";
  }
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Inclusive 120-day window ending on asOfEndDate.
 * Example: end 2026-10-31 → start 2026-07-04.
 */
export function rollingWindowBounds(asOfEndDate, windowDays = ACTIVE_CUSTOMERS_WINDOW_DAYS) {
  const end = salesDateKey(asOfEndDate);
  if (!end) return { start: "", end: "" };
  const size = Math.max(1, Number(windowDays) || ACTIVE_CUSTOMERS_WINDOW_DAYS);
  return {
    start: shiftDateKey(end, -(size - 1)),
    end,
  };
}

/** As-of end date for a display month column. */
export function resolveMonthAsOfDate(monthKey, reportAsOfDate = "") {
  const month = String(monthKey || "").slice(0, 7);
  const asOf = salesDateKey(reportAsOfDate) || getKsaDateString();
  if (!month) return asOf;
  const asOfMonth = asOf.slice(0, 7);
  if (month === asOfMonth) return asOf;
  if (month > asOfMonth) return asOf;
  return monthEndDateKey(month) || asOf;
}

function ensureCustomerDateSet(bucket, customerCode) {
  if (!bucket.has(customerCode)) bucket.set(customerCode, new Set());
  return bucket.get(customerCode);
}

function addPurchaseDate(bucket, customerCode, dateKey) {
  ensureCustomerDateSet(bucket, customerCode).add(dateKey);
}

function addDateSales(salesByDate, dateKey, amount) {
  const value = Number(amount || 0);
  if (!dateKey || !Number.isFinite(value) || value === 0) return;
  salesByDate[dateKey] = Number(salesByDate[dateKey] || 0) + value;
}

export function countActiveInDateWindow(customerDates, startDate, endDate) {
  const start = salesDateKey(startDate);
  const end = salesDateKey(endDate);
  if (!start || !end) return 0;
  let count = 0;
  for (const dates of customerDates.values()) {
    for (const dateKey of dates) {
      if (dateKey >= start && dateKey <= end) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

export function sumSalesInDateWindow(salesByDate = {}, startDate, endDate) {
  const start = salesDateKey(startDate);
  const end = salesDateKey(endDate);
  if (!start || !end) return 0;
  let total = 0;
  for (const [dateKey, amount] of Object.entries(salesByDate || {})) {
    if (dateKey >= start && dateKey <= end) total += Number(amount || 0);
  }
  return total;
}

export function buildMonthMetricSeries(customerDates, salesByDate, displayMonths = [], reportAsOfDate = "") {
  const counts = {};
  const sales = {};
  for (const month of displayMonths) {
    const end = resolveMonthAsOfDate(month, reportAsOfDate);
    const { start } = rollingWindowBounds(end);
    counts[month] = countActiveInDateWindow(customerDates, start, end);
    sales[month] = sumSalesInDateWindow(salesByDate, start, end);
  }
  return { counts, sales };
}

/** @deprecated Month-bucket helper kept for older tests/callers. */
export function rollingWindowMonths(asOfMonth, windowMonths = ACTIVE_CUSTOMERS_WINDOW_MONTHS) {
  const end = String(asOfMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(end)) return [];
  const size = Math.max(1, Number(windowMonths) || ACTIVE_CUSTOMERS_WINDOW_MONTHS);
  const months = [end];
  let cursor = end;
  for (let index = 1; index < size; index += 1) {
    cursor = previousMonthKey(cursor);
    if (!cursor) break;
    months.unshift(cursor);
  }
  return months;
}

/** @deprecated Prefer countActiveInDateWindow. */
export function countActiveInWindow(customerMonths, windowMonths = []) {
  if (!windowMonths.length) return 0;
  let count = 0;
  for (const months of customerMonths.values()) {
    if (windowMonths.some((month) => months.has(month))) count += 1;
  }
  return count;
}

function shouldListSalesmanRow(identity) {
  if (isStoreSalesVoucher(identity) || isEcomSalesmanIdentity(identity)) return false;
  return !isExcludedSalesmanMomRow(identity);
}

function decorateSeriesRow({
  key,
  label,
  monthValues,
  monthSales = {},
  displayMonths,
  currentMonth,
  latestCompleteMonth,
  priorCompleteMonth,
  extra = {},
}) {
  const latestCompleteCount = Number(monthValues[latestCompleteMonth] || 0);
  const priorCompleteCount = Number(monthValues[priorCompleteMonth] || 0);
  const currentCount = Number(monthValues[currentMonth] || 0);
  const latestCompleteSales = Number(monthSales[latestCompleteMonth] || 0);
  const priorCompleteSales = Number(monthSales[priorCompleteMonth] || 0);
  const currentSales = Number(monthSales[currentMonth] || 0);
  const momPercent = growthPercent(latestCompleteCount, priorCompleteCount);
  const salesMomPercent = growthPercent(latestCompleteSales, priorCompleteSales);
  const tones = {};
  const salesTones = {};
  displayMonths.forEach((month, index) => {
    const previous = index > 0 ? displayMonths[index - 1] : previousMonthKey(month);
    tones[month] = monthChangeTone(monthValues[month], monthValues[previous], Boolean(previous));
    // Open month also compares sales to the prior month: lower trailing 120d sales = down/red.
    salesTones[month] = monthChangeTone(monthSales[month], monthSales[previous], Boolean(previous));
  });
  const currentSalesTone = monthChangeTone(currentSales, latestCompleteSales, latestCompleteMonth != null);
  return {
    key,
    label,
    monthValues,
    monthSales,
    monthTones: tones,
    monthSalesTones: salesTones,
    currentCount,
    currentSales,
    currentSalesTone,
    latestCompleteCount,
    latestCompleteSales,
    priorCompleteCount,
    priorCompleteSales,
    momPercent,
    salesMomPercent,
    change: latestCompleteCount - priorCompleteCount,
    salesChange: latestCompleteSales - priorCompleteSales,
    ...extra,
  };
}

/**
 * Build the Active Customers report from active_sales-like rows.
 * @param {Array<object>} rows
 * @param {{ teamMembers?: Array<object>, asOfDate?: string }} [options]
 */
export function buildActiveCustomersReport(rows = [], options = {}) {
  const asOfDate = salesDateKey(options.asOfDate) || getKsaDateString();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];

  const companyCustomers = new Map();
  const companySalesByDate = {};
  const salesmanBuckets = new Map();
  const teamBuckets = new Map();

  let firstDate = "";
  let lastDate = "";

  for (const row of rows || []) {
    const dateKey = salesDateKey(row.transaction_date);
    const month = monthKeyFromDateKey(dateKey);
    const customerCode = normalizeActiveCustomerCode(row.customer_code);
    if (!customerCode || !month) continue;
    if (dateKey > asOfDate) continue;

    const countsAsPurchase = purchaseCountsTowardActive(row);
    const netSales = netKpiSalesAmount(row);
    if (!countsAsPurchase && netSales === 0) continue;

    if (!firstDate || dateKey < firstDate) firstDate = dateKey;
    if (!lastDate || dateKey > lastDate) lastDate = dateKey;

    if (countsAsPurchase) {
      addPurchaseDate(companyCustomers, customerCode, dateKey);
    }
    addDateSales(companySalesByDate, dateKey, netSales);

    const identity = salesmanRowIdentity({
      ...row,
      label: reportSalesmanLabel(row),
      category: reportSalesmanLabel(row),
    });
    const salesmanLabel = identity.label || reportSalesmanLabel(row);

    if (shouldListSalesmanRow(identity)) {
      if (!salesmanBuckets.has(salesmanLabel)) {
        salesmanBuckets.set(salesmanLabel, {
          label: salesmanLabel,
          customers: new Map(),
          salesByDate: {},
        });
      }
      const salesmanBucket = salesmanBuckets.get(salesmanLabel);
      if (countsAsPurchase) {
        addPurchaseDate(salesmanBucket.customers, customerCode, dateKey);
      }
      addDateSales(salesmanBucket.salesByDate, dateKey, netSales);
    }

    const team = resolveTeamBucket(identity, teamMembers);
    if (!teamBuckets.has(team.teamKey)) {
      teamBuckets.set(team.teamKey, {
        teamKey: team.teamKey,
        label: team.teamLabel,
        customers: new Map(),
        salesByDate: {},
      });
    }
    const teamBucket = teamBuckets.get(team.teamKey);
    if (countsAsPurchase) {
      addPurchaseDate(teamBucket.customers, customerCode, dateKey);
    }
    addDateSales(teamBucket.salesByDate, dateKey, netSales);
  }

  const lastDataMonth = lastDate ? lastDate.slice(0, 7) : "";
  const firstMonth = firstDate ? firstDate.slice(0, 7) : "";
  const asOfMonth = asOfDate.slice(0, 7);
  const currentMonth = asOfMonth || lastDataMonth;
  const latestMonthIsPartial = Boolean(currentMonth && lastDataMonth && lastDataMonth === currentMonth);
  const latestCompleteMonth = latestMonthIsPartial
    ? previousMonthKey(currentMonth)
    : (lastDataMonth || previousMonthKey(currentMonth));
  const priorCompleteMonth = previousMonthKey(latestCompleteMonth);

  const displayMonths = selectRecentGrowthMonths({
    firstMonth,
    lastDataMonth: lastDataMonth || currentMonth,
    asOfMonth: currentMonth,
  });

  const seriesMonths = [...displayMonths];
  if (displayMonths[0]) {
    const lead = previousMonthKey(displayMonths[0]);
    if (lead) seriesMonths.unshift(lead);
  }

  const companyMetrics = buildMonthMetricSeries(
    companyCustomers,
    companySalesByDate,
    seriesMonths,
    asOfDate,
  );
  const companyMonthValues = companyMetrics.counts;
  const companyMonthSales = companyMetrics.sales;

  const companyRow = decorateSeriesRow({
    key: "company",
    label: "Company",
    monthValues: companyMonthValues,
    monthSales: companyMonthSales,
    displayMonths,
    currentMonth,
    latestCompleteMonth,
    priorCompleteMonth,
    extra: { customerCount: companyCustomers.size },
  });

  const salesmanRows = [...salesmanBuckets.values()]
    .map((bucket) => {
      const metrics = buildMonthMetricSeries(
        bucket.customers,
        bucket.salesByDate,
        seriesMonths,
        asOfDate,
      );
      return decorateSeriesRow({
        key: bucket.label,
        label: bucket.label,
        monthValues: metrics.counts,
        monthSales: metrics.sales,
        displayMonths,
        currentMonth,
        latestCompleteMonth,
        priorCompleteMonth,
        extra: { customerCount: bucket.customers.size },
      });
    })
    .filter((row) => displayMonths.some((month) => Number(row.monthValues[month] || 0) > 0))
    .sort((left, right) => {
      const delta = Number(right.latestCompleteCount || 0) - Number(left.latestCompleteCount || 0);
      if (delta !== 0) return delta;
      return String(left.label).localeCompare(String(right.label));
    });

  const teamRows = [...teamBuckets.values()]
    .map((bucket) => {
      const metrics = buildMonthMetricSeries(
        bucket.customers,
        bucket.salesByDate,
        seriesMonths,
        asOfDate,
      );
      return decorateSeriesRow({
        key: bucket.teamKey,
        label: bucket.label,
        monthValues: metrics.counts,
        monthSales: metrics.sales,
        displayMonths,
        currentMonth,
        latestCompleteMonth,
        priorCompleteMonth,
        extra: {
          teamKey: bucket.teamKey,
          customerCount: bucket.customers.size,
        },
      });
    })
    .filter((row) => displayMonths.some((month) => Number(row.monthValues[month] || 0) > 0))
    .sort((left, right) => {
      const delta = Number(right.latestCompleteCount || 0) - Number(left.latestCompleteCount || 0);
      if (delta !== 0) return delta;
      return String(left.label).localeCompare(String(right.label));
    });

  const currentActive = Number(companyRow.currentCount || 0);
  const priorActive = Number(companyRow.latestCompleteCount || 0);
  const priorPriorActive = Number(companyRow.priorCompleteCount || 0);

  return {
    windowDays: ACTIVE_CUSTOMERS_WINDOW_DAYS,
    windowMonths: ACTIVE_CUSTOMERS_WINDOW_MONTHS,
    asOfDate,
    currentMonth,
    latestCompleteMonth,
    priorCompleteMonth,
    months: displayMonths,
    firstDate,
    lastDate,
    company: companyRow,
    salesmanRows,
    teamRows,
    summary: {
      currentActive,
      currentSales: Number(companyRow.currentSales || 0),
      latestCompleteActive: priorActive,
      latestCompleteSales: Number(companyRow.latestCompleteSales || 0),
      priorCompleteActive: priorPriorActive,
      priorCompleteSales: Number(companyRow.priorCompleteSales || 0),
      change: priorActive - priorPriorActive,
      salesChange: Number(companyRow.salesChange || 0),
      momPercent: growthPercent(priorActive, priorPriorActive),
      salesMomPercent: Number(companyRow.salesMomPercent || 0),
      salesmanCount: salesmanRows.length,
      teamCount: teamRows.length,
      everBoughtCount: companyCustomers.size,
    },
  };
}
