function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDateOnly(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB");
}

const OUTCOME_LABELS = {
  FUNDS_RECEIVED: "Funds received",
  ASKED_COME_LATER: "Asked to come later",
  RESPONSIBLE_NOT_AVAILABLE: "Responsible not available",
  WRONG_CREDIT_DAYS: "Wrong credit days",
  NO_DUE_AS_PER_CUSTOMER: "No due according to customer",
  TRANSFER_TO_LEGAL: "Transfer to legal",
  PAID: "Paid",
  PARTIAL: "Partial",
  NOT_PAID: "Not Paid",
  PROMISED: "Promised To Pay",
};

const RECEIPT_MODE_LABELS = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  BANK_TRANSFER: "Bank Transfer",
  ATM_MACHINE: "ATM Machine",
};

export const COLLECTION_VISIT_SUMMARY_LABELS = {
  summaryCustomer: "Customer",
  summaryCode: "Code",
  summaryQueuePriority: "Queue priority",
  summaryProbability: "Payment probability",
  summarySalesman: "Salesman",
  summaryOutcome: "Outcome",
  summaryAmountReceived: "Amount received",
  summaryReceiptMode: "Receipt mode",
  summaryNextVisit: "Next visit",
  summaryVisitNumber: "Visit number today",
  summaryOutstanding: "Outstanding",
  remarkArabic: "Remark (Arabic)",
  remarkEnglish: "Remark (English)",
  bucket30: "0-30",
  bucket31to60: "31-60",
  bucket61to90: "61-90",
  bucket91to120: "91-120",
  bucket120plus: ">120",
  summaryNotSpecified: "not specified",
};

export function formatCollectionOutcomeLabel(outcome, labels = OUTCOME_LABELS) {
  const key = String(outcome || "").trim().toUpperCase();
  return labels[key] || String(outcome || "-");
}

export function formatCollectionReceiptModeLabel(mode, labels = RECEIPT_MODE_LABELS) {
  const key = String(mode || "").trim().toUpperCase();
  return labels[key] || String(mode || "");
}

export function isPriorityCollectionVisit({
  queuePriority = 0,
  probabilityLabel = "",
} = {}) {
  const label = String(probabilityLabel || "").trim().toLowerCase();
  const priority = Number(queuePriority || 0);

  if (label === "high") {
    return { isPriority: true, reason: "high_probability" };
  }
  if (label === "medium") {
    return { isPriority: true, reason: "medium_probability" };
  }
  if (priority > 0 && priority <= 10) {
    return { isPriority: true, reason: "top_queue_position" };
  }
  if (label === "low" || label === "n/a" || !label) {
    return { isPriority: false, reason: label ? "low_probability" : "not_recorded" };
  }
  return { isPriority: false, reason: "below_priority_threshold" };
}

export function buildCollectionVisitSummary(row, form, options = {}, labels = COLLECTION_VISIT_SUMMARY_LABELS) {
  const amount = Number(form.amountReceived || 0);
  const nextVisit = formatDateOnly(form.nextVisitAt);
  const visitNumberForDay = Number(options.visitNumberForDay || 0);
  const queuePriority = Number(options.queuePriority || 0);
  const probabilityLabel = String(options.probabilityLabel || row.probability_label || "").trim();
  const outcomeText = formatCollectionOutcomeLabel(form.visitOutcome, OUTCOME_LABELS);
  const arabicRemark = String(form.remarkArabic || "").trim();
  const englishRemark = String(options.translatedRemark || form.remarkEnglish || "").trim();
  const lines = [
    `${labels.summaryCustomer}: ${row.customer_name || row.customer_code}`,
    `${labels.summaryCode}: ${row.customer_code || "-"}`,
    `${labels.summarySalesman}: ${row.salesman_name || row.salesman_code || "-"}`,
    `${labels.summaryOutcome}: ${outcomeText || labels.summaryNotSpecified}`,
  ];

  if (queuePriority > 0) {
    lines.splice(1, 0, `${labels.summaryQueuePriority}: ${queuePriority}.`);
  }
  if (probabilityLabel && probabilityLabel !== "N/A") {
    lines.splice(queuePriority > 0 ? 2 : 1, 0, `${labels.summaryProbability}: ${probabilityLabel}.`);
  }

  if (amount > 0) lines.push(`${labels.summaryAmountReceived}: ${formatMoney(amount)}.`);
  if (form.receiptMode) {
    lines.push(`${labels.summaryReceiptMode}: ${formatCollectionReceiptModeLabel(form.receiptMode)}.`);
  }
  if (arabicRemark) lines.push(`${labels.remarkArabic}: ${arabicRemark}.`);
  if (englishRemark) lines.push(`${labels.remarkEnglish}: ${englishRemark}.`);
  lines.push(`${labels.summaryNextVisit}: ${nextVisit || labels.summaryNotSpecified}.`);
  if (visitNumberForDay > 0) {
    lines.push(`${labels.summaryVisitNumber}: ${visitNumberForDay}.`);
  }
  lines.push(`${labels.summaryOutstanding}:`);
  lines.push(`${labels.bucket30}: ${formatMoney(row.outstanding_0_30)}`);
  lines.push(`${labels.bucket31to60}: ${formatMoney(row.outstanding_30_60)}`);
  lines.push(`${labels.bucket61to90}: ${formatMoney(row.outstanding_61_90)}`);
  lines.push(`${labels.bucket91to120}: ${formatMoney(row.outstanding_91_120)}`);
  lines.push(`${labels.bucket120plus}: ${formatMoney(row.outstanding_above_120)}`);
  return lines.join("\n");
}

export function buildStoredCollectionVisitSummary(row, visit, options = {}, labels = COLLECTION_VISIT_SUMMARY_LABELS) {
  if (!visit) return "";

  const reportRow = {
    ...row,
    salesman_name: visit.scheduled_by_name || row.salesman_name,
    salesman_code: row.salesman_code,
  };

  return buildCollectionVisitSummary(reportRow, {
    visitOutcome: visit.visit_outcome || visit.payment_status || "",
    amountReceived: visit.amount_received ? String(visit.amount_received) : "",
    receiptMode: visit.receipt_mode || "",
    nextVisitAt: visit.next_visit_at || "",
    remarkArabic: visit.remark_arabic || "",
    remarkEnglish: visit.remark_english || "",
  }, {
    ...options,
    translatedRemark: visit.remark_english || "",
    queuePriority: visit.queue_priority ?? options.queuePriority ?? 0,
    probabilityLabel: visit.probability_label ?? options.probabilityLabel ?? "",
    visitNumberForDay: visit.visit_number_for_day ?? options.visitNumberForDay ?? 0,
  }, labels);
}
