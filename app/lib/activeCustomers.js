/**
 * Active Customers report: a customer is active as of month M when they have
 * at least one positive ordinary sale in the rolling four calendar months
 * ending at M (M-3 … M). Credit notes / returns do not count as a purchase.
 * Company, salesman, and team views share that definition.
 */

import {
  enumerateMonths,
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

export function rollingWindowMonths(asOfMonth, windowMonths = ACTIVE_CUSTOMERS_WINDOW_MONTHS) {
  const end = String(asOfMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(end)) return [];
  const size = Math.max(1, Number(windowMonths) || ACTIVE_CUSTOMERS_WINDOW_MONTHS);
  let start = end;
  for (let index = 1; index < size; index += 1) {
    start = previousMonthKey(start);
    if (!start) return [end];
  }
  return enumerateMonths(start, end);
}

function ensureCustomerMonthSet(bucket, customerCode) {
  if (!bucket.has(customerCode)) bucket.set(customerCode, new Set());
  return bucket.get(customerCode);
}

function addPurchaseMonth(bucket, customerCode, month) {
  ensureCustomerMonthSet(bucket, customerCode).add(month);
}

export function countActiveInWindow(customerMonths, windowMonths = []) {
  if (!windowMonths.length) return 0;
  let count = 0;
  for (const months of customerMonths.values()) {
    if (windowMonths.some((month) => months.has(month))) count += 1;
  }
  return count;
}

export function buildMonthCountSeries(customerMonths, displayMonths = []) {
  const values = {};
  for (const month of displayMonths) {
    values[month] = countActiveInWindow(customerMonths, rollingWindowMonths(month));
  }
  return values;
}

/** Calendar-month net sales (not the rolling active window). */
export function buildMonthSalesSeries(salesByMonth = {}, displayMonths = []) {
  const values = {};
  for (const month of displayMonths) {
    values[month] = Number(salesByMonth[month] || 0);
  }
  return values;
}

function addMonthSales(salesByMonth, month, amount) {
  const value = Number(amount || 0);
  if (!month || !Number.isFinite(value) || value === 0) return;
  salesByMonth[month] = Number(salesByMonth[month] || 0) + value;
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
    tones[month] = month === currentMonth
      ? "current"
      : monthChangeTone(monthValues[month], monthValues[previous], Boolean(previous));
    salesTones[month] = month === currentMonth
      ? "current"
      : monthChangeTone(monthSales[month], monthSales[previous], Boolean(previous));
  });
  return {
    key,
    label,
    monthValues,
    monthSales,
    monthTones: tones,
    monthSalesTones: salesTones,
    currentCount,
    currentSales,
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
  const companySalesByMonth = {};
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
      addPurchaseMonth(companyCustomers, customerCode, month);
    }
    addMonthSales(companySalesByMonth, month, netSales);

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
          salesByMonth: {},
        });
      }
      const salesmanBucket = salesmanBuckets.get(salesmanLabel);
      if (countsAsPurchase) {
        addPurchaseMonth(salesmanBucket.customers, customerCode, month);
      }
      addMonthSales(salesmanBucket.salesByMonth, month, netSales);
    }

    const team = resolveTeamBucket(identity, teamMembers);
    if (!teamBuckets.has(team.teamKey)) {
      teamBuckets.set(team.teamKey, {
        teamKey: team.teamKey,
        label: team.teamLabel,
        customers: new Map(),
        salesByMonth: {},
      });
    }
    const teamBucket = teamBuckets.get(team.teamKey);
    if (countsAsPurchase) {
      addPurchaseMonth(teamBucket.customers, customerCode, month);
    }
    addMonthSales(teamBucket.salesByMonth, month, netSales);
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

  const companyMonthValues = buildMonthCountSeries(companyCustomers, displayMonths);
  const companyMonthSales = buildMonthSalesSeries(companySalesByMonth, displayMonths);
  // Include the month before the first display month so MoM tone on the first column works.
  if (displayMonths[0]) {
    const lead = previousMonthKey(displayMonths[0]);
    if (lead) {
      companyMonthValues[lead] = countActiveInWindow(companyCustomers, rollingWindowMonths(lead));
      companyMonthSales[lead] = Number(companySalesByMonth[lead] || 0);
    }
  }

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
      const monthValues = buildMonthCountSeries(bucket.customers, displayMonths);
      const monthSales = buildMonthSalesSeries(bucket.salesByMonth, displayMonths);
      if (displayMonths[0]) {
        const lead = previousMonthKey(displayMonths[0]);
        if (lead) {
          monthValues[lead] = countActiveInWindow(bucket.customers, rollingWindowMonths(lead));
          monthSales[lead] = Number(bucket.salesByMonth?.[lead] || 0);
        }
      }
      return decorateSeriesRow({
        key: bucket.label,
        label: bucket.label,
        monthValues,
        monthSales,
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
      const monthValues = buildMonthCountSeries(bucket.customers, displayMonths);
      const monthSales = buildMonthSalesSeries(bucket.salesByMonth, displayMonths);
      if (displayMonths[0]) {
        const lead = previousMonthKey(displayMonths[0]);
        if (lead) {
          monthValues[lead] = countActiveInWindow(bucket.customers, rollingWindowMonths(lead));
          monthSales[lead] = Number(bucket.salesByMonth?.[lead] || 0);
        }
      }
      return decorateSeriesRow({
        key: bucket.teamKey,
        label: bucket.label,
        monthValues,
        monthSales,
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
