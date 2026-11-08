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

function shouldListSalesmanRow(identity) {
  if (isStoreSalesVoucher(identity) || isEcomSalesmanIdentity(identity)) return false;
  return !isExcludedSalesmanMomRow(identity);
}

function decorateSeriesRow({
  key,
  label,
  monthValues,
  displayMonths,
  currentMonth,
  latestCompleteMonth,
  priorCompleteMonth,
  extra = {},
}) {
  const latestCompleteCount = Number(monthValues[latestCompleteMonth] || 0);
  const priorCompleteCount = Number(monthValues[priorCompleteMonth] || 0);
  const currentCount = Number(monthValues[currentMonth] || 0);
  const momPercent = growthPercent(latestCompleteCount, priorCompleteCount);
  const tones = {};
  displayMonths.forEach((month, index) => {
    const previous = index > 0 ? displayMonths[index - 1] : previousMonthKey(month);
    tones[month] = month === currentMonth
      ? "current"
      : monthChangeTone(monthValues[month], monthValues[previous], Boolean(previous));
  });
  return {
    key,
    label,
    monthValues,
    monthTones: tones,
    currentCount,
    latestCompleteCount,
    priorCompleteCount,
    momPercent,
    change: latestCompleteCount - priorCompleteCount,
    ...extra,
  };
}

/**
 * Build the Active Customers report from active_sales-like rows.
 * @param {Array<object>} rows
 * @param {{ teamMembers?: Array<object>, asOfDate?: string, companyOnly?: boolean }} [options]
 */
export function buildActiveCustomersReport(rows = [], options = {}) {
  const asOfDate = salesDateKey(options.asOfDate) || getKsaDateString();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const companyOnly = Boolean(options.companyOnly);

  const companyCustomers = new Map();
  const salesmanBuckets = new Map();
  const teamBuckets = new Map();

  let firstDate = "";
  let lastDate = "";

  for (const row of rows || []) {
    if (!purchaseCountsTowardActive(row)) continue;
    const dateKey = salesDateKey(row.transaction_date);
    const month = monthKeyFromDateKey(dateKey);
    const customerCode = normalizeActiveCustomerCode(row.customer_code);
    if (!customerCode || !month) continue;
    if (dateKey > asOfDate) continue;

    if (!firstDate || dateKey < firstDate) firstDate = dateKey;
    if (!lastDate || dateKey > lastDate) lastDate = dateKey;

    addPurchaseMonth(companyCustomers, customerCode, month);

    if (companyOnly) continue;

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
        });
      }
      addPurchaseMonth(salesmanBuckets.get(salesmanLabel).customers, customerCode, month);
    }

    const team = resolveTeamBucket(identity, teamMembers);
    if (!teamBuckets.has(team.teamKey)) {
      teamBuckets.set(team.teamKey, {
        teamKey: team.teamKey,
        label: team.teamLabel,
        customers: new Map(),
      });
    }
    addPurchaseMonth(teamBuckets.get(team.teamKey).customers, customerCode, month);
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
  // Include the month before the first display month so MoM tone on the first column works.
  if (displayMonths[0]) {
    const lead = previousMonthKey(displayMonths[0]);
    if (lead) {
      companyMonthValues[lead] = countActiveInWindow(companyCustomers, rollingWindowMonths(lead));
    }
  }

  // Ensure MoM for the latest complete month has its prior month count even when
  // that prior sits just outside the displayed 12-month window.
  if (priorCompleteMonth && companyMonthValues[priorCompleteMonth] == null) {
    companyMonthValues[priorCompleteMonth] = countActiveInWindow(
      companyCustomers,
      rollingWindowMonths(priorCompleteMonth),
    );
  }

  const companyRow = decorateSeriesRow({
    key: "company",
    label: "Company",
    monthValues: companyMonthValues,
    displayMonths,
    currentMonth,
    latestCompleteMonth,
    priorCompleteMonth,
    extra: { customerCount: companyCustomers.size },
  });

  const salesmanRows = companyOnly
    ? []
    : [...salesmanBuckets.values()]
      .map((bucket) => {
        const monthValues = buildMonthCountSeries(bucket.customers, displayMonths);
        if (displayMonths[0]) {
          const lead = previousMonthKey(displayMonths[0]);
          if (lead) {
            monthValues[lead] = countActiveInWindow(bucket.customers, rollingWindowMonths(lead));
          }
        }
        return decorateSeriesRow({
          key: bucket.label,
          label: bucket.label,
          monthValues,
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

  const teamRows = companyOnly
    ? []
    : [...teamBuckets.values()]
      .map((bucket) => {
        const monthValues = buildMonthCountSeries(bucket.customers, displayMonths);
        if (displayMonths[0]) {
          const lead = previousMonthKey(displayMonths[0]);
          if (lead) {
            monthValues[lead] = countActiveInWindow(bucket.customers, rollingWindowMonths(lead));
          }
        }
        return decorateSeriesRow({
          key: bucket.teamKey,
          label: bucket.label,
          monthValues,
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
      latestCompleteActive: priorActive,
      priorCompleteActive: priorPriorActive,
      change: priorActive - priorPriorActive,
      momPercent: growthPercent(priorActive, priorPriorActive),
      salesmanCount: salesmanRows.length,
      teamCount: teamRows.length,
      everBoughtCount: companyCustomers.size,
    },
  };
}
