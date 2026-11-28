import {
  LEFTOVER_FORWARD_MIRROR_MAX_DAYS,
  buildCreditNotes,
  buildSalesInvoices,
  findImmediateCreditNoteReversals,
} from "./paymentBehavior.js";
import { parseIsoDate } from "./salesInvoices.js";

/** Extra days of sales history needed so CN void matching matches Payment Settlement. */
export const LEDGER_INVOICE_REVERSAL_BUFFER_DAYS = LEFTOVER_FORWARD_MIRROR_MAX_DAYS;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function invoiceIdentityKey(invoiceDate, voucherNumber) {
  return `${String(invoiceDate || "").slice(0, 10)}::${normalizeText(voucherNumber)}`;
}

export function shiftIsoDate(iso, days) {
  const text = parseIsoDate(iso);
  if (!text) return "";
  const ms = Date.parse(`${text}T00:00:00Z`) + (Number(days) || 0) * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function resolveLedgerInvoiceFetchWindow({ from, to } = {}) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) {
    throw new Error("Invalid date range.");
  }
  return {
    from: shiftIsoDate(start, -LEDGER_INVOICE_REVERSAL_BUFFER_DAYS) || start,
    to: shiftIsoDate(end, LEDGER_INVOICE_REVERSAL_BUFFER_DAYS) || end,
  };
}

function partyFromLines(lines = [], fallbackRows = []) {
  const source = (Array.isArray(lines) && lines.length ? lines : fallbackRows) || [];
  const first = source.find(Boolean) || {};
  return {
    customerCode: normalizeText(first.customer_code),
    customerName: normalizeText(first.customer_name),
    salesmanCode: normalizeText(first.salesman_code),
    salesmanName: normalizeText(first.salesman_name),
  };
}

function linesByVoucher(rows = []) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const date = parseIsoDate(row?.transaction_date) || String(row?.transaction_date || "").slice(0, 10);
    const voucher = normalizeText(row?.voucher_number || row?.reference);
    if (!date || !voucher) return;
    const key = invoiceIdentityKey(date, voucher);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  });
  return map;
}

function sortInvoiceRows(rows = []) {
  return [...(rows || [])].sort((left, right) => {
    const byDate = String(right.invoiceDate || "").localeCompare(String(left.invoiceDate || ""));
    if (byDate !== 0) return byDate;
    const byVoucher = String(left.voucherNumber || "").localeCompare(String(right.voucherNumber || ""));
    if (byVoucher !== 0) return byVoucher;
    return String(left.customerName || left.customerCode || "")
      .localeCompare(String(right.customerName || right.customerCode || ""));
  });
}

/**
 * Per-customer classification: same CN void rules as Payment Settlement FIFO /
 * Balance Confirmation Schedule A. Process one customer at a time so voids
 * never cross accounts.
 */
export function classifyCustomerLedgerInvoices(rows = [], { from, to } = {}) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const invoices = buildSalesInvoices(rows);
  const creditNotes = buildCreditNotes(rows);
  const { reversals, reversedKeys } = findImmediateCreditNoteReversals(invoices, creditNotes);
  const byVoucher = linesByVoucher(rows);
  const reversalByKey = new Map(
    (reversals || []).map((row) => [invoiceIdentityKey(row.invoice_date, row.voucher_number), row]),
  );

  const considered = [];
  const reversed = [];

  invoices.forEach((invoice) => {
    const date = String(invoice.invoice_date || "").slice(0, 10);
    if (start && date < start) return;
    if (end && date > end) return;

    const key = invoiceIdentityKey(invoice.invoice_date, invoice.voucher_number);
    const party = partyFromLines(byVoucher.get(key) || [], rows);
    const base = {
      invoiceDate: date,
      monthKey: date.slice(0, 7),
      voucherNumber: normalizeText(invoice.voucher_number),
      amountExclVat: roundMoney(invoice.amount_excl_vat),
      amountInclVat: roundMoney(invoice.amount),
      isCash: Boolean(invoice.exclude_from_avg_days),
      ...party,
    };

    if (reversedKeys.has(key)) {
      const reversal = reversalByKey.get(key);
      reversed.push({
        ...base,
        status: "Reversed",
        creditNoteDate: String(reversal?.credit_note_date || "").slice(0, 10),
        creditNoteVoucher: normalizeText(reversal?.credit_note_voucher),
      });
      return;
    }

    considered.push({
      ...base,
      status: "Ledger",
      creditNoteDate: "",
      creditNoteVoucher: "",
    });
  });

  return {
    considered: sortInvoiceRows(considered),
    reversed: sortInvoiceRows(reversed),
  };
}

function summarizeInvoiceList(rows = []) {
  const customers = new Set();
  const salesmen = new Set();
  let amountExclVat = 0;
  let amountInclVat = 0;

  (rows || []).forEach((row) => {
    const customer = normalizeCode(row?.customerCode);
    if (customer) customers.add(customer);
    const salesman = normalizeCode(row?.salesmanCode);
    if (salesman) salesmen.add(salesman);
    amountExclVat += Number(row?.amountExclVat || 0);
    amountInclVat += Number(row?.amountInclVat || 0);
  });

  return {
    invoiceCount: (rows || []).length,
    customerCount: customers.size,
    salesmanCount: salesmen.size,
    amountExclVat: roundMoney(amountExclVat),
    amountInclVat: roundMoney(amountInclVat),
  };
}

export function groupLedgerInvoicesByMonth(invoices = [], reversedInvoices = []) {
  const map = new Map();

  function bucket(monthKey) {
    const key = String(monthKey || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return null;
    if (!map.has(key)) {
      map.set(key, {
        monthKey: key,
        invoices: [],
        reversedInvoices: [],
      });
    }
    return map.get(key);
  }

  (invoices || []).forEach((row) => {
    const entry = bucket(row?.monthKey || row?.invoiceDate);
    if (entry) entry.invoices.push(row);
  });
  (reversedInvoices || []).forEach((row) => {
    const entry = bucket(row?.monthKey || row?.invoiceDate);
    if (entry) entry.reversedInvoices.push(row);
  });

  return [...map.values()]
    .map((entry) => {
      const consideredSummary = summarizeInvoiceList(entry.invoices);
      const reversedSummary = summarizeInvoiceList(entry.reversedInvoices);
      return {
        monthKey: entry.monthKey,
        invoiceCount: consideredSummary.invoiceCount,
        reversedCount: reversedSummary.invoiceCount,
        customerCount: consideredSummary.customerCount,
        amountExclVat: consideredSummary.amountExclVat,
        amountInclVat: consideredSummary.amountInclVat,
        reversedAmountExclVat: reversedSummary.amountExclVat,
        reversedAmountInclVat: reversedSummary.amountInclVat,
        invoices: sortInvoiceRows(entry.invoices),
        reversedInvoices: sortInvoiceRows(entry.reversedInvoices),
      };
    })
    .sort((left, right) => String(right.monthKey).localeCompare(String(left.monthKey)));
}

export function groupLedgerInvoicesByDate(invoices = [], reversedInvoices = []) {
  const map = new Map();

  function bucket(date) {
    const key = parseIsoDate(date) || String(date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    if (!map.has(key)) {
      map.set(key, {
        invoiceDate: key,
        invoices: [],
        reversedInvoices: [],
      });
    }
    return map.get(key);
  }

  (invoices || []).forEach((row) => {
    const entry = bucket(row?.invoiceDate);
    if (entry) entry.invoices.push(row);
  });
  (reversedInvoices || []).forEach((row) => {
    const entry = bucket(row?.invoiceDate);
    if (entry) entry.reversedInvoices.push(row);
  });

  return [...map.values()]
    .map((entry) => {
      const consideredSummary = summarizeInvoiceList(entry.invoices);
      const reversedSummary = summarizeInvoiceList(entry.reversedInvoices);
      return {
        invoiceDate: entry.invoiceDate,
        monthKey: entry.invoiceDate.slice(0, 7),
        invoiceCount: consideredSummary.invoiceCount,
        reversedCount: reversedSummary.invoiceCount,
        customerCount: consideredSummary.customerCount,
        amountExclVat: consideredSummary.amountExclVat,
        amountInclVat: consideredSummary.amountInclVat,
        reversedAmountExclVat: reversedSummary.amountExclVat,
        reversedAmountInclVat: reversedSummary.amountInclVat,
        invoices: sortInvoiceRows(entry.invoices),
        reversedInvoices: sortInvoiceRows(entry.reversedInvoices),
      };
    })
    .sort((left, right) => String(right.invoiceDate).localeCompare(String(left.invoiceDate)));
}

/**
 * Build the company-wide ledger-invoice report from active_sales-style rows.
 * Rows should include a reversal buffer around [from, to]; only invoices dated
 * inside the requested range are returned.
 */
export function buildLedgerInvoicesReport(transactions = [], { from, to } = {}) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) {
    throw new Error("Invalid date range.");
  }

  const byCustomer = new Map();
  (transactions || []).forEach((row) => {
    const code = normalizeCode(row?.customer_code) || "__NONE__";
    const list = byCustomer.get(code) || [];
    list.push(row);
    byCustomer.set(code, list);
  });

  const considered = [];
  const reversed = [];
  for (const rows of byCustomer.values()) {
    const part = classifyCustomerLedgerInvoices(rows, { from: start, to: end });
    considered.push(...part.considered);
    reversed.push(...part.reversed);
  }

  const invoices = sortInvoiceRows(considered);
  const reversedInvoices = sortInvoiceRows(reversed);
  const consideredSummary = summarizeInvoiceList(invoices);
  const reversedSummary = summarizeInvoiceList(reversedInvoices);

  return {
    from: start,
    to: end,
    invoices,
    reversedInvoices,
    days: groupLedgerInvoicesByDate(invoices, reversedInvoices),
    months: groupLedgerInvoicesByMonth(invoices, reversedInvoices),
    summary: {
      ...consideredSummary,
      reversedCount: reversedSummary.invoiceCount,
      reversedAmountExclVat: reversedSummary.amountExclVat,
      reversedAmountInclVat: reversedSummary.amountInclVat,
    },
  };
}
