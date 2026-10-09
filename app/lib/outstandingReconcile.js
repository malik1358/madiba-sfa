import { toNumber } from "./outstanding.js";
import { summarizeSalesCoverageGaps } from "./salesCoverage.js";

export const OUTSTANDING_RECONCILE_KEY = "outstanding_reconcile_dataset_v1";
export const OUTSTANDING_RECONCILE_TOLERANCE = 0.02;

/** Why a Tally bill could not be attached to a sales invoice. */
export const BILL_MISMATCH_OTHER_CUSTOMER = "ref_other_customer";
export const BILL_MISMATCH_REVERSED = "ref_reversed";
export const BILL_MISMATCH_DAY_INCOMPLETE = "ref_day_incomplete";
export const BILL_MISMATCH_MISSING = "ref_missing";

export const BILL_MISMATCH_LABELS = {
  [BILL_MISMATCH_OTHER_CUSTOMER]: {
    en: "Ref belongs to another customer",
    ar: "المرجع يخص عميلاً آخر",
  },
  [BILL_MISMATCH_REVERSED]: {
    en: "Invoice reversed in SFA",
    ar: "الفاتورة معكوسة في النظام",
  },
  [BILL_MISMATCH_DAY_INCOMPLETE]: {
    en: "Sales data for this day is incomplete",
    ar: "بيانات المبيعات لهذا اليوم غير مكتملة",
  },
  [BILL_MISMATCH_MISSING]: {
    en: "Ref not in sales data",
    ar: "المرجع غير موجود في بيانات المبيعات",
  },
};

export function normalizeBillRef(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Classifies a Tally bill that produced its own open row because its Ref. No.
 * matched no sales invoice for that customer.
 *
 * @param {object} input
 * @param {string} input.customerCode Customer the bill is billed to.
 * @param {string} input.billRef Tally `Ref. No.`.
 * @param {string[]} input.refOwners Customer codes that own this voucher in sales.
 * @param {boolean} input.reversedInSfa The customer's own voucher was credit-note reversed.
 * @param {boolean} input.salesDayIncomplete The bill date lost most of its sales rows to a partial upload.
 */
export function classifyOutstandingBillMismatch({
  customerCode = "",
  billRef = "",
  refOwners = [],
  reversedInSfa = false,
  salesDayIncomplete = false,
} = {}) {
  const code = String(customerCode || "").trim().toUpperCase();
  const owners = [...new Set((Array.isArray(refOwners) ? refOwners : []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))];
  const ownedBySelf = owners.includes(code);

  if (reversedInSfa && ownedBySelf) {
    return {
      mismatch_type: BILL_MISMATCH_REVERSED,
      note: "Sales history has this voucher but SFA treated it as reversed by a credit note, while Tally still shows it pending.",
    };
  }

  const otherOwners = owners.filter((owner) => owner !== code);
  if (otherOwners.length) {
    return {
      mismatch_type: BILL_MISMATCH_OTHER_CUSTOMER,
      note: `Sales data has ${normalizeBillRef(billRef)} under customer ${otherOwners.join(", ")}, not this customer. Check the Ref. No. column alignment on the Bills Receivable export.`,
    };
  }

  return {
    mismatch_type: salesDayIncomplete ? BILL_MISMATCH_DAY_INCOMPLETE : BILL_MISMATCH_MISSING,
    note: salesDayIncomplete
      ? "The sales upload for this date kept only part of the day, so this invoice was deleted. Re-upload a full sales export for this date."
      : "This reference does not appear anywhere in the sales data.",
  };
}

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

export function summarizeOutstandingBillMismatches(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const byType = {};
  [BILL_MISMATCH_OTHER_CUSTOMER, BILL_MISMATCH_REVERSED, BILL_MISMATCH_DAY_INCOMPLETE, BILL_MISMATCH_MISSING].forEach((type) => {
    const typeRows = list.filter((row) => row.mismatch_type === type);
    byType[type] = {
      count: typeRows.length,
      pending: typeRows.reduce((sum, row) => sum + toNumber(row.pending_amount), 0),
    };
  });
  return {
    count: list.length,
    pending: list.reduce((sum, row) => sum + toNumber(row.pending_amount), 0),
    byType,
  };
}

export function sortOutstandingBillMismatches(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => (
    toNumber(right.pending_amount) - toNumber(left.pending_amount)
    || String(left.customer_code || "").localeCompare(String(right.customer_code || ""))
  ));
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
    mismatchRows: [],
    mismatchSummary: summarizeOutstandingBillMismatches([]),
    coverageGaps: [],
    coverageSummary: summarizeSalesCoverageGaps([]),
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

  const mismatchRows = sortOutstandingBillMismatches(
    (Array.isArray(raw.mismatchRows) ? raw.mismatchRows : []).map((row) => ({
      customer_code: String(row?.customer_code || "").trim().toUpperCase(),
      customer_name: String(row?.customer_name || "").trim(),
      salesman_name: String(row?.salesman_name || "").trim(),
      bill_ref: String(row?.bill_ref || "").trim(),
      bill_date: String(row?.bill_date || "").trim(),
      pending_amount: toNumber(row?.pending_amount),
      invoice_days: Number(row?.invoice_days || 0),
      mismatch_type: String(row?.mismatch_type || BILL_MISMATCH_MISSING),
      note: String(row?.note || ""),
      ref_owners: Array.isArray(row?.ref_owners) ? row.ref_owners.map((value) => String(value || "")) : [],
      same_amount_vouchers: Array.isArray(row?.same_amount_vouchers)
        ? row.same_amount_vouchers.map((value) => String(value || ""))
        : [],
    })),
  );

  const coverageGaps = (Array.isArray(raw.coverageGaps) ? raw.coverageGaps : []).map((gap) => ({
    date: String(gap?.date || "").slice(0, 10),
    lines: Number(gap?.lines || 0),
    vouchers: Number(gap?.vouchers || 0),
    salesmen: Number(gap?.salesmen || 0),
    expected_salesmen: Number(gap?.expected_salesmen || 0),
    salesman_names: Array.isArray(gap?.salesman_names) ? gap.salesman_names.map((value) => String(value || "")) : [],
    missing_salesmen: Array.isArray(gap?.missing_salesmen) ? gap.missing_salesmen.map((value) => String(value || "")) : [],
  })).filter((gap) => gap.date);

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
    mismatchRows,
    mismatchSummary: summarizeOutstandingBillMismatches(mismatchRows),
    coverageGaps,
    coverageSummary: summarizeSalesCoverageGaps(coverageGaps),
  };
}
