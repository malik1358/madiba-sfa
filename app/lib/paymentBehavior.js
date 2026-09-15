import {
  parseOutstandingSheetDate,
  resolveInvoiceDays,
  resolveOverdueDaysFromDueDate,
  toNumber,
} from "./outstanding.js";

function dateOnly(value) {
  return parseOutstandingSheetDate(value) || String(value || "").slice(0, 10);
}

function isoDaysBetween(laterIso, earlierIso) {
  const later = dateOnly(laterIso);
  const earlier = dateOnly(earlierIso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(later) || !/^\d{4}-\d{2}-\d{2}$/.test(earlier)) return null;
  const laterMs = Date.parse(`${later}T00:00:00Z`);
  const earlierMs = Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.max(0, Math.round((laterMs - earlierMs) / 86400000));
}

function roundDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function median(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Collapse sales history lines into invoice-level rows (voucher + date).
 */
export function buildSalesInvoices(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    const invoiceDate = dateOnly(row?.transaction_date);
    if (!invoiceDate) return;
    const amount = toNumber(row?.sales_amount);
    if (amount <= 0) return;

    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const key = `${invoiceDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      invoice_date: invoiceDate,
      voucher_number: voucher,
      amount: 0,
      remaining: 0,
    };
    current.amount += amount;
    current.remaining = current.amount;
    map.set(key, current);
  });

  return [...map.values()].sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return left.invoice_date.localeCompare(right.invoice_date);
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });
}

export function buildSortedReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    .map((row) => ({
      receipt_date: dateOnly(row?.receipt_date),
      amount: toNumber(row?.amount),
      vch_no: String(row?.vch_no || "").trim(),
    }))
    .filter((row) => row.receipt_date && row.amount > 0)
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
}

/**
 * FIFO-match receipts onto sales invoices to estimate days-to-pay.
 * Receipts have no invoice ref, so oldest open invoice is paid first.
 */
export function matchPaymentsFifo(transactions = [], receipts = []) {
  const invoices = buildSalesInvoices(transactions).map((invoice) => ({ ...invoice }));
  const paymentRows = buildSortedReceipts(receipts);
  const allocations = [];
  let unmatchedReceiptAmount = 0;

  for (const receipt of paymentRows) {
    let remaining = receipt.amount;

    for (const invoice of invoices) {
      if (remaining <= 0.009) break;
      if (invoice.remaining <= 0.009) continue;
      if (receipt.receipt_date < invoice.invoice_date) continue;

      const applied = Math.min(remaining, invoice.remaining);
      const days = isoDaysBetween(receipt.receipt_date, invoice.invoice_date);
      if (days != null && applied > 0) {
        allocations.push({
          invoice_date: invoice.invoice_date,
          voucher_number: invoice.voucher_number,
          receipt_date: receipt.receipt_date,
          amount: applied,
          days,
        });
      }
      invoice.remaining = Math.max(0, invoice.remaining - applied);
      remaining = Math.max(0, remaining - applied);
    }

    unmatchedReceiptAmount += Math.max(0, remaining);
  }

  return {
    invoices,
    allocations,
    unmatchedReceiptAmount,
  };
}

function summarizeOutstandingUnpaid(outstandingCustomer = null, outstandingInvoices = [], todayIso) {
  const invoices = (Array.isArray(outstandingInvoices) ? outstandingInvoices : [])
    .map((invoice) => {
      const pending = toNumber(invoice?.pending_amount);
      if (pending <= 0) return null;
      const invoiceDate = dateOnly(invoice?.invoice_date);
      const overdueDays = resolveOverdueDaysFromDueDate(invoice, todayIso);
      const invoiceDays = resolveInvoiceDays(invoice, todayIso);
      const openDays = Math.max(overdueDays, invoiceDays, invoiceDate ? (isoDaysBetween(todayIso, invoiceDate) || 0) : 0);
      return {
        invoice_date: invoiceDate,
        ref_no: String(invoice?.ref_no || "").trim(),
        pending_amount: pending,
        open_days: openDays,
        overdue_days: overdueDays,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.open_days - left.open_days || right.pending_amount - left.pending_amount);

  const totalOutstanding = toNumber(outstandingCustomer?.total_outstanding)
    || invoices.reduce((total, row) => total + row.pending_amount, 0);
  const openInvoiceCount = toNumber(outstandingCustomer?.open_invoices) || invoices.length;
  const oldestOpenDays = invoices.length ? invoices[0].open_days : 0;
  const overdueCount = invoices.filter((row) => row.overdue_days > 0).length;

  return {
    totalOutstanding,
    openInvoiceCount,
    oldestOpenDays,
    overdueCount,
    invoices,
  };
}

export function emptyPaymentBehavior() {
  return {
    avgDaysToPay: null,
    medianDaysToPay: null,
    paidAllocationCount: 0,
    paidAmount: 0,
    matchedInvoiceCount: 0,
    unpaidFromSalesCount: 0,
    unpaidFromSalesAmount: 0,
    oldestUnpaidFromSalesDays: 0,
    outstandingTotal: 0,
    outstandingOpenInvoices: 0,
    outstandingOldestDays: 0,
    outstandingOverdueCount: 0,
    summaryLabel: "Payment days unavailable",
  };
}

/**
 * Combine sales+receipt FIFO days-to-pay with outstanding unpaid bill stats.
 */
export function buildPaymentBehavior({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const { invoices, allocations } = matchPaymentsFifo(transactions, receipts);
  const unpaidFromSales = invoices
    .filter((invoice) => toNumber(invoice.remaining) > 0.009)
    .map((invoice) => ({
      ...invoice,
      open_days: isoDaysBetween(today, invoice.invoice_date) || 0,
    }))
    .sort((left, right) => right.open_days - left.open_days);

  const paidAmount = allocations.reduce((total, row) => total + row.amount, 0);
  const weightedDays = paidAmount > 0
    ? allocations.reduce((total, row) => total + (row.days * row.amount), 0) / paidAmount
    : null;
  const medianDays = median(allocations.map((row) => row.days));
  const outstanding = summarizeOutstandingUnpaid(outstandingCustomer, outstandingInvoices, today);

  const avgDaysToPay = roundDays(weightedDays);
  const medianDaysToPay = roundDays(medianDays);
  const matchedInvoiceCount = new Set(
    allocations.map((row) => `${row.invoice_date}::${row.voucher_number}`),
  ).size;

  let summaryLabel = "Payment days unavailable";
  if (avgDaysToPay != null) {
    summaryLabel = `Avg ${avgDaysToPay} days to pay`;
    if (medianDaysToPay != null && medianDaysToPay !== avgDaysToPay) {
      summaryLabel += ` (median ${medianDaysToPay})`;
    }
  }

  if (outstanding.totalOutstanding > 0) {
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Unpaid ${outstanding.totalOutstanding.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (outstanding.oldestOpenDays > 0) {
      summaryLabel += ` / oldest ${outstanding.oldestOpenDays}d`;
    }
  } else if (unpaidFromSales.length > 0) {
    const unpaidAmount = unpaidFromSales.reduce((total, row) => total + toNumber(row.remaining), 0);
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Open sales ${unpaidAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (unpaidFromSales[0]?.open_days > 0) {
      summaryLabel += ` / oldest ${unpaidFromSales[0].open_days}d`;
    }
  }

  return {
    avgDaysToPay,
    medianDaysToPay,
    paidAllocationCount: allocations.length,
    paidAmount,
    matchedInvoiceCount,
    unpaidFromSalesCount: unpaidFromSales.length,
    unpaidFromSalesAmount: unpaidFromSales.reduce((total, row) => total + toNumber(row.remaining), 0),
    oldestUnpaidFromSalesDays: unpaidFromSales[0]?.open_days || 0,
    outstandingTotal: outstanding.totalOutstanding,
    outstandingOpenInvoices: outstanding.openInvoiceCount,
    outstandingOldestDays: outstanding.oldestOpenDays,
    outstandingOverdueCount: outstanding.overdueCount,
    summaryLabel,
  };
}

export function formatPaymentDaysLabel(behavior) {
  if (!behavior || behavior.avgDaysToPay == null) return "—";
  return `${behavior.avgDaysToPay} days`;
}
