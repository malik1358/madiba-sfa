import { previousMonthKey, salesDateKey } from "./categoryGrowth.js";
import { lastDayOfMonth } from "./biReportPeriod.js";
import { isCashSalesVoucher } from "./paymentBehavior.js";

export const RECEIVABLE_DAYS_DATASET_KEY = "receivable_days_monthly_v1";

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

function daysForMonthRow(month, creditMap, arMap, asOf) {
  const receivables = Math.round(toNumber(arMap[month]) * 100) / 100;
  const creditSalesMonth = Math.round(toNumber(creditMap[month]) * 100) / 100;
  const creditSalesYtd = creditSalesYtdThroughMonth(creditMap, month);
  const daysYtd = receivableYtdDays(month, asOf);
  const daysValue = receivableDays(receivables, creditSalesYtd, daysYtd);
  return {
    receivables,
    credit_sales: creditSalesMonth,
    credit_sales_ytd: creditSalesYtd,
    days: daysYtd,
    receivable_days: daysValue,
  };
}

/**
 * Build the monthwise receivable-days report from monthly AR and credit sales maps.
 * Days use YTD credit sales and YTD calendar days through each month-end.
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
    return {
      month,
      ...current,
      previous_receivable_days: previousDays,
      change_days: changeDays,
      improved: changeDays != null ? changeDays < 0 : null,
      tone: receivableDaysChangeTone(current.receivable_days, previousDays),
      is_current: month === currentMonth,
    };
  });

  const latestComplete = [...rows].reverse().find((row) => !row.is_current && row.receivable_days != null) || null;
  const totals = rows.reduce((acc, row) => {
    acc.receivables += toNumber(row.receivables);
    acc.credit_sales += toNumber(row.credit_sales);
    return acc;
  }, { receivables: 0, credit_sales: 0 });
  totals.receivables = Math.round(totals.receivables * 100) / 100;
  totals.credit_sales = Math.round(totals.credit_sales * 100) / 100;
  const lastRow = rows.at(-1) || null;
  totals.credit_sales_ytd = lastRow ? toNumber(lastRow.credit_sales_ytd) : 0;
  totals.receivable_days = lastRow?.receivable_days ?? null;

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
    formula: "(month_end_receivables / credit_sales_ytd) × days_ytd",
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
