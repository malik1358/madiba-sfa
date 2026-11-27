import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  isSameOutstandingCustomer,
  normalizeCode,
  normalizeOutstandingRef,
  resolveOutstandingInvoiceCustomerCode,
  syncOutstandingCustomerFromInvoices,
  toNumber,
} from "./outstanding.js";

export const SETTLEMENT_DELETION_LOG_KEY = "settlement_transaction_deletions_v1";
export const SETTLEMENT_DELETION_LOG_LIMIT = 500;
export { OUTSTANDING_DATASET_KEY };
export const RECEIPT_DATASET_KEY = "receipt_register_dataset_v1";
export const RECEIPT_DATASET_STAMP_KEY = "receipt_register_uploaded_at";

/** Datewise / settlement row kinds that delete from sales_raw (+ outstanding). */
export const SALES_DELETE_KINDS = new Set([
  "invoice",
  "credit note",
  "credit note / return",
  "sales return",
  "credit",
]);

/** Datewise / settlement row kinds that delete from the receipt register. */
export const RECEIPT_DELETE_KINDS = new Set([
  "receipt",
  "payment",
  "purchase",
]);

export function normalizeSettlementDeleteKind(kind = "") {
  return String(kind || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function classifySettlementDeleteSource(kind = "") {
  const normalized = normalizeSettlementDeleteKind(kind);
  if (RECEIPT_DELETE_KINDS.has(normalized)) return "receipt_register";
  if (SALES_DELETE_KINDS.has(normalized) || normalized.includes("credit")) return "sales";
  if (!normalized) return "";
  // Unknown labels that still look like credit notes.
  if (normalized.includes("return")) return "sales";
  return "sales";
}

export function normalizeVoucherKey(value = "") {
  return normalizeOutstandingRef(value);
}

export function vouchersMatch(left = "", right = "") {
  const a = normalizeVoucherKey(left);
  const b = normalizeVoucherKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Office shorthand INV/NFD1862 ↔ NFD/1862
  const stripInv = (value) => value.replace(/^INV\/?/i, "");
  const compact = (value) => stripInv(value).replace(/\//g, "");
  return compact(a) === compact(b);
}

export function buildSettlementDeletionEntry({
  deletedAt,
  deletedBy = {},
  source = "",
  kind = "",
  customerCode = "",
  customerName = "",
  voucher = "",
  transactionDate = "",
  uploadedAt = "",
  removedCount = 0,
  amountExclVat = null,
  amountInclVat = null,
  amount = null,
  summary = "",
} = {}) {
  return {
    deletedAt: String(deletedAt || new Date().toISOString()),
    deletedBy: {
      id: String(deletedBy.id || "").trim() || null,
      role: String(deletedBy.role || "").trim() || null,
      salesmanCode: String(deletedBy.salesmanCode || deletedBy.salesman_code || "").trim() || null,
      salesmanName: String(deletedBy.salesmanName || deletedBy.salesman_name || "").trim() || null,
    },
    source: String(source || "").trim(),
    kind: String(kind || "").trim(),
    customerCode: normalizeCode(customerCode),
    customerName: String(customerName || "").trim(),
    voucher: String(voucher || "").trim(),
    transactionDate: String(transactionDate || "").slice(0, 10),
    uploadedAt: String(uploadedAt || "").trim() || null,
    removedCount: Number(removedCount) || 0,
    amountExclVat: amountExclVat == null ? null : Number(amountExclVat),
    amountInclVat: amountInclVat == null ? null : Number(amountInclVat),
    amount: amount == null ? null : Number(amount),
    summary: String(summary || "").trim(),
  };
}

export function appendSettlementDeletionLog(existing = {}, entry, limit = SETTLEMENT_DELETION_LOG_LIMIT) {
  const previous = Array.isArray(existing?.entries) ? existing.entries : [];
  const nextEntry = entry && typeof entry === "object" ? entry : null;
  const entries = nextEntry
    ? [nextEntry, ...previous].slice(0, Math.max(1, Number(limit) || SETTLEMENT_DELETION_LOG_LIMIT))
    : previous.slice(0, Math.max(1, Number(limit) || SETTLEMENT_DELETION_LOG_LIMIT));
  return {
    version: 1,
    updatedAt: nextEntry?.deletedAt || existing?.updatedAt || new Date().toISOString(),
    entries,
  };
}

function outstandingInvoiceMatchesDelete(invoice, match = {}) {
  const customerCode = String(match.customerCode || match.customer_code || "").trim();
  const customerName = String(match.customerName || match.customer_name || "").trim();
  const voucher = String(match.voucher || match.vchNo || match.vch_no || match.ref_no || "").trim();
  const invoiceDate = String(match.transactionDate || match.invoiceDate || match.invoice_date || "").slice(0, 10);
  if (!customerCode || !voucher) return false;

  const invoiceCode = resolveOutstandingInvoiceCustomerCode(invoice) || invoice?.customer_code;
  if (!isSameOutstandingCustomer(invoiceCode, invoice?.customer_name, customerCode, customerName)) {
    return false;
  }
  if (!vouchersMatch(invoice?.ref_no || invoice?.voucher_number, voucher)) return false;
  if (invoiceDate) {
    const rowDate = String(invoice?.invoice_date || "").slice(0, 10);
    if (rowDate && rowDate !== invoiceDate) return false;
  }
  return true;
}

/**
 * Drop one outstanding invoice (by customer + ref) and recompute that customer's
 * aggregate row. When no pending invoices remain, the customer row is removed.
 */
export function removeOutstandingInvoiceFromDataset(dataset = {}, match = {}) {
  const invoices = Array.isArray(dataset?.invoices) ? dataset.invoices : [];
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const removed = [];
  const keptInvoices = [];

  invoices.forEach((invoice) => {
    if (outstandingInvoiceMatchesDelete(invoice, match)) {
      removed.push(invoice);
      return;
    }
    keptInvoices.push(invoice);
  });

  if (!removed.length) {
    return {
      dataset: {
        ...dataset,
        invoices,
        rows,
      },
      removed: [],
      removedCount: 0,
      customerDropped: false,
    };
  }

  const customerCode = String(match.customerCode || match.customer_code || "").trim();
  const customerName = String(match.customerName || match.customer_name || "").trim();
  const remainingForCustomer = keptInvoices.filter((invoice) => {
    const invoiceCode = resolveOutstandingInvoiceCustomerCode(invoice) || invoice?.customer_code;
    return isSameOutstandingCustomer(invoiceCode, invoice?.customer_name, customerCode, customerName);
  });

  let customerDropped = false;
  const nextRows = [];
  rows.forEach((rawRow) => {
    const row = buildOutstandingRow(rawRow);
    const sameCustomer = isSameOutstandingCustomer(
      row.customer_code,
      row.customer_name,
      customerCode,
      customerName,
    );
    if (!sameCustomer) {
      nextRows.push(rawRow);
      return;
    }
    const synced = syncOutstandingCustomerFromInvoices(row, remainingForCustomer);
    const stillOpen = remainingForCustomer.some((invoice) => toNumber(invoice?.pending_amount) > 0);
    if (!stillOpen || !synced) {
      customerDropped = true;
      return;
    }
    nextRows.push({
      ...rawRow,
      ...synced,
      customer_code: synced.customer_code || row.customer_code,
      customer_name: synced.customer_name || row.customer_name,
      buckets: synced.buckets,
      open_invoices: synced.open_invoices,
      total_outstanding: synced.total_outstanding,
      ...(synced.salesman ? { salesman: synced.salesman } : {}),
    });
  });

  return {
    dataset: {
      ...dataset,
      invoices: keptInvoices,
      rows: nextRows,
    },
    removed,
    removedCount: removed.length,
    customerDropped,
  };
}

export function summarizeSalesRowsForAudit(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const amountExcl = list.reduce((total, row) => total + Number(row?.sales_amount || 0), 0);
  const dates = [...new Set(list.map((row) => String(row?.transaction_date || "").slice(0, 10)).filter(Boolean))];
  const vouchers = [...new Set(list.map((row) => String(row?.voucher_number || "").trim()).filter(Boolean))];
  const createdAts = list
    .map((row) => String(row?.created_at || "").trim())
    .filter(Boolean)
    .sort();
  return {
    removedCount: list.length,
    amountExclVat: amountExcl,
    amountInclVat: null,
    transactionDate: dates[0] || "",
    voucher: vouchers[0] || "",
    uploadedAt: createdAts[0] || "",
    voucherTypes: [...new Set(list.map((row) => String(row?.voucher_type || "").trim()).filter(Boolean))],
  };
}
