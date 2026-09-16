import {
  parseOutstandingSheetDate,
  resolveInvoiceDays,
  resolveOverdueDaysFromDueDate,
  toNumber,
} from "./outstanding.js";
import { amountInclVatFromExcl, vatRateForProduct } from "./regionalPricing.js";

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
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function invoiceKey(invoiceDate, voucherNumber) {
  return `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`;
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

/** Gross-up that preserves sign so credit-note lines stay negative. */
function signedAmountInclVat(amountExclVat, vatRate) {
  const excl = toNumber(amountExclVat);
  if (excl === 0) return 0;
  const absIncl = amountInclVatFromExcl(Math.abs(excl), vatRate);
  return excl < 0 ? -absIncl : absIncl;
}

function amountsMatch(left, right, tolerance = 0.02) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

/**
 * Drop invoices that were fully reversed by a same-day credit note (and the
 * credit notes themselves). Same-voucher nets that cancel out are also dropped.
 * Later credit notes are kept out of FIFO so real collection days stay clean;
 * only immediate (same calendar day) full reversals are excluded here.
 */
export function excludeImmediateCreditNoteReversals(invoices = []) {
  const rows = (Array.isArray(invoices) ? invoices : [])
    .map((invoice) => ({
      ...invoice,
      amount_excl_vat: toNumber(invoice?.amount_excl_vat),
      amount: toNumber(invoice?.amount),
      remaining: toNumber(invoice?.amount),
    }))
    .filter((invoice) => Math.abs(invoice.amount) > 0.009);

  const sales = rows
    .filter((invoice) => invoice.amount > 0.009)
    .sort((left, right) => {
      if (left.invoice_date !== right.invoice_date) {
        return left.invoice_date.localeCompare(right.invoice_date);
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });
  const creditNotes = rows
    .filter((invoice) => invoice.amount < -0.009)
    .sort((left, right) => {
      if (left.invoice_date !== right.invoice_date) {
        return left.invoice_date.localeCompare(right.invoice_date);
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });

  const reversedSalesKeys = new Set();
  const usedCreditNoteKeys = new Set();

  creditNotes.forEach((creditNote) => {
    const creditKey = invoiceKey(creditNote.invoice_date, creditNote.voucher_number);
    if (usedCreditNoteKeys.has(creditKey)) return;
    const creditAbs = Math.abs(creditNote.amount);
    const match = sales.find((sale) => {
      const saleKey = invoiceKey(sale.invoice_date, sale.voucher_number);
      if (reversedSalesKeys.has(saleKey)) return false;
      if (sale.invoice_date !== creditNote.invoice_date) return false;
      return amountsMatch(sale.amount, creditAbs);
    });
    if (!match) return;
    reversedSalesKeys.add(invoiceKey(match.invoice_date, match.voucher_number));
    usedCreditNoteKeys.add(creditKey);
  });

  return sales.filter((sale) => !reversedSalesKeys.has(invoiceKey(sale.invoice_date, sale.voucher_number)));
}

/**
 * Collapse sales history lines into invoice-level rows (voucher + date).
 * Sales amounts are exclusive of VAT; receipts are inclusive, so each line is
 * grossed up at 15% unless it is a gloves (VAT-exempt) product.
 * Credit-note lines (negative sales) net within a voucher; invoices fully
 * reversed by a same-day credit note are excluded from settlement.
 */
export function buildSalesInvoices(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    const invoiceDate = dateOnly(row?.transaction_date);
    if (!invoiceDate) return;
    const amountExclVat = toNumber(row?.sales_amount);
    if (amountExclVat === 0) return;

    const vatRate = vatRateForProduct({
      category: row?.category,
      item_name: row?.item_name,
      item_code: row?.item_code,
    });
    const amountInclVat = signedAmountInclVat(amountExclVat, vatRate);

    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const key = `${invoiceDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      invoice_date: invoiceDate,
      voucher_number: voucher,
      amount_excl_vat: 0,
      amount: 0,
      remaining: 0,
    };
    current.amount_excl_vat += amountExclVat;
    current.amount += amountInclVat;
    current.remaining = current.amount;
    map.set(key, current);
  });

  return excludeImmediateCreditNoteReversals([...map.values()]);
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
          vch_no: receipt.vch_no,
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
      // Prefer the outstanding file's invoice age so Unpaid / oldest matches the upload table.
      const invoiceDays = resolveInvoiceDays(invoice, todayIso);
      const calendarDays = invoiceDate ? (isoDaysBetween(todayIso, invoiceDate) || 0) : 0;
      const openDays = invoiceDays > 0 ? invoiceDays : calendarDays;
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

  // Prefer invoice / bucket totals so Unpaid Bills matches the outstanding tables
  // (customer total_outstanding can be a rounded/header figure off by ~1).
  const invoiceSum = invoices.reduce((total, row) => total + row.pending_amount, 0);
  const bucketSum = Object.values(outstandingCustomer?.buckets || {}).reduce(
    (total, value) => total + toNumber(value),
    0,
  );
  const headerTotal = toNumber(outstandingCustomer?.total_outstanding);
  const totalOutstanding = invoiceSum > 0
    ? invoiceSum
    : (bucketSum > 0 ? bucketSum : headerTotal);
  const openInvoiceCount = invoices.length > 0
    ? invoices.length
    : (toNumber(outstandingCustomer?.open_invoices) || 0);
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

function normalizeRef(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Detailed customer settlement view: invoices, FIFO payment chunks, and datewise sales/collections.
 * When outstanding invoice rows exist, Open / status follow that upload (book truth), not FIFO residual.
 * FIFO is kept for payment-days on historically settled chunks.
 */
export function buildPaymentSettlementLedger({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const { invoices, allocations, unmatchedReceiptAmount } = matchPaymentsFifo(transactions, receipts);
  const summary = buildPaymentBehavior({
    transactions,
    receipts,
    outstandingCustomer,
    outstandingInvoices,
    todayIso: today,
  });
  const outstanding = summarizeOutstandingUnpaid(outstandingCustomer, outstandingInvoices, today);
  const outstandingByRef = new Map();
  outstanding.invoices.forEach((row) => {
    const key = normalizeRef(row.ref_no);
    if (!key) return;
    outstandingByRef.set(key, row);
  });
  const hasOutstandingRows = outstanding.invoices.length > 0;

  const settlementsByInvoice = new Map();
  allocations.forEach((row) => {
    const key = invoiceKey(row.invoice_date, row.voucher_number);
    const list = settlementsByInvoice.get(key) || [];
    list.push({ ...row });
    settlementsByInvoice.set(key, list);
  });

  const matchedOutstandingRefs = new Set();

  const invoiceRows = invoices.map((invoice) => {
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    const settlements = (settlementsByInvoice.get(key) || []).sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
    const fifoPaid = settlements.reduce((total, row) => total + toNumber(row.amount), 0);
    const fifoRemaining = toNumber(invoice.remaining);
    const amountInclVat = toNumber(invoice.amount);
    const outstandingMatch = outstandingByRef.get(normalizeRef(invoice.voucher_number)) || null;
    if (outstandingMatch) {
      matchedOutstandingRefs.add(normalizeRef(invoice.voucher_number));
    }

    let remaining = fifoRemaining;
    let paidAmount = fifoPaid;
    let outstandingPending = null;
    let openSource = "fifo";

    if (hasOutstandingRows) {
      openSource = "outstanding";
      outstandingPending = outstandingMatch ? toNumber(outstandingMatch.pending_amount) : 0;
      remaining = outstandingPending;
      // Book-settled amount = sales incl VAT − outstanding pending (credit notes / extra receipts).
      paidAmount = Math.max(0, amountInclVat - remaining);
    }

    const weightedDays = fifoPaid > 0
      ? settlements.reduce((total, row) => total + (Number(row.days || 0) * toNumber(row.amount)), 0) / fifoPaid
      : null;

    let status = "Open";
    if (remaining <= 0.009) {
      status = amountInclVat > 0.009 || fifoPaid > 0.009 ? "Paid" : "Open";
      if (remaining <= 0.009 && amountInclVat <= 0.009 && fifoPaid <= 0.009) status = "Paid";
    } else if (paidAmount > 0.009 && remaining > 0.009) {
      status = "Partial";
    }

    const openDays = remaining > 0.009
      ? (
        outstandingMatch?.open_days
        || isoDaysBetween(today, invoice.invoice_date)
        || 0
      )
      : 0;

    return {
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      amount_excl_vat: toNumber(invoice.amount_excl_vat),
      amount_incl_vat: amountInclVat,
      paid_amount: paidAmount,
      remaining,
      fifo_remaining: fifoRemaining,
      outstanding_pending: outstandingPending,
      open_source: openSource,
      status,
      payment_days: fifoPaid > 0.009 ? roundDays(weightedDays) : null,
      open_days: openDays,
      settlements,
    };
  });

  // Outstanding refs not found in sales history still belong in Open.
  outstanding.invoices.forEach((row) => {
    const ref = normalizeRef(row.ref_no);
    if (!ref || matchedOutstandingRefs.has(ref)) return;
    invoiceRows.push({
      invoice_date: row.invoice_date || "",
      voucher_number: row.ref_no,
      amount_excl_vat: 0,
      amount_incl_vat: toNumber(row.pending_amount),
      paid_amount: 0,
      remaining: toNumber(row.pending_amount),
      fifo_remaining: null,
      outstanding_pending: toNumber(row.pending_amount),
      open_source: "outstanding",
      status: "Open",
      payment_days: null,
      open_days: row.open_days || 0,
      settlements: [],
    });
  });

  invoiceRows.sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const salesByDateMap = new Map();
  invoiceRows.forEach((row) => {
    if (!row.invoice_date) return;
    const current = salesByDateMap.get(row.invoice_date) || {
      date: row.invoice_date,
      invoice_count: 0,
      sales_excl_vat: 0,
      sales_incl_vat: 0,
      paid_amount: 0,
      open_amount: 0,
    };
    current.invoice_count += 1;
    current.sales_excl_vat += row.amount_excl_vat;
    current.sales_incl_vat += row.amount_incl_vat;
    current.paid_amount += row.paid_amount;
    current.open_amount += row.remaining;
    salesByDateMap.set(row.invoice_date, current);
  });

  const collectionsByDateMap = new Map();
  buildSortedReceipts(receipts).forEach((row) => {
    const current = collectionsByDateMap.get(row.receipt_date) || {
      date: row.receipt_date,
      receipt_count: 0,
      collected_amount: 0,
    };
    current.receipt_count += 1;
    current.collected_amount += toNumber(row.amount);
    collectionsByDateMap.set(row.receipt_date, current);
  });

  const allDates = [...new Set([
    ...salesByDateMap.keys(),
    ...collectionsByDateMap.keys(),
  ])].sort();

  const datewise = allDates.map((date) => {
    const sales = salesByDateMap.get(date) || {
      date,
      invoice_count: 0,
      sales_excl_vat: 0,
      sales_incl_vat: 0,
      paid_amount: 0,
      open_amount: 0,
    };
    const collections = collectionsByDateMap.get(date) || {
      date,
      receipt_count: 0,
      collected_amount: 0,
    };
    return {
      date,
      invoice_count: sales.invoice_count,
      sales_excl_vat: sales.sales_excl_vat,
      sales_incl_vat: sales.sales_incl_vat,
      receipt_count: collections.receipt_count,
      collected_amount: collections.collected_amount,
      paid_against_sales: sales.paid_amount,
      open_sales_amount: sales.open_amount,
    };
  });

  const settlementEvents = [...allocations]
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      if (left.invoice_date !== right.invoice_date) {
        return left.invoice_date.localeCompare(right.invoice_date);
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });

  const openSalesAmount = invoiceRows.reduce((total, row) => total + toNumber(row.remaining), 0);
  const totals = {
    sales_excl_vat: invoiceRows.reduce((total, row) => total + row.amount_excl_vat, 0),
    sales_incl_vat: invoiceRows.reduce((total, row) => total + row.amount_incl_vat, 0),
    collected_amount: buildSortedReceipts(receipts).reduce((total, row) => total + toNumber(row.amount), 0),
    paid_amount: invoiceRows.reduce((total, row) => total + row.paid_amount, 0),
    open_sales_amount: openSalesAmount,
    outstanding_unpaid: hasOutstandingRows ? outstanding.totalOutstanding : openSalesAmount,
    open_matches_outstanding: hasOutstandingRows
      ? Math.abs(openSalesAmount - outstanding.totalOutstanding) <= 0.02
      : true,
    unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
    invoice_count: invoiceRows.length,
    paid_invoice_count: invoiceRows.filter((row) => row.status === "Paid").length,
    partial_invoice_count: invoiceRows.filter((row) => row.status === "Partial").length,
    open_invoice_count: invoiceRows.filter((row) => row.status === "Open").length,
  };

  return {
    summary,
    totals,
    invoices: invoiceRows,
    datewise,
    settlementEvents,
    outstandingInvoices: outstanding.invoices,
  };
}

