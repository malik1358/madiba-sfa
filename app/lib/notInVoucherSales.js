export const NOT_IN_VOUCHER_LABEL = "NOT IN VOUCHER";

export function isNotInVoucherSalesman(value) {
  return String(value || "").trim().toUpperCase() === NOT_IN_VOUCHER_LABEL;
}

export function isNotInVoucherSalesRow(row = {}) {
  return isNotInVoucherSalesman(row.salesman_code || row.salesmanCode)
    || isNotInVoucherSalesman(row.salesman_name || row.salesmanName);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dayKey(value) {
  return String(value || "").slice(0, 10);
}

export function voucherKey(row = {}) {
  return [
    dayKey(row.transaction_date || row.transactionDate),
    String(row.voucher_number || row.voucherNumber || "").trim().toUpperCase(),
    String(row.voucher_type || row.voucherType || "").trim().toUpperCase(),
    String(row.customer_code || row.customerCode || "").trim().toUpperCase(),
  ].join("|");
}

/** Collapse active_sales lines into one row per voucher. */
export function groupNotInVoucherVouchers(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    if (!isNotInVoucherSalesRow(row)) continue;
    const key = voucherKey(row);
    const existing = map.get(key) || {
      transactionDate: dayKey(row.transaction_date || row.transactionDate),
      voucherNumber: String(row.voucher_number || row.voucherNumber || "").trim() || "-",
      voucherType: String(row.voucher_type || row.voucherType || "").trim() || "-",
      customerCode: String(row.customer_code || row.customerCode || "").trim(),
      customerName: String(row.customer_name || row.customerName || "").trim(),
      categories: new Set(),
      lineCount: 0,
      salesAmount: 0,
      profitAmount: 0,
      quantity: 0,
    };
    existing.lineCount += 1;
    existing.salesAmount += toNumber(row.sales_amount ?? row.salesAmount);
    existing.profitAmount += toNumber(row.profit_amount ?? row.profitAmount);
    existing.quantity += toNumber(row.quantity);
    const category = String(row.category || "").trim();
    if (category) existing.categories.add(category);
    if (!existing.customerName && (row.customer_name || row.customerName)) {
      existing.customerName = String(row.customer_name || row.customerName).trim();
    }
    map.set(key, existing);
  }

  return [...map.values()]
    .map((row) => ({
      ...row,
      categories: [...row.categories].sort((a, b) => a.localeCompare(b)),
      salesAmount: Math.round(row.salesAmount * 100) / 100,
      profitAmount: Math.round(row.profitAmount * 100) / 100,
      quantity: Math.round(row.quantity * 1000) / 1000,
    }))
    .sort((a, b) => (
      String(b.transactionDate).localeCompare(String(a.transactionDate))
      || String(a.voucherNumber).localeCompare(String(b.voucherNumber))
      || String(a.customerCode).localeCompare(String(b.customerCode))
    ));
}

export function summarizeNotInVoucherVouchers(vouchers = []) {
  return (vouchers || []).reduce((acc, row) => {
    acc.voucherCount += 1;
    acc.lineCount += Number(row.lineCount || 0);
    acc.salesAmount += Number(row.salesAmount || 0);
    acc.profitAmount += Number(row.profitAmount || 0);
    return acc;
  }, {
    voucherCount: 0,
    lineCount: 0,
    salesAmount: 0,
    profitAmount: 0,
  });
}
