import { lastDayOfMonth, shiftMonthKey } from "./biReportPeriod.js";
import {
  isExpectedCollectionAvgDaysEligible,
  isKpiUploadSummaryCustomerExcluded,
  isOpenInvoiceExpectedThisMonth,
  resolveExpectedPayDate,
  splitAmountByCategoryMix,
} from "./kpiUploadSummaryCategories.js";
import { normalizeCode, normalizeName } from "./outstanding.js";
import { addDaysToDateKey } from "./scheduleDateWindow.js";

export const EXPECTED_COLLECTION_HORIZON_MONTHS = 3;
export const EXPECTED_COLLECTION_MAX_MONTHS = 12;
export const EXPECTED_COLLECTION_COMPANY_AVG_FALLBACK_DAYS = 60;

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * True when Rest is the customer's dominant sales leaf (vs BM / Electronics).
 * Used so never-paid / avg>120 proxies follow Rest payers, not BM or electronics.
 */
export function isRestDominantCustomerMix(mix = null) {
  if (!mix) return false;
  const rest = Number(mix.rest || 0);
  const bm = Number(mix.buildingMaterial || 0);
  const electronics = Number(mix.electronics || 0);
  if (!(rest > 0)) return false;
  return rest >= bm && rest >= electronics;
}

/**
 * Company avg collection days for proxy placement (never-paid / avg>120).
 * Mean of eligible customer avg days (≤120). When customerMix is passed, only
 * Rest-dominant customers count (BM / Electronics books are excluded).
 * Optional fallback (e.g. rolling 3m DSO).
 */
export function resolveCompanyAvgCollectionDays(avgDaysByCustomer = new Map(), {
  fallbackDays = null,
  customerMix = null,
} = {}) {
  const values = [];
  const filterByRest = customerMix != null;
  const entries = avgDaysByCustomer instanceof Map
    ? avgDaysByCustomer.entries()
    : Object.entries(avgDaysByCustomer || {});
  for (const [customerCode, days] of entries) {
    if (!isExpectedCollectionAvgDaysEligible(days)) continue;
    if (filterByRest) {
      const mix = customerMix instanceof Map
        ? customerMix.get(normalizeCode(customerCode))
        : customerMix?.[customerCode] || customerMix?.[normalizeCode(customerCode)];
      if (!isRestDominantCustomerMix(mix)) continue;
    }
    values.push(Number(days));
  }
  if (values.length) {
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const fallback = Number(fallbackDays);
  if (Number.isFinite(fallback) && fallback >= 0) return Math.round(fallback);
  return EXPECTED_COLLECTION_COMPANY_AVG_FALLBACK_DAYS;
}

function emptyExcludedBucket() {
  return {
    pendingAmount: 0,
    amount: 0,
    bmValue: 0,
    restValue: 0,
    electronicsValue: 0,
    customerCount: 0,
    invoiceCount: 0,
  };
}

function finalizeExcludedBucket(bucket, customerCodes) {
  return {
    pendingAmount: money(bucket.pendingAmount),
    amount: money(bucket.amount),
    bmValue: money(bucket.bmValue),
    restValue: money(bucket.restValue),
    electronicsValue: money(bucket.electronicsValue),
    customerCount: customerCodes.size,
    invoiceCount: bucket.invoiceCount,
  };
}

export function resolveExpectedCollectionMonthEnds(monthEnd = "", horizonMonths = EXPECTED_COLLECTION_HORIZON_MONTHS) {
  const end = String(monthEnd || "").slice(0, 10);
  const startKey = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end.slice(0, 7) : "";
  const count = Math.max(
    1,
    Math.min(EXPECTED_COLLECTION_MAX_MONTHS, Number(horizonMonths) || EXPECTED_COLLECTION_HORIZON_MONTHS),
  );
  if (!startKey) return [];
  const months = [];
  for (let offset = 0; offset < count; offset += 1) {
    const monthKey = shiftMonthKey(startKey, offset);
    const resolvedEnd = lastDayOfMonth(monthKey) || `${monthKey}-28`;
    months.push({
      offset,
      monthKey,
      monthEnd: resolvedEnd,
      afterMonthEnd: offset > 0 ? (months[offset - 1]?.monthEnd || "") : "",
      isCurrent: offset === 0,
      isNearTerm: offset < EXPECTED_COLLECTION_HORIZON_MONTHS,
    });
  }
  return months;
}

function resolveForwardProxyPayDate(asOfDay = "", companyAvgDays = 0, currentEnd = "") {
  const asOf = String(asOfDay || "").slice(0, 10);
  const end = String(currentEnd || "").slice(0, 10);
  const forward = resolveExpectedPayDate(asOf, companyAvgDays)
    || (asOf ? addDaysToDateKey(asOf, Math.round(Number(companyAvgDays) || 0)) : "");
  if (forward && (!end || forward > end)) return forward;
  const nextKey = shiftMonthKey(String(end || asOf).slice(0, 7), 1);
  return lastDayOfMonth(nextKey) || (nextKey ? `${nextKey}-28` : "");
}

/**
 * Assign every open invoice to an expected pay month.
 * - Customer avg ≤120: own avg days; BM+Rest in that month (overdue → current, KPI-aligned).
 * - Electronics share of those invoices: same month, but if that would be current, push forward
 *   so the Nov/current estimate is not inflated.
 * - Never-paid / avg>120: company avg days (proxy); full pending; never land in current month
 *   (if already “due”, schedule from as-of + company avg / next month).
 * - Legal queue: remains excluded from months.
 */
export function classifyExpectedCollectionOutstanding(invoices = [], {
  avgDaysByCustomer = new Map(),
  enrichedByCode = new Map(),
  customerMix = new Map(),
  monthEnd = "",
  asOf = "",
  excludedCustomerCodes = null,
  companyAvgDays = null,
} = {}) {
  const currentEnd = String(monthEnd || "").slice(0, 10);
  const asOfDay = String(asOf || currentEnd).slice(0, 10);
  const currentMonthKey = currentEnd.slice(0, 7);
  const rowsByMonth = new Map();
  const excluded = {
    neverPaid: emptyExcludedBucket(),
    avgOver120: emptyExcludedBucket(),
    legal: emptyExcludedBucket(),
    electronics: emptyExcludedBucket(),
  };
  const excludedCustomers = {
    neverPaid: new Set(),
    avgOver120: new Set(),
    legal: new Set(),
    electronics: new Set(),
  };
  const proxyPlaced = {
    neverPaid: emptyExcludedBucket(),
    avgOver120: emptyExcludedBucket(),
  };
  const proxyCustomers = {
    neverPaid: new Set(),
    avgOver120: new Set(),
  };
  let totalPending = 0;
  let latestMonthKey = currentMonthKey;
  const resolvedCompanyAvg = Number.isFinite(Number(companyAvgDays))
    ? Math.round(Number(companyAvgDays))
    : resolveCompanyAvgCollectionDays(avgDaysByCustomer, { customerMix });

  const pushBucket = (bucket, customers, {
    pending,
    bmValue = 0,
    restValue = 0,
    electronicsValue = 0,
    customerCode,
  }) => {
    bucket.pendingAmount = money(bucket.pendingAmount + pending);
    bucket.bmValue = money(bucket.bmValue + bmValue);
    bucket.restValue = money(bucket.restValue + restValue);
    bucket.electronicsValue = money(bucket.electronicsValue + electronicsValue);
    bucket.amount = money(bucket.amount + bmValue + restValue + electronicsValue);
    bucket.invoiceCount += 1;
    if (customerCode) customers.add(customerCode);
  };

  (invoices || []).forEach((invoice) => {
    const pending = Number(invoice?.pending_amount ?? invoice?.amount ?? 0);
    if (!(pending > 0)) return;
    const customerCode = normalizeCode(invoice?.customer_code);
    if (!customerCode) return;
    totalPending = money(totalPending + pending);

    const mix = customerMix instanceof Map
      ? customerMix.get(customerCode)
      : customerMix?.[customerCode];
    const split = splitAmountByCategoryMix(pending, mix);
    const bmValue = money(split.buildingMaterial);
    const restValue = money(split.rest);
    const electronicsValue = money(split.electronics);

    if (isKpiUploadSummaryCustomerExcluded(customerCode, excludedCustomerCodes)) {
      pushBucket(excluded.legal, excludedCustomers.legal, {
        pending,
        bmValue,
        restValue,
        electronicsValue,
        customerCode,
      });
      return;
    }

    const customerAvg = avgDaysByCustomer instanceof Map
      ? avgDaysByCustomer.get(customerCode)
      : avgDaysByCustomer?.[customerCode];
    let avgDays = customerAvg;
    let avgSource = "customer";
    let placementReason = "customer";

    if (avgDays == null || avgDays === "") {
      avgDays = resolvedCompanyAvg;
      avgSource = "company";
      placementReason = "neverPaid";
    } else if (!isExpectedCollectionAvgDaysEligible(avgDays)) {
      avgDays = resolvedCompanyAvg;
      avgSource = "company";
      placementReason = "avgOver120";
    }

    const isProxy = placementReason === "neverPaid" || placementReason === "avgOver120";
    const invoiceDate = String(invoice?.invoice_date || "").slice(0, 10);
    const trueApproxPayDate = resolveExpectedPayDate(invoiceDate, avgDays);
    if (!trueApproxPayDate) return;

    const enriched = enrichedByCode instanceof Map
      ? enrichedByCode.get(customerCode)
      : enrichedByCode?.[customerCode];
    const salesman = resolveExpectedCollectionSalesman(invoice);

    const pushMonthRow = ({
      amount,
      bmPart,
      restPart,
      electronicsPart,
      bucketPayDate,
      approxPayDate,
      reason,
      source,
      usedAvgDays,
    }) => {
      if (!(amount > 0.009)) return;
      let payDate = String(bucketPayDate || "").slice(0, 10);
      if (!payDate) return;
      const expectedMonthKey = payDate.slice(0, 7);
      if (expectedMonthKey > latestMonthKey) latestMonthKey = expectedMonthKey;
      const monthEndForRow = lastDayOfMonth(expectedMonthKey) || `${expectedMonthKey}-28`;
      const row = {
        customerCode,
        customerName: String(invoice?.customer_name || enriched?.customer_name || "").trim(),
        salesmanCode: salesman.salesmanCode,
        salesmanName: salesman.salesmanName,
        avgDays: Number.isFinite(Number(usedAvgDays)) ? Number(usedAvgDays) : null,
        avgSource: source,
        placementReason: reason,
        customerAvgDays: customerAvg == null || customerAvg === ""
          ? null
          : (Number.isFinite(Number(customerAvg)) ? Number(customerAvg) : null),
        lifetimeAvg: enriched?.avg_days_to_pay ?? enriched?.avgDaysToPay ?? null,
        lastPaidInvoiceDays: enriched?.last_paid_invoice_days ?? enriched?.lastPaidInvoiceDays ?? null,
        lastReceiptDate: String(enriched?.last_receipt_date || "").slice(0, 10) || "",
        refNo: String(invoice?.ref_no || invoice?.voucher_number || "").trim(),
        invoiceDate,
        pendingAmount: money(pending),
        amount: money(amount),
        daysToMonthEnd: daysBetween(invoiceDate, monthEndForRow),
        approxPayDate: String(approxPayDate || payDate).slice(0, 10),
        expectedMonthKey,
        bmValue: money(bmPart),
        restValue: money(restPart),
        electronicsValue: money(electronicsPart),
      };
      const list = rowsByMonth.get(expectedMonthKey) || [];
      list.push(row);
      rowsByMonth.set(expectedMonthKey, list);
    };

    if (isProxy) {
      // Company-avg proxies must not inflate the current-month (Nov) estimate.
      let bucketPayDate = trueApproxPayDate;
      if (bucketPayDate <= currentEnd) {
        bucketPayDate = resolveForwardProxyPayDate(asOfDay, resolvedCompanyAvg, currentEnd);
      }
      pushBucket(proxyPlaced[placementReason], proxyCustomers[placementReason], {
        pending,
        bmValue,
        restValue,
        electronicsValue,
        customerCode,
      });
      pushMonthRow({
        amount: pending,
        bmPart: bmValue,
        restPart: restValue,
        electronicsPart: electronicsValue,
        bucketPayDate,
        approxPayDate: trueApproxPayDate,
        reason: placementReason,
        source: avgSource,
        usedAvgDays: avgDays,
      });
      return;
    }

    // Strict customer path: BM+Rest only in the KPI month (overdue → current).
    let strictPayDate = trueApproxPayDate;
    if (strictPayDate <= currentEnd) strictPayDate = currentEnd;
    pushMonthRow({
      amount: money(bmValue + restValue),
      bmPart: bmValue,
      restPart: restValue,
      electronicsPart: 0,
      bucketPayDate: strictPayDate,
      approxPayDate: trueApproxPayDate,
      reason: "customer",
      source: "customer",
      usedAvgDays: avgDays,
    });

    // Electronics stays in months, but not inside the current-month estimate.
    if (electronicsValue > 0.009) {
      let electronicsPayDate = trueApproxPayDate;
      if (electronicsPayDate <= currentEnd) {
        electronicsPayDate = resolveForwardProxyPayDate(asOfDay, resolvedCompanyAvg, currentEnd);
      }
      pushMonthRow({
        amount: electronicsValue,
        bmPart: 0,
        restPart: 0,
        electronicsPart: electronicsValue,
        bucketPayDate: electronicsPayDate,
        approxPayDate: trueApproxPayDate,
        reason: "electronics",
        source: "customer",
        usedAvgDays: avgDays,
      });
    }
  });

  return {
    totalPending,
    currentMonthKey,
    latestMonthKey,
    companyAvgDays: resolvedCompanyAvg,
    rowsByMonth,
    proxyPlaced: {
      neverPaid: finalizeExcludedBucket(proxyPlaced.neverPaid, proxyCustomers.neverPaid),
      avgOver120: finalizeExcludedBucket(proxyPlaced.avgOver120, proxyCustomers.avgOver120),
    },
    excluded: {
      neverPaid: finalizeExcludedBucket(excluded.neverPaid, excludedCustomers.neverPaid),
      avgOver120: finalizeExcludedBucket(excluded.avgOver120, excludedCustomers.avgOver120),
      legal: finalizeExcludedBucket(excluded.legal, excludedCustomers.legal),
      electronics: finalizeExcludedBucket(excluded.electronics, excludedCustomers.electronics),
    },
  };
}

function monthSpanCount(fromMonthKey = "", toMonthKey = "") {
  const from = String(fromMonthKey || "").slice(0, 7);
  const to = String(toMonthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || to < from) return 0;
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  return ((toYear - fromYear) * 12) + (toMonth - fromMonth) + 1;
}

export function resolveExpectedCollectionSalesman(invoice = {}) {
  const raw = String(
    invoice?.salesman
    || invoice?.salesman_name
    || invoice?.salesmanName
    || invoice?.salesman_code
    || invoice?.salesmanCode
    || "",
  ).trim();
  if (!raw) {
    return { salesmanCode: "", salesmanName: "" };
  }
  return {
    salesmanCode: normalizeCode(raw),
    salesmanName: raw,
  };
}

/**
 * Group detail rows by salesman with Expected SAR (and related) totals.
 * Unassigned invoices land under key "__UNASSIGNED__".
 */
export function groupExpectedCollectionRowsBySalesman(rows = []) {
  const byKey = new Map();
  (rows || []).forEach((row) => {
    const code = normalizeCode(row?.salesmanCode || row?.salesmanName);
    const name = String(row?.salesmanName || row?.salesmanCode || "").trim();
    const key = code || normalizeName(name) || "__UNASSIGNED__";
    const current = byKey.get(key) || {
      key,
      salesmanCode: code,
      salesmanName: name || "Unassigned",
      invoiceCount: 0,
      customerCodes: new Set(),
      pendingAmount: 0,
      amount: 0,
      bmValue: 0,
      restValue: 0,
      rows: [],
    };
    current.invoiceCount += 1;
    if (row?.customerCode) current.customerCodes.add(normalizeCode(row.customerCode));
    current.pendingAmount = money(current.pendingAmount + Number(row?.pendingAmount || 0));
    current.amount = money(current.amount + Number(row?.amount || 0));
    current.bmValue = money(current.bmValue + Number(row?.bmValue || 0));
    current.restValue = money(current.restValue + Number(row?.restValue || 0));
    if (!current.salesmanName && name) current.salesmanName = name;
    current.rows.push(row);
    byKey.set(key, current);
  });

  return [...byKey.values()]
    .map((group) => ({
      key: group.key,
      salesmanCode: group.salesmanCode,
      salesmanName: group.salesmanName || "Unassigned",
      invoiceCount: group.invoiceCount,
      customerCount: group.customerCodes.size,
      pendingAmount: group.pendingAmount,
      amount: group.amount,
      bmValue: group.bmValue,
      restValue: group.restValue,
      rows: group.rows,
    }))
    .sort((left, right) => (
      right.amount - left.amount
      || String(left.salesmanName).localeCompare(String(right.salesmanName))
      || String(left.salesmanCode).localeCompare(String(right.salesmanCode))
    ));
}

/**
 * Group detail rows by customer with Expected SAR (and related) totals.
 * Used under an expanded salesman so duplicate customer invoice lines collapse.
 */
export function groupExpectedCollectionRowsByCustomer(rows = []) {
  const byKey = new Map();
  (rows || []).forEach((row) => {
    const code = normalizeCode(row?.customerCode);
    const name = String(row?.customerName || "").trim();
    const key = code || normalizeName(name) || "__UNKNOWN__";
    const current = byKey.get(key) || {
      key,
      customerCode: code,
      customerName: name || code || "—",
      salesmanCode: normalizeCode(row?.salesmanCode || row?.salesmanName),
      salesmanName: String(row?.salesmanName || row?.salesmanCode || "").trim(),
      avgDays: row?.avgDays ?? null,
      lifetimeAvg: row?.lifetimeAvg ?? null,
      lastPaidInvoiceDays: row?.lastPaidInvoiceDays ?? null,
      lastReceiptDate: row?.lastReceiptDate || "",
      invoiceCount: 0,
      pendingAmount: 0,
      amount: 0,
      bmValue: 0,
      restValue: 0,
      rows: [],
    };
    current.invoiceCount += 1;
    current.pendingAmount = money(current.pendingAmount + Number(row?.pendingAmount || 0));
    current.amount = money(current.amount + Number(row?.amount || 0));
    current.bmValue = money(current.bmValue + Number(row?.bmValue || 0));
    current.restValue = money(current.restValue + Number(row?.restValue || 0));
    if (!current.customerName && name) current.customerName = name;
    if (current.avgDays == null && row?.avgDays != null) current.avgDays = row.avgDays;
    if (current.lifetimeAvg == null && row?.lifetimeAvg != null) current.lifetimeAvg = row.lifetimeAvg;
    if (current.lastPaidInvoiceDays == null && row?.lastPaidInvoiceDays != null) {
      current.lastPaidInvoiceDays = row.lastPaidInvoiceDays;
    }
    if (!current.lastReceiptDate && row?.lastReceiptDate) {
      current.lastReceiptDate = row.lastReceiptDate;
    }
    current.rows.push(row);
    byKey.set(key, current);
  });

  return [...byKey.values()]
    .map((group) => ({
      key: group.key,
      customerCode: group.customerCode,
      customerName: group.customerName || group.customerCode || "—",
      salesmanCode: group.salesmanCode,
      salesmanName: group.salesmanName,
      avgDays: group.avgDays,
      lifetimeAvg: group.lifetimeAvg,
      lastPaidInvoiceDays: group.lastPaidInvoiceDays,
      lastReceiptDate: group.lastReceiptDate,
      invoiceCount: group.invoiceCount,
      pendingAmount: group.pendingAmount,
      amount: group.amount,
      bmValue: group.bmValue,
      restValue: group.restValue,
      rows: group.rows,
    }))
    .sort((left, right) => (
      right.amount - left.amount
      || String(left.customerName).localeCompare(String(right.customerName))
      || String(left.customerCode).localeCompare(String(right.customerCode))
    ));
}

function daysBetween(from, to) {
  const a = Date.parse(`${String(from || "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function summarizeExpectedCollectionRows(rows = [], {
  monthKey = "",
  monthEnd = "",
  afterMonthEnd = "",
  offset = 0,
  isCurrent = false,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const bmTotal = money(list.reduce((sum, row) => sum + Number(row.bmValue || 0), 0));
  const restTotal = money(list.reduce((sum, row) => sum + Number(row.restValue || 0), 0));
  const total = money(list.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const pendingAmount = money(list.reduce((sum, row) => sum + Number(row.pendingAmount || 0), 0));
  const customerCodes = new Set(list.map((row) => row.customerCode).filter(Boolean));
  return {
    offset,
    monthKey: String(monthKey || monthEnd || "").slice(0, 7),
    monthEnd: String(monthEnd || "").slice(0, 10),
    afterMonthEnd: String(afterMonthEnd || "").slice(0, 10),
    isCurrent: Boolean(isCurrent),
    total,
    bmTotal,
    restTotal,
    pendingAmount,
    customerCount: customerCodes.size,
    invoiceCount: list.length,
    rows: list,
  };
}

/**
 * Flat invoice rows for BM+Rest open expected collection by month-end.
 * Matches the agreed estimate list: avg days from the map, legal excluded,
 * amount = BM + Rest mix share only (electronics share omitted).
 * Pass afterMonthEnd to keep only invoices newly expected in that month window
 * (approx pay after the prior month-end and on/before this month-end).
 */
export function buildExpectedCollectionDetailRows(invoices = [], {
  avgDaysByCustomer = new Map(),
  enrichedByCode = new Map(),
  customerMix = new Map(),
  monthEnd = "",
  afterMonthEnd = "",
  monthKey = "",
  offset = 0,
  isCurrent = false,
  excludedCustomerCodes = null,
} = {}) {
  const end = String(monthEnd || "").slice(0, 10);
  const after = String(afterMonthEnd || "").slice(0, 10);
  const key = String(monthKey || end).slice(0, 7);
  const rows = [];

  (invoices || []).forEach((invoice) => {
    const pending = Number(invoice?.pending_amount ?? invoice?.amount ?? 0);
    if (!(pending > 0)) return;
    const customerCode = normalizeCode(invoice?.customer_code);
    if (!customerCode) return;
    if (isKpiUploadSummaryCustomerExcluded(customerCode, excludedCustomerCodes)) return;

    const avgDays = avgDaysByCustomer instanceof Map
      ? avgDaysByCustomer.get(customerCode)
      : avgDaysByCustomer?.[customerCode];
    const invoiceDate = String(invoice?.invoice_date || "").slice(0, 10);
    if (!isOpenInvoiceExpectedThisMonth({
      invoiceDate,
      avgDays,
      monthEnd: end,
      afterMonthEnd: after,
    })) return;

    const mix = customerMix instanceof Map
      ? customerMix.get(customerCode)
      : customerMix?.[customerCode];
    const split = splitAmountByCategoryMix(pending, mix);
    const bmValue = money(split.buildingMaterial);
    const restValue = money(split.rest);
    const amount = money(bmValue + restValue);
    if (!(amount > 0.009)) return;

    const enriched = enrichedByCode instanceof Map
      ? enrichedByCode.get(customerCode)
      : enrichedByCode?.[customerCode];
    const approxPayDate = resolveExpectedPayDate(invoiceDate, avgDays);
    const salesman = resolveExpectedCollectionSalesman(invoice);

    rows.push({
      customerCode,
      customerName: String(invoice?.customer_name || enriched?.customer_name || "").trim(),
      salesmanCode: salesman.salesmanCode,
      salesmanName: salesman.salesmanName,
      avgDays: Number.isFinite(Number(avgDays)) ? Number(avgDays) : null,
      lifetimeAvg: enriched?.avg_days_to_pay ?? enriched?.avgDaysToPay ?? null,
      lastPaidInvoiceDays: enriched?.last_paid_invoice_days ?? enriched?.lastPaidInvoiceDays ?? null,
      lastReceiptDate: String(enriched?.last_receipt_date || "").slice(0, 10) || "",
      refNo: String(invoice?.ref_no || invoice?.voucher_number || "").trim(),
      invoiceDate,
      pendingAmount: money(pending),
      amount,
      daysToMonthEnd: daysBetween(invoiceDate, end),
      approxPayDate,
      expectedMonthKey: key,
      bmValue,
      restValue,
    });
  });

  rows.sort((left, right) => (
    String(left.salesmanName || left.salesmanCode || "").localeCompare(
      String(right.salesmanName || right.salesmanCode || ""),
    )
    || right.amount - left.amount
    || String(left.customerCode).localeCompare(String(right.customerCode))
    || String(left.invoiceDate).localeCompare(String(right.invoiceDate))
    || String(left.refNo).localeCompare(String(right.refNo))
  ));

  return summarizeExpectedCollectionRows(rows, {
    monthKey: key,
    monthEnd: end,
    afterMonthEnd: after,
    offset,
    isCurrent,
  });
}

function sortExpectedCollectionRows(rows = []) {
  return [...(rows || [])].sort((left, right) => (
    String(left.salesmanName || left.salesmanCode || "").localeCompare(
      String(right.salesmanName || right.salesmanCode || ""),
    )
    || right.amount - left.amount
    || String(left.customerCode).localeCompare(String(right.customerCode))
    || String(left.invoiceDate).localeCompare(String(right.invoiceDate))
    || String(left.refNo).localeCompare(String(right.refNo))
  ));
}

/**
 * Month grid covering the near-term 3 months plus any later months that still
 * hold BM+Rest expected invoices, plus an excluded-bucket reconciliation so
 * Total outstanding = expected-in-months + never-paid + avg>120 + legal + electronics.
 */
export function buildExpectedCollectionHorizonReport(invoices = [], options = {}) {
  const classified = classifyExpectedCollectionOutstanding(invoices, {
    ...options,
    asOf: options.asOf || options.todayIso || String(options.monthEnd || "").slice(0, 10),
  });
  const nearTerm = Math.max(
    EXPECTED_COLLECTION_HORIZON_MONTHS,
    Number(options.horizonMonths) || EXPECTED_COLLECTION_HORIZON_MONTHS,
  );
  const spanToLatest = monthSpanCount(classified.currentMonthKey, classified.latestMonthKey);
  const monthCount = Math.max(
    nearTerm,
    Math.min(EXPECTED_COLLECTION_MAX_MONTHS, spanToLatest || nearTerm),
  );
  const horizonMonths = resolveExpectedCollectionMonthEnds(options.monthEnd, monthCount);

  const months = horizonMonths.map((horizon) => {
    const rows = sortExpectedCollectionRows(classified.rowsByMonth.get(horizon.monthKey) || []);
    return {
      ...summarizeExpectedCollectionRows(rows, {
        monthKey: horizon.monthKey,
        monthEnd: horizon.monthEnd,
        afterMonthEnd: horizon.afterMonthEnd,
        offset: horizon.offset,
        isCurrent: horizon.isCurrent,
      }),
      isNearTerm: horizon.isNearTerm,
    };
  });

  let cumulativeTotal = 0;
  let cumulativeBmTotal = 0;
  let cumulativeRestTotal = 0;
  let cumulativePendingAmount = 0;
  const cumulativeCustomerCodes = new Set();
  let cumulativeInvoiceCount = 0;
  let nearTermTotal = 0;

  const withCumulative = months.map((month) => {
    cumulativeTotal = money(cumulativeTotal + Number(month.total || 0));
    cumulativeBmTotal = money(cumulativeBmTotal + Number(month.bmTotal || 0));
    cumulativeRestTotal = money(cumulativeRestTotal + Number(month.restTotal || 0));
    cumulativePendingAmount = money(cumulativePendingAmount + Number(month.pendingAmount || 0));
    cumulativeInvoiceCount += Number(month.invoiceCount || 0);
    if (month.isNearTerm) nearTermTotal = money(nearTermTotal + Number(month.total || 0));
    (month.rows || []).forEach((row) => {
      if (row?.customerCode) cumulativeCustomerCodes.add(row.customerCode);
    });
    return {
      ...month,
      cumulativeTotal,
      cumulativeBmTotal,
      cumulativeRestTotal,
      cumulativePendingAmount,
      cumulativeCustomerCount: cumulativeCustomerCodes.size,
      cumulativeInvoiceCount,
    };
  });

  const current = withCumulative[0] || summarizeExpectedCollectionRows([], {
    monthEnd: String(options.monthEnd || "").slice(0, 10),
    isCurrent: true,
  });
  const excludedTotal = money(Number(classified.excluded.legal.pendingAmount || 0));
  const expectedInMonths = cumulativeTotal;
  const laterTotal = money(expectedInMonths - nearTermTotal);

  return {
    monthEnd: current.monthEnd,
    total: current.total,
    bmTotal: current.bmTotal,
    restTotal: current.restTotal,
    customerCount: current.customerCount,
    invoiceCount: current.invoiceCount,
    rows: current.rows,
    months: withCumulative,
    companyAvgDays: classified.companyAvgDays,
    reconciliation: {
      totalPending: classified.totalPending,
      expectedInMonths,
      nearTermTotal,
      laterTotal,
      companyAvgDays: classified.companyAvgDays,
      proxyPlaced: classified.proxyPlaced,
      excludedTotal,
      excluded: classified.excluded,
      accountedTotal: money(expectedInMonths + excludedTotal),
    },
  };
}
