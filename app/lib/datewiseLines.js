function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatOptionalMoney(value) {
  return value == null ? "—" : formatMoney(value);
}

function appliedTargetLabel(application) {
  const status = String(application.status || "").trim();
  // CN rows use "Reverses {voucher}". A cancelled collection on that voided bill
  // is not a second reverse — label it as cash that funded the reversed sale.
  const prefix = status === "Refund"
    ? "Refund "
    : status === "Reversed"
      ? "Collection on reversed "
      : "";
  const target = application.target_kind === "purchase"
    ? "Purchase"
    : application.target_kind === "unmatched"
      ? "unmatched collection"
      : "Invoice";
  const voucher = application.voucher_number ? ` ${application.voucher_number}` : "";
  return `${prefix}${target}${voucher} (${formatMoney(application.amount)})`;
}

function purchaseDetail(purchase) {
  const applications = Array.isArray(purchase.applications) ? purchase.applications : [];
  const amount = formatMoney(purchase.amount);
  if (!applications.length) return amount;
  const applied = applications.reduce((total, application) => total + Number(application.amount || 0), 0);
  const unapplied = Math.max(0, Number(purchase.amount || 0) - applied);
  const targets = applications.map((application) => {
    const voucher = application.voucher_number ? ` ${application.voucher_number}` : "";
    if (application.target_kind === "payment") {
      return `Payment${voucher} (${formatMoney(application.amount)})`;
    }
    return `Invoice${voucher} (${formatMoney(application.amount)})`;
  });
  if (unapplied > 0.009) targets.push(`unapplied ${formatMoney(unapplied)}`);
  return `${amount} → ${targets.join(", ")}`;
}

function receiptDetail(receipt) {
  const applications = Array.isArray(receipt.applications) ? receipt.applications : [];
  const isPayment = receipt.kind === "payment" || Number(receipt.amount) < 0;
  if (!applications.length) return isPayment ? "Not adjusted against an invoice" : "";
  return applications.map(appliedTargetLabel).join(", ");
}

export function flattenDatewiseLines(days) {
  const lines = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    const date = day?.date || "";
    (Array.isArray(day?.invoices) ? day.invoices : []).forEach((invoice, index) => {
      const voucher = String(invoice.voucher_number || "").trim();
      lines.push({
        id: `${date}|invoice|${voucher || "—"}|${index}`,
        date,
        kind: "Invoice",
        voucher: voucher || "—",
        sales_excl_vat: Number(invoice.amount_excl_vat || 0),
        sales_incl_vat: Number(invoice.amount_incl_vat || 0),
        collected_amount: null,
        open_amount: Number(invoice.remaining || 0),
        detail: invoice.status || "",
        vch_no: voucher,
        can_delete_transaction: Boolean(voucher),
        can_delete_receipt: false,
      });
    });
    (Array.isArray(day?.credit_notes) ? day.credit_notes : []).forEach((note, index) => {
      const voucher = String(note.voucher_number || "").trim();
      lines.push({
        id: `${date}|credit-note|${voucher || "—"}|${index}`,
        date,
        kind: note.kind || "Credit Note",
        voucher: voucher || "—",
        sales_excl_vat: Number(note.amount_excl_vat || 0),
        sales_incl_vat: Number(note.amount_incl_vat || 0),
        collected_amount: null,
        open_amount: Number(note.remaining || 0),
        detail: note.status || note.reference || "",
        vch_no: voucher,
        can_delete_transaction: Boolean(voucher),
        can_delete_receipt: false,
      });
    });
    (Array.isArray(day?.purchases) ? day.purchases : []).forEach((purchase, index) => {
      const voucher = String(purchase.vch_no || "").trim();
      lines.push({
        id: `${date}|purchase|${voucher || "—"}|${index}`,
        date,
        kind: "Purchase",
        voucher: voucher || "—",
        sales_excl_vat: null,
        sales_incl_vat: null,
        collected_amount: null,
        open_amount: null,
        purchase_amount: Number(purchase.amount || 0),
        detail: purchaseDetail(purchase),
        receipt_date: purchase.receipt_date || date,
        vch_no: voucher,
        vch_type: String(purchase.vch_type || "Purchase").trim(),
        can_delete_transaction: Boolean(voucher),
        can_delete_receipt: Boolean(voucher),
      });
    });
    (Array.isArray(day?.receipts) ? day.receipts : []).forEach((receipt, index) => {
      const isPayment = receipt.kind === "payment" || Number(receipt.amount) < 0;
      const applications = Array.isArray(receipt.applications) ? receipt.applications : [];
      const voucher = String(receipt.vch_no || "").trim();
      lines.push({
        id: `${date}|${isPayment ? "payment" : "receipt"}|${voucher || "—"}|${index}`,
        date,
        kind: isPayment ? "Payment" : "Receipt",
        voucher: voucher || "—",
        sales_excl_vat: null,
        sales_incl_vat: null,
        // Prefer ar_amount when present so cancelled void-cycle collections
        // (ar_amount 0) and negative Payment refunds are not replaced by raw amount.
        // Fall back to amount for callers that only pass the cash figure.
        collected_amount: Number(
          receipt.ar_amount != null ? receipt.ar_amount : (receipt.amount ?? 0),
        ),
        open_amount: null,
        detail: receiptDetail(receipt),
        unmatched_collection: applications.some((application) => application?.unmatched_collection),
        receipt_date: receipt.receipt_date || date,
        vch_no: voucher,
        vch_type: String(receipt.vch_type || "").trim(),
        can_delete_transaction: Boolean(voucher),
        can_delete_receipt: Boolean(voucher),
      });
    });
  });
  return lines;
}

export function datewiseFilterValue(row, key) {
  if (key === "date") return row.date || "—";
  if (key === "kind") return row.kind || "—";
  if (key === "voucher") return row.voucher || "—";
  if (key === "excl") return formatOptionalMoney(row.sales_excl_vat);
  if (key === "incl") return formatOptionalMoney(row.sales_incl_vat);
  if (key === "collected") return formatOptionalMoney(row.collected_amount);
  if (key === "open") return formatOptionalMoney(row.open_amount);
  return row.detail || "—";
}

export function sumDatewise(rows, key) {
  return rows.reduce((total, row) => total + (row[key] == null ? 0 : Number(row[key]) || 0), 0);
}

/**
 * Immediate CN reversals belong on the Reversed table, not the customer ledger.
 * Matches reversed invoice rows and the credit notes / refunds that voided them.
 */
export function isImmediateReversalLedgerLine(row) {
  if (!row) return false;
  const kind = String(row.kind || "").trim();
  const detail = String(row.detail || "").trim();
  if (kind === "Invoice" && detail === "Reversed") return true;
  if (/^Reverses\b/i.test(detail)) return true;
  if (kind === "Payment" || kind === "Receipt") {
    if (/^Collection on reversed\b/i.test(detail) || /^Reversed sale\b/i.test(detail)) return true;
    // Keep unmatched-overcollection refunds on the ledger; drop CN-reversal refunds.
    if (/^Refund Invoice\b/i.test(detail) && !row.unmatched_collection) return true;
  }
  return false;
}

/** Datewise ledger lines with immediate reversals removed. */
export function flattenLedgerLinesExcludingReversed(days) {
  return flattenDatewiseLines(days).filter((row) => !isImmediateReversalLedgerLine(row));
}

/** Invoices still carrying Machine Open (or Tally-only pending). */
export function openSettlementInvoices(invoices = []) {
  return (Array.isArray(invoices) ? invoices : []).filter((invoice) => {
    if (Number(invoice?.remaining || 0) > 0.009) return true;
    if (invoice?.status === "Open" || invoice?.status === "Partial") return true;
    if (invoice?.tally_only && Number(invoice?.outstanding_pending || 0) > 0.009) return true;
    return false;
  });
}
