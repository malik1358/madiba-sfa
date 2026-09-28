import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
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
  OUTSTANDING_RECONCILE_KEY,
  buildOutstandingReconcileRow,
  emptyOutstandingReconcileDataset,
  normalizeOutstandingReconcileDataset,
  sortOutstandingReconcileRows,
  summarizeOutstandingReconcileRows,
} from "./outstandingReconcile.js";

const SALES_PAGE_SIZE = 1000;
const SALES_SELECT = "id,transaction_date,voucher_number,voucher_type,reference,customer_code,customer_name,category,item_code,item_name,quantity,sales_amount";

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

/**
 * Streams sales_raw ordered by customer so each customer's full history is handed over once
 * and released before the next one. Keeps memory flat over the whole table.
 */
export async function forEachCustomerSalesHistory(admin, onCustomer) {
  let from = 0;
  let currentCode = "";
  let buffer = [];

  while (true) {
    const { data, error } = await admin
      .from("sales_raw")
      .select(SALES_SELECT)
      .order("customer_code", { ascending: true })
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + SALES_PAGE_SIZE - 1);

    if (error) {
      if (isMissingTableError(error)) return;
      throw error;
    }

    const rows = data || [];
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
    from += SALES_PAGE_SIZE;
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
  let scannedCount = 0;
  let failedCount = 0;

  function evaluate(code, transactions) {
    const outstandingCustomer = customersByCode.get(code) || null;
    const outstandingInvoices = invoicesByCode.get(code) || [];
    const receipts = receiptsByCode.get(code) || [];

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

    const row = buildOutstandingReconcileRow({
      customer: {
        customer_code: code,
        customer_name: outstandingCustomer?.customer_name
          || transactions.find((entry) => entry.customer_name)?.customer_name
          || "",
        salesman_name: outstandingCustomer?.salesman
          || outstandingInvoices.find((invoice) => invoice.salesman)?.salesman
          || "",
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
      evaluate(code, mergeSalesSnapshots(salesRows));
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

  return {
    builtAt: new Date().toISOString(),
    trigger: String(trigger || "manual"),
    scannedCount,
    failedCount,
    outstandingUploadedAt: String(outstandingDataset?.uploadedAt || ""),
    receiptUploadedAt: String(receiptDataset?.uploadedAt || ""),
    rows: sortedRows,
    summary: summarizeOutstandingReconcileRows(sortedRows),
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
