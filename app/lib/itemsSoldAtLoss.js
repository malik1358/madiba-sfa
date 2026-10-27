/**
 * Items sold at a loss: active_sales lines where imported profit_amount is negative.
 * Cost and margin % stay out of the SFA; only GP amount, rate, qty, and sales are shown.
 */

export const ITEMS_SOLD_AT_LOSS_SELECT = [
  "transaction_date",
  "voucher_number",
  "voucher_type",
  "reference",
  "salesman_code",
  "salesman_name",
  "customer_code",
  "customer_name",
  "item_code",
  "item_name",
  "category",
  "local_import",
  "abc_class",
  "quantity",
  "rate",
  "sales_amount",
  "profit_amount",
].join(",");

export const ITEMS_SOLD_AT_LOSS_FILTER_KEYS = [
  "transactionDate",
  "voucherNumber",
  "voucherType",
  "reference",
  "salesmanCode",
  "salesmanName",
  "customerCode",
  "customerName",
  "itemCode",
  "itemName",
  "category",
  "localImport",
  "abcClass",
  "quantity",
  "rate",
  "salesAmount",
  "profitAmount",
];

export function isLossSaleProfit(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount < 0;
}

export function normalizeItemsSoldAtLossDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function mapItemsSoldAtLossRow(row = {}) {
  const profitAmount = Number(row?.profit_amount);
  return {
    transactionDate: normalizeItemsSoldAtLossDate(row?.transaction_date),
    voucherNumber: String(row?.voucher_number || "").trim(),
    voucherType: String(row?.voucher_type || "").trim(),
    reference: String(row?.reference || "").trim(),
    salesmanCode: String(row?.salesman_code || "").trim().toUpperCase(),
    salesmanName: String(row?.salesman_name || "").trim(),
    customerCode: String(row?.customer_code || "").trim().toUpperCase(),
    customerName: String(row?.customer_name || "").trim(),
    itemCode: String(row?.item_code || "").trim().toUpperCase(),
    itemName: String(row?.item_name || "").trim(),
    category: String(row?.category || "").trim(),
    localImport: String(row?.local_import || "").trim(),
    abcClass: String(row?.abc_class || "").trim(),
    quantity: Number(row?.quantity) || 0,
    rate: Number(row?.rate) || 0,
    salesAmount: Number(row?.sales_amount) || 0,
    profitAmount: Number.isFinite(profitAmount) ? profitAmount : 0,
  };
}

export function buildItemsSoldAtLossRows(sourceRows = []) {
  return (sourceRows || [])
    .filter((row) => isLossSaleProfit(row?.profit_amount))
    .map(mapItemsSoldAtLossRow)
    .sort((left, right) => (
      String(right.transactionDate).localeCompare(String(left.transactionDate))
      || String(left.salesmanName || left.salesmanCode).localeCompare(String(right.salesmanName || right.salesmanCode))
      || String(left.customerCode).localeCompare(String(right.customerCode))
      || String(left.itemCode).localeCompare(String(right.itemCode))
      || String(left.voucherNumber).localeCompare(String(right.voucherNumber))
    ));
}

export function summarizeItemsSoldAtLoss(rows = []) {
  return (rows || []).reduce((totals, row) => ({
    lineCount: totals.lineCount + 1,
    quantity: totals.quantity + Number(row.quantity || 0),
    salesAmount: totals.salesAmount + Number(row.salesAmount || 0),
    profitAmount: totals.profitAmount + Number(row.profitAmount || 0),
  }), {
    lineCount: 0,
    quantity: 0,
    salesAmount: 0,
    profitAmount: 0,
  });
}

export function groupItemsSoldAtLossBySalesman(rows = []) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const label = String(row.salesmanName || row.salesmanCode || "").trim() || "Unassigned";
    const key = label.toUpperCase();
    if (!groups.has(key)) {
      groups.set(key, {
        salesman: label,
        salesmanCode: row.salesmanCode || "",
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      totals: summarizeItemsSoldAtLoss(group.rows),
    }))
    .sort((left, right) => left.salesman.localeCompare(right.salesman));
}

export function buildItemsSoldAtLossReport({
  sourceRows = [],
  dateFrom = "",
  dateTo = "",
} = {}) {
  const rows = buildItemsSoldAtLossRows(sourceRows);
  return {
    dateFrom: normalizeItemsSoldAtLossDate(dateFrom),
    dateTo: normalizeItemsSoldAtLossDate(dateTo),
    rows,
    totals: summarizeItemsSoldAtLoss(rows),
  };
}
