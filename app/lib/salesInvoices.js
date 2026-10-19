const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

export function parseIsoDate(value) {
  const text = normalizeText(value).slice(0, 10);
  return ISO_DATE.test(text) ? text : "";
}

export function currentMonthDateRange(todayIso) {
  const today = parseIsoDate(todayIso);
  if (!today) {
    throw new Error("Invalid report date.");
  }

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    from: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    to: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function resolveSalesInvoiceDateRange({ from, to, todayIso }) {
  const defaults = currentMonthDateRange(todayIso);
  let start = parseIsoDate(from) || defaults.from;
  let end = parseIsoDate(to) || defaults.to;

  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs > maxMs) {
    throw new Error("Date range cannot exceed 366 days.");
  }

  return { from: start, to: end };
}

export function resolveInvoiceSalesmanCodes(scope, requestedCode) {
  const requested = normalizeCode(requestedCode);
  const visible = [...new Set((scope?.visibleSalesmanCodes || []).map(normalizeCode).filter(Boolean))];

  if (requested) {
    if (scope?.hasAllAccess || visible.includes(requested)) {
      return [requested];
    }
    throw new Error("You do not have access to that salesman's invoices.");
  }

  if (scope?.hasAllAccess) return null;
  return visible;
}

export function salesInvoiceKey(row) {
  const date = parseIsoDate(row?.transaction_date) || String(row?.transaction_date || "").slice(0, 10);
  const voucher = normalizeText(row?.voucher_number || row?.reference) || `ROW-${row?.id || ""}`;
  const customer = normalizeCode(row?.customer_code);
  return `${date}|${voucher}|${customer}`;
}

export function groupSalesRowsIntoInvoices(rows) {
  const invoices = new Map();

  (rows || []).forEach((row) => {
    const key = salesInvoiceKey(row);
    const existing = invoices.get(key) || {
      key,
      transaction_date: parseIsoDate(row?.transaction_date) || String(row?.transaction_date || "").slice(0, 10),
      voucher_number: normalizeText(row?.voucher_number || row?.reference),
      customer_code: normalizeText(row?.customer_code),
      customer_name: normalizeText(row?.customer_name),
      salesman_code: normalizeText(row?.salesman_code),
      salesman_name: normalizeText(row?.salesman_name),
      total_amount: 0,
      item_count: 0,
      items: [],
    };

    if (!existing.customer_name && normalizeText(row?.customer_name)) {
      existing.customer_name = normalizeText(row.customer_name);
    }
    if (!existing.salesman_name && normalizeText(row?.salesman_name)) {
      existing.salesman_name = normalizeText(row.salesman_name);
    }

    existing.items.push({
      id: row?.id || null,
      item_code: normalizeText(row?.item_code),
      item_name: normalizeText(row?.item_name),
      category: normalizeText(row?.category),
      quantity: Number(row?.quantity || 0),
      rate: Number(row?.rate || 0),
      sales_amount: Number(row?.sales_amount || 0),
    });
    existing.total_amount += Number(row?.sales_amount || 0);
    existing.item_count = existing.items.length;
    invoices.set(key, existing);
  });

  return [...invoices.values()].sort((a, b) => {
    const byDate = String(b.transaction_date || "").localeCompare(String(a.transaction_date || ""));
    if (byDate !== 0) return byDate;
    const byVoucher = String(a.voucher_number || "").localeCompare(String(b.voucher_number || ""));
    if (byVoucher !== 0) return byVoucher;
    return String(a.customer_name || a.customer_code || "").localeCompare(String(b.customer_name || b.customer_code || ""));
  });
}

export function summarizeSalesInvoices(invoices) {
  const rows = invoices || [];
  const customers = new Set(rows.map((row) => normalizeCode(row?.customer_code)).filter(Boolean));

  return {
    invoiceCount: rows.length,
    totalAmount: rows.reduce((sum, row) => sum + Number(row?.total_amount || 0), 0),
    customerCount: customers.size,
  };
}
