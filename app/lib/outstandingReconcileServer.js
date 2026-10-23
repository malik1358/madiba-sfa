import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  customerAccountCodesMatch,
  hydrateOutstandingInvoices,
  resolveOutstandingInvoiceCustomerCode,
  toNumber,
} from "./outstanding.js";
import {
  RECEIPT_DATASET_KEY,
  normalizeReceiptDataset,
} from "./receiptRegister.js";
import { mergeSalesSnapshots } from "./salesHistory.js";
import { buildPaymentSettlementLedger } from "./paymentBehavior.js";
import {
  createSalesCoverageCollector,
  detectSalesCoverageGaps,
  isSalesCoverageGapDate,
  summarizeSalesCoverageGaps,
} from "./salesCoverage.js";
import {
  OUTSTANDING_RECONCILE_KEY,
  buildOutstandingReconcileRow,
  classifyOutstandingBillMismatch,
  emptyOutstandingReconcileDataset,
  normalizeBillRef,
  normalizeOutstandingReconcileDataset,
  sortOutstandingBillMismatches,
  sortOutstandingReconcileRows,
  summarizeOutstandingBillMismatches,
  summarizeOutstandingReconcileRows,
} from "./outstandingReconcile.js";
import { isMissingRpcError } from "./salesmanIdentityMatch.js";

const SALES_PAGE_SIZE = 1000;
const SALES_SELECT = "id,transaction_date,voucher_number,voucher_type,reference,customer_code,customer_name,salesman_name,category,item_code,item_name,quantity,sales_amount";

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

async function readSettingJson(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return parseJson(data?.setting_value);
}

/** Outstanding upload grouped by customer so the scan never rescans the whole dataset per customer. */
export function indexOutstandingByCustomer(dataset) {
  const invoicesByCode = new Map();
  hydrateOutstandingInvoices(dataset).forEach((invoice) => {
    const code = normalizeCode(resolveOutstandingInvoiceCustomerCode(invoice));
    if (!code) return;
    if (!invoicesByCode.has(code)) invoicesByCode.set(code, []);
    invoicesByCode.get(code).push(invoice);
  });

  const customersByCode = new Map();
  (Array.isArray(dataset?.rows) ? dataset.rows : []).forEach((rawRow) => {
    const row = buildOutstandingRow(rawRow);
    const code = normalizeCode(resolveOutstandingInvoiceCustomerCode({
      customer_code: row.customer_code,
      customer_name: row.customer_name,
    }));
    if (!code) return;
    customersByCode.set(code, row);
  });

  return { invoicesByCode, customersByCode };
}

/** Bill lines for a sales account, including 1035 bills stored on 1035C. Skip the empty synthetic total when real refs exist. */
export function outstandingInvoicesForAccount(invoicesByCode, code) {
  const target = normalizeCode(code);
  const gathered = [];
  invoicesByCode.forEach((invoices, key) => {
    if (key === target || customerAccountCodesMatch(key, target)) {
      gathered.push(...(Array.isArray(invoices) ? invoices : []));
    }
  });
  const withRefs = gathered.filter((invoice) => String(invoice?.ref_no || "").trim());
  return withRefs.length ? withRefs : gathered;
}

/** Receipt register grouped by customer code (unmatched rows are keyed by their parsed code). */
export function indexReceiptsByCustomer(dataset) {
  const byCode = new Map();
  (Array.isArray(dataset?.rows) ? dataset.rows : []).forEach((row) => {
    const code = normalizeCode(row?.customer_code);
    if (!code) return;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(row);
  });
  return byCode;
}

async function readHistoryPage(admin, { useOffset, from, cursor }) {
  if (!useOffset && typeof admin?.rpc === "function") {
    const { data, error } = await admin.rpc("active_sales_history_page", {
      after_customer: cursor ? (cursor.customer_code ?? null) : null,
      after_date: cursor ? (cursor.transaction_date ?? null) : null,
      after_id: cursor ? (cursor.id ?? null) : null,
      page_limit: SALES_PAGE_SIZE,
    });
    if (!error) return { rows: data || [], useOffset: false };
    if (!isMissingRpcError(error)) {
      if (isMissingTableError(error)) return { rows: [], done: true, useOffset: false };
      throw error;
    }
  }

  const { data, error } = await admin
    .from("active_sales")
    .select(SALES_SELECT)
    .order("customer_code", { ascending: true })
    .order("transaction_date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + SALES_PAGE_SIZE - 1);
  if (error) {
    if (isMissingTableError(error)) return { rows: [], done: true, useOffset: true };
    throw error;
  }
  return { rows: data || [], useOffset: true };
}

/**
 * Streams the active sales snapshot ordered by customer so each customer's history is handed
 * over once and released before the next one. Keeps memory flat over the whole view.
 * Prefers a keyset page so each call stops after one page. Falls back to offset pages when
 * active_sales_history_page is not deployed yet.
 */
export async function forEachCustomerSalesHistory(admin, onCustomer) {
  let from = 0;
  let cursor = null;
  let useOffset = false;
  let currentCode = "";
  let buffer = [];

  while (true) {
    const page = await readHistoryPage(admin, { useOffset, from, cursor });
    useOffset = page.useOffset;
    if (page.done) return;

    const rows = page.rows || [];
    for (const row of rows) {
      const code = normalizeCode(row.customer_code);
      if (code !== currentCode) {
        if (currentCode && buffer.length) await onCustomer(currentCode, buffer);
        currentCode = code;
        buffer = [];
      }
      buffer.push(row);
    }

    if (rows.length < SALES_PAGE_SIZE) break;
    if (useOffset) from += SALES_PAGE_SIZE;
    else cursor = rows[rows.length - 1];
  }

  if (currentCode && buffer.length) await onCustomer(currentCode, buffer);
}

/**
 * Precomputes Tally vs SFA outstanding for every customer and keeps only the difference rows.
 * Runs on upload so the report screen and the email read a saved dataset instead of
 * recomputing every customer ledger in the browser.
 */
export async function buildOutstandingReconcileDataset(admin, { trigger = "manual" } = {}) {
  const outstandingDataset = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
  const receiptDataset = normalizeReceiptDataset(await readSettingJson(admin, RECEIPT_DATASET_KEY));
  const { invoicesByCode, customersByCode } = indexOutstandingByCustomer(outstandingDataset);
  const receiptsByCode = indexReceiptsByCustomer(receiptDataset);

  const rows = [];
  const seenCodes = new Set();
  // Ref → customers that own it in sales, so a bill billed to the wrong customer is visible.
  const voucherOwners = new Map();
  const pendingMismatches = [];
  // Per-day salesman counts, so a date wiped by a partial upload is visible.
  const coverage = createSalesCoverageCollector();
  let scannedCount = 0;
  let failedCount = 0;

  function evaluate(code, transactions) {
    const outstandingCustomer = customersByCode.get(code) || null;
    const outstandingInvoices = outstandingInvoicesForAccount(invoicesByCode, code);
    const receipts = receiptsByCode.get(code) || [];

    transactions.forEach((entry) => {
      const ref = normalizeBillRef(entry.voucher_number);
      if (!ref) return;
      if (!voucherOwners.has(ref)) voucherOwners.set(ref, new Set());
      voucherOwners.get(ref).add(code);
    });

    const ledger = buildPaymentSettlementLedger({
      transactions,
      receipts,
      outstandingCustomer,
      outstandingInvoices,
    });
    const totals = ledger.outstandingCompareTotals || {};
    const tallyOutstanding = outstandingCustomer
      ? toNumber(outstandingCustomer.total_outstanding)
      : toNumber(totals.tally_open);

    const customerName = outstandingCustomer?.customer_name
      || transactions.find((entry) => entry.customer_name)?.customer_name
      || "";
    const salesmanName = outstandingCustomer?.salesman
      || outstandingInvoices.find((invoice) => invoice.salesman)?.salesman
      || "";

    const reversedRefs = new Set(
      (ledger.reversedInvoices || []).map((invoice) => normalizeBillRef(invoice.voucher_number)),
    );
    const realInvoices = (ledger.invoices || []).filter((invoice) => invoice.open_source !== "outstanding");

    (ledger.invoices || [])
      .filter((invoice) => invoice.open_source === "outstanding")
      .forEach((invoice) => {
        const billRef = normalizeBillRef(invoice.voucher_number);
        pendingMismatches.push({
          customer_code: code,
          customer_name: customerName,
          salesman_name: salesmanName,
          bill_ref: String(invoice.voucher_number || ""),
          bill_date: String(invoice.invoice_date || ""),
          pending_amount: toNumber(invoice.amount_incl_vat),
          invoice_days: Number(invoice.open_days || 0),
          reversed_in_sfa: reversedRefs.has(billRef),
          same_amount_vouchers: realInvoices
            .filter((row) => Math.abs(toNumber(row.amount_incl_vat) - toNumber(invoice.amount_incl_vat)) <= 0.02)
            .map((row) => `${row.voucher_number} ${row.invoice_date}`),
        });
      });

    const row = buildOutstandingReconcileRow({
      customer: {
        customer_code: code,
        customer_name: customerName,
        salesman_name: salesmanName,
      },
      totals,
      tallyOutstanding,
    });

    if (row.has_difference) rows.push(row);
  }

  await forEachCustomerSalesHistory(admin, async (code, salesRows) => {
    seenCodes.add(code);
    scannedCount += 1;
    try {
      const merged = mergeSalesSnapshots(salesRows);
      merged.forEach((row) => coverage.add(row));
      evaluate(code, merged);
    } catch (error) {
      failedCount += 1;
      console.error(`Outstanding reconcile failed for ${code}:`, error);
    }
  });

  // Customers on the Tally upload with no sales history still show up as a full difference.
  for (const code of customersByCode.keys()) {
    if (seenCodes.has(code)) continue;
    scannedCount += 1;
    try {
      evaluate(code, []);
    } catch (error) {
      failedCount += 1;
      console.error(`Outstanding reconcile failed for ${code}:`, error);
    }
  }

  const sortedRows = sortOutstandingReconcileRows(rows);
  const coverageGaps = detectSalesCoverageGaps(coverage.days());

  // Owners are only complete after the whole scan, so classify at the end.
  const mismatchRows = sortOutstandingBillMismatches(pendingMismatches.map((entry) => {
    const refOwners = [...(voucherOwners.get(normalizeBillRef(entry.bill_ref)) || [])];
    const { mismatch_type: mismatchType, note } = classifyOutstandingBillMismatch({
      customerCode: entry.customer_code,
      billRef: entry.bill_ref,
      refOwners,
      reversedInSfa: entry.reversed_in_sfa,
      salesDayIncomplete: isSalesCoverageGapDate(coverageGaps, entry.bill_date),
    });
    return {
      customer_code: entry.customer_code,
      customer_name: entry.customer_name,
      salesman_name: entry.salesman_name,
      bill_ref: entry.bill_ref,
      bill_date: entry.bill_date,
      pending_amount: entry.pending_amount,
      invoice_days: entry.invoice_days,
      mismatch_type: mismatchType,
      note,
      ref_owners: refOwners,
      same_amount_vouchers: entry.same_amount_vouchers,
    };
  }));

  return {
    builtAt: new Date().toISOString(),
    trigger: String(trigger || "manual"),
    scannedCount,
    failedCount,
    outstandingUploadedAt: String(outstandingDataset?.uploadedAt || ""),
    receiptUploadedAt: String(receiptDataset?.uploadedAt || ""),
    rows: sortedRows,
    summary: summarizeOutstandingReconcileRows(sortedRows),
    mismatchRows,
    mismatchSummary: summarizeOutstandingBillMismatches(mismatchRows),
    coverageGaps,
    coverageSummary: summarizeSalesCoverageGaps(coverageGaps),
  };
}

export async function saveOutstandingReconcileDataset(admin, dataset) {
  const { error } = await admin
    .from("system_settings")
    .upsert({
      setting_key: OUTSTANDING_RECONCILE_KEY,
      setting_value: JSON.stringify(dataset),
    }, { onConflict: "setting_key" });
  if (error) throw error;
  return dataset;
}

export async function readOutstandingReconcileDataset(admin) {
  const raw = await readSettingJson(admin, OUTSTANDING_RECONCILE_KEY);
  if (!raw) return emptyOutstandingReconcileDataset();
  return normalizeOutstandingReconcileDataset(raw);
}

export async function rebuildOutstandingReconcileDataset(admin, { trigger = "manual" } = {}) {
  const dataset = await buildOutstandingReconcileDataset(admin, { trigger });
  await saveOutstandingReconcileDataset(admin, dataset);
  return dataset;
}
