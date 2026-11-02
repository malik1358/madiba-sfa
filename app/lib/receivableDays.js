import {
  GROWTH_DIMENSION_KEYS,
  hasActiveGrowthFilters,
  normalizeGrowthFilters,
  previousMonthKey,
  rowMatchesGrowthFilters,
  salesDateKey,
} from "./categoryGrowth.js";
import { lastDayOfMonth } from "./biReportPeriod.js";
import { isCashSalesVoucher } from "./paymentBehavior.js";

export const RECEIVABLE_DAYS_DATASET_KEY = "receivable_days_monthly_v1";

/** Outstanding files only carry salesman / customer identity for AR slicing. */
export const RECEIVABLE_AR_FILTER_KEYS = [
  "salesman",
  "salesman_code",
  "salesman_name",
  "customer",
  "customer_code",
  "customer_name",
];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateOnly(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function monthKeyFromDate(value) {
  const date = dateOnly(value);
  return date ? date.slice(0, 7) : "";
}

function asObjectMap(value) {
  if (value instanceof Map) return Object.fromEntries(value);
  return value && typeof value === "object" ? value : {};
}

/**
 * Net receivable days (DSO):
 * (month-end receivables / credit sales YTD) × days YTD.
 */
export function receivableDays(receivables, creditSalesYtd, daysYtd) {
  const ar = toNumber(receivables);
  const sales = toNumber(creditSalesYtd);
  const periodDays = toNumber(daysYtd);
  if (!(sales > 0.009) || !(periodDays > 0)) return null;
  if (!(ar >= 0)) return null;
  return Math.round(((ar / sales) * periodDays) * 10) / 10;
}

/** Calendar days from 1 Jan of the month's year through month-end (or asOf for open month). */
export function receivableYtdDays(monthKey, asOfDate = "") {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return 0;
  const yearStart = `${month.slice(0, 4)}-01-01`;
  const asOf = salesDateKey(asOfDate);
  let end = lastDayOfMonth(month);
  if (asOf && asOf.slice(0, 7) === month) end = asOf;
  if (!end || end < yearStart) return 0;
  const startMs = Date.parse(`${yearStart}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

/** Sum credit sales from January of that calendar year through the given month. */
export function creditSalesYtdThroughMonth(monthlyCreditSales = {}, monthKey = "") {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return 0;
  const year = month.slice(0, 4);
  const creditMap = asObjectMap(monthlyCreditSales);
  let total = 0;
  Object.entries(creditMap).forEach(([key, value]) => {
    const entryMonth = String(key || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(entryMonth)) return;
    if (entryMonth.slice(0, 4) !== year) return;
    if (entryMonth > month) return;
    total += toNumber(value);
  });
  return Math.round(total * 100) / 100;
}

/** Inclusive trailing month keys ending at monthKey (newest last). */
export function trailingMonthKeys(monthKey, monthCount = 12) {
  const end = String(monthKey || "").slice(0, 7);
  const count = Math.max(1, Math.floor(Number(monthCount) || 0));
  if (!/^\d{4}-\d{2}$/.test(end)) return [];
  const months = [end];
  let cursor = end;
  for (let index = 1; index < count; index += 1) {
    cursor = previousMonthKey(cursor);
    if (!cursor) break;
    months.unshift(cursor);
  }
  return months;
}

/** Sum credit sales across the trailing window ending at monthKey. */
export function creditSalesTrailingMonths(monthlyCreditSales = {}, monthKey = "", monthCount = 12) {
  const creditMap = asObjectMap(monthlyCreditSales);
  const total = trailingMonthKeys(monthKey, monthCount).reduce(
    (sum, month) => sum + toNumber(creditMap[month]),
    0,
  );
  return Math.round(total * 100) / 100;
}

/** Calendar days from the first day of the trailing window through month-end (or asOf). */
export function receivableTrailingDays(monthKey, monthCount = 12, asOfDate = "") {
  const months = trailingMonthKeys(monthKey, monthCount);
  if (!months.length) return 0;
  const start = `${months[0]}-01`;
  const endMonth = months[months.length - 1];
  const asOf = salesDateKey(asOfDate);
  let end = lastDayOfMonth(endMonth);
  if (asOf && asOf.slice(0, 7) === endMonth) end = asOf;
  if (!end || end < start) return 0;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

function invoiceExclRatio(invoice) {
  const incl = toNumber(invoice?.amount ?? invoice?.amount_incl_vat);
  const excl = toNumber(invoice?.amount_excl_vat);
  if (incl > 0.009 && excl >= 0) return excl / incl;
  return 1;
}

function isCreditInvoice(invoice) {
  if (invoice?.is_cash === true) return false;
  if (invoice?.is_cash === false) return true;
  return !isCashSalesVoucher(invoice?.voucher_number);
}

/**
 * Open credit AR (ex-VAT) as of a calendar date from one customer's FIFO result.
 * Settlements dated after asOfDate are ignored; cash vouchers are excluded.
 */
export function monthEndOpenReceivablesExclVat(fifoResult = {}, asOfDate = "") {
  const asOf = dateOnly(asOfDate);
  if (!asOf) return 0;

  const invoices = Array.isArray(fifoResult?.invoices) ? fifoResult.invoices : [];
  const allocations = Array.isArray(fifoResult?.allocations) ? fifoResult.allocations : [];
  const creditNotes = Array.isArray(fifoResult?.creditNoteAllocations)
    ? fifoResult.creditNoteAllocations
    : [];

  const settledInclByKey = new Map();
  const keyOf = (invoiceDate, voucherNumber) => (
    `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`
  );

  allocations.forEach((row) => {
    const receiptDate = dateOnly(row?.receipt_date);
    if (!receiptDate || receiptDate > asOf) return;
    const key = keyOf(row.invoice_date, row.voucher_number);
    settledInclByKey.set(key, toNumber(settledInclByKey.get(key)) + toNumber(row.amount));
  });

  creditNotes.forEach((row) => {
    const creditDate = dateOnly(row?.credit_date);
    if (!creditDate || creditDate > asOf) return;
    const key = keyOf(row.invoice_date, row.voucher_number);
    settledInclByKey.set(key, toNumber(settledInclByKey.get(key)) + toNumber(row.amount));
  });

  let openExcl = 0;
  invoices.forEach((invoice) => {
    if (!isCreditInvoice(invoice)) return;
    const invoiceDate = dateOnly(invoice?.invoice_date);
    if (!invoiceDate || invoiceDate > asOf) return;
    const incl = toNumber(invoice?.amount ?? invoice?.amount_incl_vat);
    if (incl <= 0.009) return;
    const key = keyOf(invoiceDate, invoice.voucher_number);
    const remainingIncl = Math.max(0, incl - toNumber(settledInclByKey.get(key)));
    if (remainingIncl <= 0.009) return;
    openExcl += remainingIncl * invoiceExclRatio(invoice);
  });

  return Math.round(openExcl * 100) / 100;
}

/** Add one customer's month-end open AR into a month → amount map. */
export function accumulateMonthEndReceivables(fifoResult, monthKeys = [], target = new Map(), asOfDate = "") {
  const months = (Array.isArray(monthKeys) ? monthKeys : [])
    .map((month) => String(month || "").slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
  const reportAsOf = salesDateKey(asOfDate);
  months.forEach((month) => {
    const monthEnd = lastDayOfMonth(month);
    if (!monthEnd) return;
    const asOf = reportAsOf && reportAsOf.slice(0, 7) === month ? reportAsOf : monthEnd;
    const open = monthEndOpenReceivablesExclVat(fifoResult, asOf);
    target.set(month, Math.round((toNumber(target.get(month)) + open) * 100) / 100);
  });
  return target;
}

export function receivableDaysChangeTone(currentDays, previousDays) {
  if (currentDays == null || previousDays == null) return "";
  const now = Number(currentDays);
  const prior = Number(previousDays);
  if (!Number.isFinite(now) || !Number.isFinite(prior)) return "";
  // Lower receivable days is improvement (green / up tone).
  if (now < prior) return "up";
  if (now > prior) return "down";
  return "";
}

function monthInRange(monthKey, dateFrom = "", dateTo = "") {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const from = salesDateKey(dateFrom);
  const to = salesDateKey(dateTo);
  if (from && lastDayOfMonth(month) < from) return false;
  if (to && `${month}-01` > to) return false;
  return true;
}

function hasUploadedReceivable(arMap, month) {
  return Object.prototype.hasOwnProperty.call(arMap, month)
    && arMap[month] != null
    && arMap[month] !== "";
}

function daysForMonthRow(month, creditMap, arMap, asOf) {
  const hasReceivable = hasUploadedReceivable(arMap, month);
  const receivables = hasReceivable ? Math.round(toNumber(arMap[month]) * 100) / 100 : null;
  const creditSalesMonth = Math.round(toNumber(creditMap[month]) * 100) / 100;
  const creditSalesYtd = creditSalesYtdThroughMonth(creditMap, month);
  const creditSales3m = creditSalesTrailingMonths(creditMap, month, 3);
  const creditSales12m = creditSalesTrailingMonths(creditMap, month, 12);
  const daysYtd = receivableYtdDays(month, asOf);
  const days3m = receivableTrailingDays(month, 3, asOf);
  const days12m = receivableTrailingDays(month, 12, asOf);
  const daysValue = hasReceivable ? receivableDays(receivables, creditSalesYtd, daysYtd) : null;
  const days3mValue = hasReceivable ? receivableDays(receivables, creditSales3m, days3m) : null;
  const days12mValue = hasReceivable ? receivableDays(receivables, creditSales12m, days12m) : null;
  return {
    receivables,
    credit_sales: creditSalesMonth,
    credit_sales_ytd: creditSalesYtd,
    credit_sales_3m: creditSales3m,
    credit_sales_12m: creditSales12m,
    days: daysYtd,
    days_3m: days3m,
    days_12m: days12m,
    receivable_days: daysValue,
    receivable_days_3m: days3mValue,
    receivable_days_12m: days12mValue,
  };
}

/** Customer totals from the uploaded Tally outstanding file. */
export function sumTallyOutstandingRows(rows = []) {
  const total = (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + toNumber(row?.total_outstanding),
    0,
  );
  return Math.round(total * 100) / 100;
}

/** Field filters beyond the shared Period dates. */
export function hasReceivableFieldFilters(input = {}) {
  return hasActiveGrowthFilters({
    ...normalizeGrowthFilters(input),
    dateFrom: "",
    dateTo: "",
  });
}

function receivableArFilterValues(filters = {}) {
  const normalized = normalizeGrowthFilters(filters);
  return Object.fromEntries(
    GROWTH_DIMENSION_KEYS.map((key) => [
      key,
      RECEIVABLE_AR_FILTER_KEYS.includes(key) ? (normalized.values[key] || []) : [],
    ]),
  );
}

export function hasReceivableArValueFilters(input = {}) {
  const values = receivableArFilterValues(input);
  return RECEIVABLE_AR_FILTER_KEYS.some((key) => (values[key] || []).length > 0);
}

/** Map a Tally outstanding customer row onto growth-filter fields. */
export function outstandingRowAsGrowthRow(row = {}) {
  const salesman = String(row.salesman || row.salesman_name || "").trim();
  return {
    salesman_code: String(row.salesman_code || "").trim() || salesman,
    salesman_name: salesman,
    customer_code: String(row.customer_code || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
  };
}

/**
 * Keep outstanding rows that match salesman/customer filters, or (when only
 * product dimensions are set) customers present in the filtered credit-sales slice.
 */
export function outstandingRowMatchesReceivableFilters(row = {}, input = {}, customerCodesFromSales = null) {
  const normalized = normalizeGrowthFilters(input);
  const arValues = receivableArFilterValues(normalized);
  const hasArValues = RECEIVABLE_AR_FILTER_KEYS.some((key) => (arValues[key] || []).length > 0);
  if (hasArValues) {
    return rowMatchesGrowthFilters(outstandingRowAsGrowthRow(row), {
      ...normalized,
      values: arValues,
      dateFrom: "",
      dateTo: "",
      amountMin: null,
      amountMax: null,
      quantityMin: null,
      quantityMax: null,
      itemNameContains: "",
    });
  }
  if (customerCodesFromSales instanceof Set) {
    const code = String(row.customer_code || "").trim().toUpperCase();
    return Boolean(code) && customerCodesFromSales.has(code);
  }
  return true;
}

export function filterOutstandingRowsForReceivableFilters(rows = [], input = {}, customerCodesFromSales = null) {
  if (!hasReceivableFieldFilters(input)) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    outstandingRowMatchesReceivableFilters(row, input, customerCodesFromSales)
  ));
}

export function sumFilteredTallyOutstandingRows(rows = [], input = {}, customerCodesFromSales = null) {
  return sumTallyOutstandingRows(
    filterOutstandingRowsForReceivableFilters(rows, input, customerCodesFromSales),
  );
}

/** The uploaded outstanding file is one balance. It belongs on the as-of month only. */
export function tallyReceivablesByMonth(total, asOfDate = "") {
  const asOf = salesDateKey(asOfDate);
  if (!asOf) return {};
  return { [asOf.slice(0, 7)]: Math.round(toNumber(total) * 100) / 100 };
}

/** Storage object names are `{iso-with-colons-and-dot-replaced}_${file}`. */
export function parseStoredOutstandingUploadedAt(fileName = "") {
  const match = String(fileName || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

export function ksaMonthKey(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : "";
}

/** Keep the latest outstanding upload in each KSA month. */
export function lastOutstandingUploadByMonth(uploads = []) {
  const latest = new Map();
  for (const upload of Array.isArray(uploads) ? uploads : []) {
    const uploadedAt = String(upload?.uploadedAt || "");
    const month = ksaMonthKey(uploadedAt);
    const at = Date.parse(uploadedAt);
    if (!month || !Number.isFinite(at)) continue;
    const previous = latest.get(month);
    if (previous && previous.at > at) continue;
    latest.set(month, {
      at,
      month,
      uploadedAt,
      filePath: String(upload?.filePath || ""),
      total: upload?.total == null || upload?.total === "" ? null : Math.round(toNumber(upload.total) * 100) / 100,
    });
  }
  return [...latest.values()].sort((left, right) => left.month.localeCompare(right.month));
}

/**
 * Past months use their last stored outstanding file.
 * The live upload replaces that month, including when its file is still in storage.
 */
export function planOutstandingMonthUploads(storedFiles = [], currentUpload = null) {
  const currentAt = String(currentUpload?.uploadedAt || "");
  const currentMonth = ksaMonthKey(currentAt);
  const historical = lastOutstandingUploadByMonth(storedFiles)
    .filter((row) => row.month !== currentMonth);
  const planned = historical.map((row) => ({
    month: row.month,
    uploadedAt: row.uploadedAt,
    filePath: row.filePath,
    total: null,
  }));
  if (currentMonth) {
    planned.push({
      month: currentMonth,
      uploadedAt: currentAt,
      filePath: "",
      total: currentUpload?.total == null || currentUpload?.total === ""
        ? null
        : Math.round(toNumber(currentUpload.total) * 100) / 100,
    });
  }
  planned.sort((left, right) => left.month.localeCompare(right.month));
  return planned;
}

export function outstandingHistoryKey(plan = []) {
  return (Array.isArray(plan) ? plan : [])
    .map((row) => `${row.month}|${row.uploadedAt}`)
    .join(",");
}

export function receivablesFromOutstandingPlan(plan = []) {
  return Object.fromEntries(
    (Array.isArray(plan) ? plan : [])
      .filter((row) => row?.total != null && row.total !== "")
      .map((row) => [row.month, Math.round(toNumber(row.total) * 100) / 100]),
  );
}

/**
 * Build the monthwise receivable-days report from monthly AR and credit sales maps.
 * YTD DSO uses calendar-year credit sales and YTD days.
 * Rolling 3m / 12m DSO use trailing credit sales and trailing calendar days for faster / steadier views.
 */
export function buildReceivableDaysReport({
  monthlyCreditSales = {},
  monthlyReceivables = {},
  asOfDate = "",
  dateFrom = "",
  dateTo = "",
} = {}) {
  const asOf = salesDateKey(asOfDate);
  const creditMap = asObjectMap(monthlyCreditSales);
  const arMap = asObjectMap(monthlyReceivables);

  const monthSet = new Set([
    ...Object.keys(creditMap),
    ...Object.keys(arMap),
  ].map((month) => String(month || "").slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)));

  const months = [...monthSet]
    .filter((month) => monthInRange(month, dateFrom, dateTo))
    .filter((month) => !asOf || month <= asOf.slice(0, 7))
    .sort();

  const currentMonth = asOf ? asOf.slice(0, 7) : "";
  const rows = months.map((month) => {
    const current = daysForMonthRow(month, creditMap, arMap, asOf);
    const previous = previousMonthKey(month);
    const previousRow = previous ? daysForMonthRow(previous, creditMap, arMap, asOf) : null;
    const previousDays = previousRow?.receivable_days ?? null;
    const changeDays = current.receivable_days != null && previousDays != null
      ? Math.round((current.receivable_days - previousDays) * 10) / 10
      : null;
    const previousDays3m = previousRow?.receivable_days_3m ?? null;
    const previousDays12m = previousRow?.receivable_days_12m ?? null;
    const changeDays3m = current.receivable_days_3m != null && previousDays3m != null
      ? Math.round((current.receivable_days_3m - previousDays3m) * 10) / 10
      : null;
    const changeDays12m = current.receivable_days_12m != null && previousDays12m != null
      ? Math.round((current.receivable_days_12m - previousDays12m) * 10) / 10
      : null;
    return {
      month,
      ...current,
      previous_receivable_days: previousDays,
      change_days: changeDays,
      change_days_3m: changeDays3m,
      change_days_12m: changeDays12m,
      improved: changeDays != null ? changeDays < 0 : null,
      tone: receivableDaysChangeTone(current.receivable_days, previousDays),
      tone_3m: receivableDaysChangeTone(current.receivable_days_3m, previousDays3m),
      tone_12m: receivableDaysChangeTone(current.receivable_days_12m, previousDays12m),
      is_current: month === currentMonth,
    };
  });

  const latestComplete = [...rows].reverse().find((row) => !row.is_current && row.receivable_days != null) || null;
  const tallyRow = [...rows].reverse().find((row) => row.receivables != null) || null;
  const totals = rows.reduce((acc, row) => {
    acc.credit_sales += toNumber(row.credit_sales);
    return acc;
  }, { receivables: tallyRow ? toNumber(tallyRow.receivables) : 0, credit_sales: 0 });
  totals.receivables = Math.round(totals.receivables * 100) / 100;
  totals.credit_sales = Math.round(totals.credit_sales * 100) / 100;
  const lastRow = rows.at(-1) || null;
  totals.credit_sales_ytd = lastRow ? toNumber(lastRow.credit_sales_ytd) : 0;
  totals.receivable_days = lastRow?.receivable_days ?? null;
  totals.receivable_days_3m = lastRow?.receivable_days_3m ?? null;
  totals.receivable_days_12m = lastRow?.receivable_days_12m ?? null;

  return {
    months,
    rows,
    monthly: Object.fromEntries(rows.map((row) => [row.month, row])),
    currentMonth,
    latestComplete,
    totals,
    asOfDate: asOf,
    dateFrom: salesDateKey(dateFrom),
    dateTo: salesDateKey(dateTo),
    formula: "(tally_outstanding / credit_sales_ytd) × days_ytd",
    formula3m: "(tally_outstanding / credit_sales_trailing_3m) × days_trailing_3m",
    formula12m: "(tally_outstanding / credit_sales_trailing_12m) × days_trailing_12m",
    receivablesSource: "tally_outstanding",
  };
}

/** Collect distinct YYYY-MM keys from credit-sales and optional seed months. */
export function collectReceivableMonthKeys(monthlyCreditSales = {}, asOfDate = "", extraMonths = []) {
  const asOf = salesDateKey(asOfDate);
  const keys = new Set(
    [
      ...Object.keys(asObjectMap(monthlyCreditSales)),
      ...(Array.isArray(extraMonths) ? extraMonths : []),
    ]
      .map((month) => String(month || "").slice(0, 7))
      .filter((month) => /^\d{4}-\d{2}$/.test(month)),
  );
  if (asOf) keys.add(asOf.slice(0, 7));
  return [...keys].filter((month) => !asOf || month <= asOf.slice(0, 7)).sort();
}

export function monthKeyFromTransactionDate(value) {
  return monthKeyFromDate(value);
}

/** @deprecated Use receivableYtdDays — kept name alias for clarity in older drafts. */
export function receivablePeriodDays(monthKey, asOfDate = "") {
  return receivableYtdDays(monthKey, asOfDate);
}
