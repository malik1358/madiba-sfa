import { isCashSalesVoucher, isCreditNoteTransaction } from "./paymentBehavior.js";
import {
  normalizeGrowthFilters,
  quarterKeyFromMonthKey,
  rowMatchesGrowthFilters,
  salesDateKey,
} from "./categoryGrowth.js";

function classifySalesOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  const isLocal = /\blocal\b/.test(origin);
  const isImport = /\bimport(?:ed)?\b/.test(origin);
  if (isLocal && !isImport) return "local";
  if (isImport && !isLocal) return "import";
  return "unclassified_origin";
}

export function salesMixMeasuresForRow(row = {}) {
  const amount = Number(row.sales_amount || 0);
  const isSale = Number.isFinite(amount) && amount > 0 && !isCreditNoteTransaction(row);
  const voucher = String(row.voucher_number || "").trim();
  const origin = classifySalesOrigin(row.local_import);

  return {
    cash_sales_amount: isSale && isCashSalesVoucher(voucher) ? amount : 0,
    credit_sales_amount: isSale && !isCashSalesVoucher(voucher) ? amount : 0,
    local_sales_amount: isSale && origin === "local" ? amount : 0,
    import_sales_amount: isSale && origin === "import" ? amount : 0,
    unclassified_origin_sales_amount: isSale && origin === "unclassified_origin" ? amount : 0,
    sales_adjustments_amount: isCreditNoteTransaction(row) && Number.isFinite(amount) ? -Math.abs(amount) : 0,
  };
}

const MIX_FIELDS = [
  "cash_sales_amount",
  "credit_sales_amount",
  "local_sales_amount",
  "import_sales_amount",
  "unclassified_origin_sales_amount",
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

export function buildSalesMixReport(rows = [], inputFilters = {}) {
  const filters = normalizeGrowthFilters(inputFilters);
  const byMonth = new Map();

  (rows || []).forEach((row) => {
    if (!rowMatchesGrowthFilters(row, filters)) return;
    const date = salesDateKey(row.transaction_date);
    const month = date ? date.slice(0, 7) : String(row.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;

    const storedMeasures = MIX_FIELDS.every((field) => Number.isFinite(Number(row[field])));
    const measures = storedMeasures ? row : salesMixMeasuresForRow(row);
    const current = byMonth.get(month) || Object.fromEntries(MIX_FIELDS.map((field) => [field, 0]));
    MIX_FIELDS.forEach((field) => {
      current[field] += Number(measures[field] || 0);
    });
    byMonth.set(month, current);
  });

  const months = [...byMonth.keys()].sort();
  const monthly = Object.fromEntries(months.map((month) => [month, byMonth.get(month)]));
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
  totals.gross_invoice_sales = sumFields(totals, PAYMENT_FIELDS);
  totals.net_sales = totals.gross_invoice_sales + Number(totals.sales_adjustments_amount || 0);

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
