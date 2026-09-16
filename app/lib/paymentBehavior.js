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

function median(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Same-day or next-day credit notes count as an immediate reverse (not payment). */
export const IMMEDIATE_REVERSAL_MAX_DAYS = 1;
const AMOUNT_TOLERANCE = 0.02;

function invoiceKey(invoiceDate, voucherNumber) {
  return `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`;
}

function normalizeRef(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function amountsMatch(left, right, tolerance = AMOUNT_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

function lineVatInclAmount(row, amountExclVat) {
  const vatRate = vatRateForProduct({
    category: row?.category,
    item_name: row?.item_name,
    item_code: row?.item_code,
  });
  return amountInclVatFromExcl(amountExclVat, vatRate);
}

function sortVoucherRows(rows) {
  return [...rows].sort((left, right) => {
    const leftDate = left.invoice_date || left.credit_date || "";
    const rightDate = right.invoice_date || right.credit_date || "";
    if (leftDate !== rightDate) return String(leftDate).localeCompare(String(rightDate));
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });
}

/**
 * Collapse sales history lines into invoice-level rows (voucher + date).
 * Sales amounts are exclusive of VAT; receipts are inclusive, so each line is
 * grossed up at 15% unless it is a gloves (VAT-exempt) product.
 */
export function buildSalesInvoices(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    const invoiceDate = dateOnly(row?.transaction_date);
    if (!invoiceDate) return;
    const amountExclVat = toNumber(row?.sales_amount);
    if (amountExclVat <= 0) return;

    const amountInclVat = lineVatInclAmount(row, amountExclVat);
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

  return sortVoucherRows([...map.values()]);
}

/**
 * Collapse negative sales lines into credit-note vouchers (absolute amounts, VAT-incl).
 */
export function buildCreditNotes(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    const creditDate = dateOnly(row?.transaction_date);
    if (!creditDate) return;
    const amountExclVat = toNumber(row?.sales_amount);
    if (amountExclVat >= 0) return;

    const absExcl = Math.abs(amountExclVat);
    const amountInclVat = lineVatInclAmount(row, absExcl);
    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const reference = String(row?.reference || "").trim();
    const key = `${creditDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      credit_date: creditDate,
      voucher_number: voucher,
      reference,
      amount_excl_vat: 0,
      amount: 0,
      remaining: 0,
    };
    current.amount_excl_vat += absExcl;
    current.amount += amountInclVat;
    current.remaining = current.amount;
    if (reference && !current.reference) current.reference = reference;
    map.set(key, current);
  });

  return sortVoucherRows([...map.values()]);
}

/**
 * Pair invoices with credit notes posted the same day or next day for the same amount.
 * These are voids/reversals, not customer payments — exclude from avg days to pay.
 */
export function findImmediateCreditNoteReversals(
  invoices = [],
  creditNotes = [],
  { maxDays = IMMEDIATE_REVERSAL_MAX_DAYS } = {},
) {
  const unusedNotes = (Array.isArray(creditNotes) ? creditNotes : []).map((note) => ({
    ...note,
    remaining: toNumber(note.amount),
  }));
  const reversals = [];
  const reversedKeys = new Set();

  for (const invoice of (Array.isArray(invoices) ? invoices : [])) {
    const invoiceAmount = toNumber(invoice.amount);
    if (invoiceAmount <= AMOUNT_TOLERANCE) continue;

    const candidates = unusedNotes
      .map((note, index) => {
        if (toNumber(note.remaining) <= AMOUNT_TOLERANCE) return null;
        if (String(note.credit_date || "") < String(invoice.invoice_date || "")) return null;
        const days = isoDaysBetween(note.credit_date, invoice.invoice_date);
        if (days == null || days > maxDays) return null;

        const amountOk = amountsMatch(note.remaining, invoiceAmount)
          || amountsMatch(note.amount, invoiceAmount);
        const noteRef = normalizeRef(note.reference || note.voucher_number);
        const invoiceRef = normalizeRef(invoice.voucher_number);
        const refHit = Boolean(
          invoiceRef
          && noteRef
          && (noteRef.includes(invoiceRef) || invoiceRef.includes(noteRef)),
        );
        if (!amountOk && !refHit) return null;
        if (!amountOk && refHit && toNumber(note.remaining) + AMOUNT_TOLERANCE < invoiceAmount) {
          return null;
        }
        // Full reverse only — partial credit notes stay in the normal ledger.
        if (!amountsMatch(note.remaining, invoiceAmount) && !amountsMatch(note.amount, invoiceAmount)) {
          return null;
        }

        return {
          note,
          index,
          days,
          score: (refHit ? 1000 : 0) + (amountOk ? 100 : 0) - days,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = candidates[0];
    if (!best) continue;

    best.note.remaining = 0;
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    reversedKeys.add(key);
    reversals.push({
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      amount_excl_vat: toNumber(invoice.amount_excl_vat),
      amount_incl_vat: invoiceAmount,
      credit_note_date: best.note.credit_date,
      credit_note_voucher: best.note.voucher_number,
      credit_note_amount: toNumber(best.note.amount),
      credit_note_reference: best.note.reference || "",
      reversal_days: best.days,
      status: "Reversed",
    });
  }

  return { reversals, reversedKeys };
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
 * Invoices reversed immediately by credit notes are excluded from matching.
 */
export function matchPaymentsFifo(transactions = [], receipts = []) {
  const allInvoices = buildSalesInvoices(transactions).map((invoice) => ({ ...invoice }));
  const creditNotes = buildCreditNotes(transactions);
  const { reversals, reversedKeys } = findImmediateCreditNoteReversals(allInvoices, creditNotes);
  const invoices = allInvoices
    .filter((invoice) => !reversedKeys.has(invoiceKey(invoice.invoice_date, invoice.voucher_number)))
    .map((invoice) => ({ ...invoice, remaining: toNumber(invoice.amount) }));
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
    reversedInvoices: reversals,
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

/**
 * Days observations for amount-weighted avg days to pay.
 * Paid chunks use sales→receipt days. Open unpaid use current age as a
 * right-censored lower bound (best practice for credit risk — paid-only
 * averages hide slow payers with old open bills).
 */
export function buildDaysToPayObservations({
  allocations = [],
  openInvoices = [],
} = {}) {
  const observations = [];

  (Array.isArray(allocations) ? allocations : []).forEach((row) => {
    const amount = toNumber(row?.amount);
    const days = Number(row?.days);
    if (amount > 0.009 && Number.isFinite(days) && days >= 0) {
      observations.push({ amount, days, source: "paid" });
    }
  });

  (Array.isArray(openInvoices) ? openInvoices : []).forEach((row) => {
    const amount = toNumber(row?.pending_amount ?? row?.remaining);
    const days = Number(row?.open_days);
    if (amount > 0.009 && Number.isFinite(days) && days >= 0) {
      observations.push({ amount, days, source: "open" });
    }
  });

  return observations;
}

export function weightedAverageDays(observations = []) {
  const totalAmount = (Array.isArray(observations) ? observations : [])
    .reduce((total, row) => total + toNumber(row.amount), 0);
  if (totalAmount <= 0.009) return null;
  const weighted = observations.reduce(
    (total, row) => total + (Number(row.days) * toNumber(row.amount)),
    0,
  );
  return weighted / totalAmount;
}

export function emptyPaymentBehavior() {
  return {
    avgDaysToPay: null,
    avgDaysPaidOnly: null,
    medianDaysToPay: null,
    paidAllocationCount: 0,
    paidAmount: 0,
    openAmountInAvg: 0,
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
 * Avg days blends collected receipts with open unpaid at current Invoice Day
 * (amount-weighted). Paid-only avg is kept as avgDaysPaidOnly for comparison.
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
      pending_amount: toNumber(invoice.remaining),
      open_days: isoDaysBetween(today, invoice.invoice_date) || 0,
    }))
    .sort((left, right) => right.open_days - left.open_days);

  const outstanding = summarizeOutstandingUnpaid(outstandingCustomer, outstandingInvoices, today);
  // Prefer outstanding upload rows (book truth) for open age; else FIFO residual.
  const openForAvg = outstanding.invoices.length > 0
    ? outstanding.invoices
    : unpaidFromSales;

  const paidObservations = buildDaysToPayObservations({ allocations, openInvoices: [] });
  const blendedObservations = buildDaysToPayObservations({
    allocations,
    openInvoices: openForAvg,
  });

  const paidAmount = paidObservations.reduce((total, row) => total + row.amount, 0);
  const openAmountInAvg = blendedObservations
    .filter((row) => row.source === "open")
    .reduce((total, row) => total + row.amount, 0);

  const avgDaysPaidOnly = roundDays(weightedAverageDays(paidObservations));
  const avgDaysToPay = roundDays(weightedAverageDays(blendedObservations));
  const medianDaysToPay = roundDays(median(blendedObservations.map((row) => row.days)));
  const matchedInvoiceCount = new Set(
    allocations.map((row) => `${row.invoice_date}::${row.voucher_number}`),
  ).size;

  let summaryLabel = "Payment days unavailable";
  if (avgDaysToPay != null) {
    summaryLabel = `Avg ${avgDaysToPay} days to pay`;
    if (openAmountInAvg > 0.009) {
      summaryLabel += " (paid + open at current age)";
    } else {
      summaryLabel += " from receipts";
    }
    if (medianDaysToPay != null && medianDaysToPay !== avgDaysToPay) {
      summaryLabel += ` · median ${medianDaysToPay}`;
    }
    if (
      avgDaysPaidOnly != null
      && openAmountInAvg > 0.009
      && avgDaysPaidOnly !== avgDaysToPay
    ) {
      summaryLabel += ` · paid-only ${avgDaysPaidOnly}d`;
    }
  }

  if (outstanding.totalOutstanding > 0) {
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Unpaid ${outstanding.totalOutstanding.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (outstanding.oldestOpenDays > 0) {
      summaryLabel += ` / oldest open ${outstanding.oldestOpenDays}d`;
    }
  } else if (unpaidFromSales.length > 0) {
    const unpaidAmount = unpaidFromSales.reduce((total, row) => total + toNumber(row.remaining), 0);
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Open sales ${unpaidAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (unpaidFromSales[0]?.open_days > 0) {
      summaryLabel += ` / oldest open ${unpaidFromSales[0].open_days}d`;
    }
  }

  return {
    avgDaysToPay,
    avgDaysPaidOnly,
    medianDaysToPay,
    paidAllocationCount: allocations.length,
    paidAmount,
    openAmountInAvg,
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

/**
 * Detailed customer settlement view: invoices, FIFO payment chunks, and datewise sales/collections.
 * When outstanding invoice rows exist, Open / status follow that upload (book truth), not FIFO residual.
 * FIFO is kept for payment-days on historically settled chunks; avg days also
 * includes open unpaid at current age (blended credit-risk metric).
 * Invoices reversed immediately by credit notes are listed separately and excluded from avg days.
 */
export function buildPaymentSettlementLedger({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const {
    invoices,
    allocations,
    unmatchedReceiptAmount,
    reversedInvoices = [],
  } = matchPaymentsFifo(transactions, receipts);
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
  const reversedRows = [...reversedInvoices].sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const invoiceSalesExclVat = invoiceRows.reduce((total, row) => total + row.amount_excl_vat, 0);
  const invoiceSalesInclVat = invoiceRows.reduce((total, row) => total + row.amount_incl_vat, 0);
  const reversedSalesExclVat = reversedRows.reduce((total, row) => total + toNumber(row.amount_excl_vat), 0);
  const reversedSalesInclVat = reversedRows.reduce((total, row) => total + toNumber(row.amount_incl_vat), 0);
  // KPI Sales includes reversed invoices (still excluded from FIFO / avg days).
  const salesExclVat = invoiceSalesExclVat + reversedSalesExclVat;
  const salesInclVat = invoiceSalesInclVat + reversedSalesInclVat;
  const paidAmount = invoiceRows.reduce((total, row) => total + row.paid_amount, 0) + reversedSalesInclVat;
  const collectedAmount = buildSortedReceipts(receipts).reduce((total, row) => total + toNumber(row.amount), 0);

  // Credit notes already paired as immediate reversals are not deducted again.
  // Remaining credit notes reduce billable sales so: Sales − CN − Collected = Open.
  const pairedCreditNoteKeys = new Set(
    reversedRows.map((row) => invoiceKey(row.credit_note_date, row.credit_note_voucher)),
  );
  const unmatchedCreditNotes = buildCreditNotes(transactions).filter(
    (note) => !pairedCreditNoteKeys.has(invoiceKey(note.credit_date, note.voucher_number)),
  );
  const creditNoteAmount = unmatchedCreditNotes.reduce((total, note) => total + toNumber(note.amount), 0);
  const netSalesInclVat = salesInclVat - creditNoteAmount;
  const balanceDelta = netSalesInclVat - collectedAmount - openSalesAmount;

  const totals = {
    sales_excl_vat: salesExclVat,
    sales_incl_vat: salesInclVat,
    invoice_sales_excl_vat: invoiceSalesExclVat,
    invoice_sales_incl_vat: invoiceSalesInclVat,
    credit_note_amount: creditNoteAmount,
    net_sales_incl_vat: netSalesInclVat,
    collected_amount: collectedAmount,
    paid_amount: paidAmount,
    open_sales_amount: openSalesAmount,
    outstanding_unpaid: hasOutstandingRows ? outstanding.totalOutstanding : openSalesAmount,
    open_matches_outstanding: hasOutstandingRows
      ? Math.abs(openSalesAmount - outstanding.totalOutstanding) <= 0.02
      : true,
    sales_minus_collected: netSalesInclVat - collectedAmount,
    balance_delta: balanceDelta,
    sales_collected_matches_open: Math.abs(balanceDelta) <= 0.02,
    unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
    invoice_count: invoiceRows.length,
    paid_invoice_count: invoiceRows.filter((row) => row.status === "Paid").length,
    partial_invoice_count: invoiceRows.filter((row) => row.status === "Partial").length,
    open_invoice_count: invoiceRows.filter((row) => row.status === "Open").length,
    reversed_invoice_count: reversedRows.length,
    reversed_sales_excl_vat: reversedSalesExclVat,
    reversed_sales_incl_vat: reversedSalesInclVat,
  };

  return {
    summary,
    totals,
    invoices: invoiceRows,
    reversedInvoices: reversedRows,
    datewise,
    settlementEvents,
    outstandingInvoices: outstanding.invoices,
  };
}

