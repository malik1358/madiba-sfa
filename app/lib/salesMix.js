import { isCashSalesVoucher, isCreditNoteTransaction } from "./paymentBehavior.js";
import { normalizeGrowthFilters, rowMatchesGrowthFilters, salesDateKey } from "./categoryGrowth.js";

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
  };
}

const MIX_FIELDS = [
  "cash_sales_amount",
  "credit_sales_amount",
  "local_sales_amount",
  "import_sales_amount",
  "unclassified_origin_sales_amount",
];

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
  const totals = Object.fromEntries(MIX_FIELDS.map((field) => [
    field,
    months.reduce((sum, month) => sum + Number(monthly[month][field] || 0), 0),
  ]));

  return { months, monthly, totals };
}
