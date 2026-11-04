import {
  isCashSalesVoucher,
  isCreditNoteTransaction,
  parseCreditNoteReferences,
} from "./paymentBehavior.js";
import {
  normalizeGrowthFilters,
  quarterKeyFromMonthKey,
  rowMatchesGrowthFilters,
  salesDateKey,
} from "./categoryGrowth.js";

/** Credit notes dated on the invoice day or within this many days count as clerical. */
export const CLERICAL_CREDIT_NOTE_MAX_DAYS = 7;

/** Charts compare closed periods only — drop open MTD / current quarter. */
export function completeSalesMixChartPeriods(periods = [], currentPeriod = "") {
  const current = String(currentPeriod || "");
  if (!current) return [...(periods || [])];
  return (periods || []).filter((period) => String(period) !== current);
}

function classifySalesOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  const isLocal = /\blocal\b/.test(origin);
  const isImport = /\bimport(?:ed)?\b/.test(origin);
  if (isLocal && !isImport) return "local";
  if (isImport && !isLocal) return "import";
  return "unclassified_origin";
}

function normalizeVoucherToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCustomerToken(value) {
  return String(value || "").trim().toUpperCase();
}

function calendarDaysBetween(fromIso, toIso) {
  const from = salesDateKey(fromIso);
  const to = salesDateKey(toIso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

export function createInvoiceDateIndex() {
  return new Map();
}

function invoiceIndexEntryDate(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return String(entry.date || "").slice(0, 10);
}

export function rememberInvoiceDate(index, row = {}) {
  if (!index || isCreditNoteTransaction(row)) return index;
  const date = salesDateKey(row.transaction_date);
  if (!date) return index;
  const voucher = normalizeVoucherToken(row.voucher_number);
  if (!voucher) return index;
  const customer = normalizeCustomerToken(row.customer_code);
  const entry = {
    date,
    isCash: isCashSalesVoucher(String(row.voucher_number || "").trim()),
    origin: classifySalesOrigin(row.local_import),
  };
  const remember = (key) => {
    if (!key) return;
    const previous = index.get(key);
    const previousDate = invoiceIndexEntryDate(previous);
    if (!previousDate || date < previousDate) index.set(key, entry);
  };
  remember(voucher);
  if (customer) remember(`${customer}::${voucher}`);
  return index;
}

export function indexInvoiceDatesFromRows(index, rows = []) {
  const target = index || createInvoiceDateIndex();
  (rows || []).forEach((row) => rememberInvoiceDate(target, row));
  return target;
}

export function resolveCreditNoteSourceInvoice(row = {}, index = new Map()) {
  const customer = normalizeCustomerToken(row.customer_code);
  const refs = parseCreditNoteReferences(row.reference);
  for (const ref of refs) {
    if (customer) {
      const scoped = index.get(`${customer}::${ref}`);
      if (scoped) return scoped;
    }
    const global = index.get(ref);
    if (global) return global;
  }
  return null;
}

export function resolveCreditNoteSourceInvoiceDate(row = {}, index = new Map()) {
  return invoiceIndexEntryDate(resolveCreditNoteSourceInvoice(row, index));
}

/**
 * clerical = invoice found and CN date is on/before invoice+7 days (includes same-day and CN-before-invoice).
 * return = invoice found and CN is 8+ days later, or no invoice could be matched.
 */
export function creditNoteAdjustmentBucket(row = {}, index = new Map()) {
  if (!isCreditNoteTransaction(row)) return null;
  const cnDate = salesDateKey(row.transaction_date);
  const invoiceDate = resolveCreditNoteSourceInvoiceDate(row, index);
  if (!cnDate || !invoiceDate) return "return";
  const days = calendarDaysBetween(invoiceDate, cnDate);
  if (days == null) return "return";
  if (days <= CLERICAL_CREDIT_NOTE_MAX_DAYS) return "clerical";
  return "return";
}

export function salesMixMeasuresForRow(row = {}, options = {}) {
  const amount = Number(row.sales_amount || 0);
  const isSale = Number.isFinite(amount) && amount > 0 && !isCreditNoteTransaction(row);
  const voucher = String(row.voucher_number || "").trim();
  const origin = classifySalesOrigin(row.local_import);
  const isCash = isCashSalesVoucher(voucher);
  const isAdjustment = isCreditNoteTransaction(row) && Number.isFinite(amount);
  const adjustment = isAdjustment ? -Math.abs(amount) : 0;
  const invoiceDates = options.invoiceDates || createInvoiceDateIndex();
  const bucket = isAdjustment ? creditNoteAdjustmentBucket(row, invoiceDates) : null;
  const isClerical = bucket === "clerical";
  const isReturn = bucket === "return";

  // Fold clerical CNs into the linked invoice's cash/credit and origin buckets.
  let clericalIsCash = isCash;
  let clericalOrigin = origin;
  if (isClerical) {
    const source = resolveCreditNoteSourceInvoice(row, invoiceDates);
    if (source && typeof source === "object") {
      if (typeof source.isCash === "boolean") clericalIsCash = source.isCash;
      if (source.origin) clericalOrigin = source.origin;
    }
  }
  const clericalCash = isClerical && clericalIsCash ? adjustment : 0;
  const clericalCredit = isClerical && !clericalIsCash ? adjustment : 0;
  const clericalLocal = isClerical && clericalOrigin === "local" ? adjustment : 0;
  const clericalImport = isClerical && clericalOrigin === "import" ? adjustment : 0;
  const clericalUnclassified = isClerical && clericalOrigin === "unclassified_origin" ? adjustment : 0;

  return {
    cash_sales_amount: (isSale && isCash ? amount : 0) + clericalCash,
    credit_sales_amount: (isSale && !isCash ? amount : 0) + clericalCredit,
    local_sales_amount: (isSale && origin === "local" ? amount : 0) + clericalLocal,
    import_sales_amount: (isSale && origin === "import" ? amount : 0) + clericalImport,
    unclassified_origin_sales_amount: (isSale && origin === "unclassified_origin" ? amount : 0) + clericalUnclassified,
    clerical_adjustments_amount: isClerical ? adjustment : 0,
    sales_returns_amount: isReturn ? adjustment : 0,
    sales_adjustments_amount: adjustment,
  };
}

const MIX_FIELDS = [
  "cash_sales_amount",
  "credit_sales_amount",
  "local_sales_amount",
  "import_sales_amount",
  "unclassified_origin_sales_amount",
  "clerical_adjustments_amount",
  "sales_returns_amount",
  "sales_adjustments_amount",
];

const PAYMENT_FIELDS = ["cash_sales_amount", "credit_sales_amount"];
const ORIGIN_FIELDS = ["local_sales_amount", "import_sales_amount", "unclassified_origin_sales_amount"];

function sumFields(values, fields) {
  return fields.reduce((sum, field) => sum + Number(values?.[field] || 0), 0);
}

function ratioRows(periods, values, fields) {
  return Object.fromEntries(periods.map((period) => {
    const total = sumFields(values?.[period], fields);
    return [period, Object.fromEntries(fields.map((field) => [
      field,
      total > 0 ? (Number(values?.[period]?.[field] || 0) / total) * 100 : null,
    ]))];
  }));
}

function rowHasStoredMixMeasures(row = {}) {
  return MIX_FIELDS.every((field) => Number.isFinite(Number(row[field])));
}

export function buildSalesMixReport(rows = [], inputFilters = {}, options = {}) {
  const filters = normalizeGrowthFilters(inputFilters);
  const byMonth = new Map();
  const providedIndex = options.invoiceDates;
  const needsLiveClassification = (rows || []).some((row) => !rowHasStoredMixMeasures(row));
  const invoiceDates = providedIndex
    || (needsLiveClassification ? indexInvoiceDatesFromRows(createInvoiceDateIndex(), rows) : createInvoiceDateIndex());

  (rows || []).forEach((row) => {
    if (!rowMatchesGrowthFilters(row, filters)) return;
    const date = salesDateKey(row.transaction_date);
    const month = date ? date.slice(0, 7) : String(row.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;

    const measures = rowHasStoredMixMeasures(row)
      ? row
      : salesMixMeasuresForRow(row, { invoiceDates });
    const current = byMonth.get(month) || Object.fromEntries(MIX_FIELDS.map((field) => [field, 0]));
    MIX_FIELDS.forEach((field) => {
      current[field] += Number(measures[field] || 0);
    });
    byMonth.set(month, current);
  });

  const months = [...byMonth.keys()].sort();
  const monthly = Object.fromEntries(months.map((month) => {
    const row = byMonth.get(month);
    const clerical = Number(row.clerical_adjustments_amount || 0);
    const returns = Number(row.sales_returns_amount || 0);
    const combined = clerical + returns;
    // Older cube facts may only carry the combined adjustment.
    row.sales_adjustments_amount = combined || Number(row.sales_adjustments_amount || 0);
    if (!clerical && !returns && row.sales_adjustments_amount) {
      row.sales_returns_amount = Number(row.sales_adjustments_amount || 0);
    }
    return [month, row];
  }));
  const quarters = [...new Set(months.map(quarterKeyFromMonthKey))].filter(Boolean).sort();
  const quarterMonths = Object.fromEntries(quarters.map((quarter) => [
    quarter,
    months.filter((month) => quarterKeyFromMonthKey(month) === quarter),
  ]));
  const quarterly = Object.fromEntries(quarters.map((quarter) => [
    quarter,
    quarterMonths[quarter].reduce((totals, month) => {
      MIX_FIELDS.forEach((field) => {
        totals[field] += Number(monthly[month][field] || 0);
      });
      return totals;
    }, Object.fromEntries(MIX_FIELDS.map((field) => [field, 0]))),
  ]));
  const totals = Object.fromEntries(MIX_FIELDS.map((field) => [
    field,
    months.reduce((sum, month) => sum + Number(monthly[month][field] || 0), 0),
  ]));
  // Cash/credit already include clerical folds; restore gross, then net = payment + real returns.
  const paymentSales = sumFields(totals, PAYMENT_FIELDS);
  const clerical = Number(totals.clerical_adjustments_amount || 0);
  const returns = Number(totals.sales_returns_amount || 0);
  totals.sales_adjustments_amount = clerical + returns;
  totals.gross_invoice_sales = paymentSales - clerical;
  totals.net_sales = paymentSales + returns;

  const monthlyShares = {
    payment: ratioRows(months, monthly, PAYMENT_FIELDS),
    origin: ratioRows(months, monthly, ORIGIN_FIELDS),
  };
  const quarterlyShares = {
    payment: ratioRows(quarters, quarterly, PAYMENT_FIELDS),
    origin: ratioRows(quarters, quarterly, ORIGIN_FIELDS),
  };

  return { months, monthly, quarters, quarterly, quarterMonths, monthlyShares, quarterlyShares, totals };
}
