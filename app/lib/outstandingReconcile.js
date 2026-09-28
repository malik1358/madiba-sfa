import { toNumber } from "./outstanding.js";

export const OUTSTANDING_RECONCILE_KEY = "outstanding_reconcile_dataset_v1";
export const OUTSTANDING_RECONCILE_TOLERANCE = 0.02;

/**
 * Customer-level Tally vs SFA outstanding row for the precomputed difference report.
 * Tally = customer total on the outstanding upload; SFA = computed open (cash FIFO + credit notes).
 */
export function buildOutstandingReconcileRow({
  customer = {},
  totals = {},
  tallyOutstanding = 0,
} = {}) {
  const tally = toNumber(tallyOutstanding);
  const sfa = toNumber(totals.computed_open);
  const difference = sfa - tally;
  const invoiceGapCount = Number(totals.discrepancy_count || 0);

  return {
    customer_code: String(customer.customer_code || "").trim().toUpperCase(),
    customer_name: String(customer.customer_name || "").trim(),
    salesman_name: String(customer.salesman_name || "").trim(),
    tally_outstanding: tally,
    sfa_outstanding: sfa,
    difference,
    invoice_gap_count: invoiceGapCount,
    unmatched_receipt_amount: toNumber(totals.unmatched_receipt_amount),
    unmatched_credit_note_amount: toNumber(totals.unmatched_credit_note_amount),
    has_difference: Math.abs(difference) > OUTSTANDING_RECONCILE_TOLERANCE || invoiceGapCount > 0,
  };
}

export function sortOutstandingReconcileRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byGap = Math.abs(toNumber(right.difference)) - Math.abs(toNumber(left.difference));
    if (Math.abs(byGap) > 0.009) return byGap;
    return String(left.customer_code || "").localeCompare(String(right.customer_code || ""));
  });
}

export function summarizeOutstandingReconcileRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    customer_count: list.length,
    tally_outstanding: list.reduce((sum, row) => sum + toNumber(row.tally_outstanding), 0),
    sfa_outstanding: list.reduce((sum, row) => sum + toNumber(row.sfa_outstanding), 0),
    difference: list.reduce((sum, row) => sum + toNumber(row.difference), 0),
    sfa_higher: list
      .filter((row) => toNumber(row.difference) > OUTSTANDING_RECONCILE_TOLERANCE)
      .reduce((sum, row) => sum + toNumber(row.difference), 0),
    sfa_lower: list
      .filter((row) => toNumber(row.difference) < -OUTSTANDING_RECONCILE_TOLERANCE)
      .reduce((sum, row) => sum + toNumber(row.difference), 0),
    invoice_gap_count: list.reduce((sum, row) => sum + Number(row.invoice_gap_count || 0), 0),
  };
}

export function emptyOutstandingReconcileDataset() {
  return {
    builtAt: "",
    trigger: "",
    scannedCount: 0,
    failedCount: 0,
    outstandingUploadedAt: "",
    receiptUploadedAt: "",
    rows: [],
    summary: summarizeOutstandingReconcileRows([]),
  };
}

export function normalizeOutstandingReconcileDataset(raw) {
  if (!raw || typeof raw !== "object") return emptyOutstandingReconcileDataset();
  const rows = sortOutstandingReconcileRows(
    (Array.isArray(raw.rows) ? raw.rows : []).map((row) => ({
      customer_code: String(row?.customer_code || "").trim().toUpperCase(),
      customer_name: String(row?.customer_name || "").trim(),
      salesman_name: String(row?.salesman_name || "").trim(),
      tally_outstanding: toNumber(row?.tally_outstanding),
      sfa_outstanding: toNumber(row?.sfa_outstanding),
      difference: toNumber(row?.difference),
      invoice_gap_count: Number(row?.invoice_gap_count || 0),
      unmatched_receipt_amount: toNumber(row?.unmatched_receipt_amount),
      unmatched_credit_note_amount: toNumber(row?.unmatched_credit_note_amount),
      has_difference: true,
    })),
  );

  return {
    builtAt: String(raw.builtAt || ""),
    trigger: String(raw.trigger || ""),
    scannedCount: Number(raw.scannedCount || 0),
    failedCount: Number(raw.failedCount || 0),
    outstandingUploadedAt: String(raw.outstandingUploadedAt || ""),
    receiptUploadedAt: String(raw.receiptUploadedAt || ""),
    rows,
    summary: raw.summary && typeof raw.summary === "object"
      ? raw.summary
      : summarizeOutstandingReconcileRows(rows),
  };
}
