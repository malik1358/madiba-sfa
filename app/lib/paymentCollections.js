function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function compareDateText(left, right) {
  const a = dateOnly(left);
  const b = dateOnly(right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function diffDays(later, earlier) {
  const a = new Date(later);
  const b = new Date(earlier);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)));
}

function probabilityLabel(score) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function invoiceHasCashRef(invoice) {
  const refText = String(
    invoice?.ref_no
    || invoice?.ref
    || invoice?.reference_no
    || invoice?.reference
    || "",
  );
  return /C/i.test(refText);
}

function queueKeyFor(record) {
  const normalizedCode = normalizeCode(record?.customer_code);
  if (normalizedCode) return normalizedCode;
  return normalizeLooseToken(record?.customer_name);
}

export function normalizeWhatsappNumber(value, defaultCountryCode = "966") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(defaultCountryCode)) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `${defaultCountryCode}${digits.slice(1)}`;
  return digits;
}

export function buildCollectionPriority(record) {
  const maxOverdueDays = Math.max(0, Number(record?.max_overdue_days || 0));
  const totalDueAmount = Math.max(0, Number(record?.total_due_amount || 0));
  const dueInvoiceCount = Math.max(0, Number(record?.due_invoice_count || 0));
  const latestStatus = String(record?.latest_collection?.payment_status || "").trim().toUpperCase();
  const lastVisitAt = dateOnly(record?.latest_collection?.saved_at);
  const nextVisitAt = dateOnly(record?.latest_collection?.next_visit_at);
  const today = dateOnly(record?.today || new Date().toISOString());
  const daysSinceLastVisit = lastVisitAt && today ? diffDays(today, lastVisitAt) : 90;

  let score = 0;

  if (maxOverdueDays >= 120) score += 42;
  else if (maxOverdueDays >= 90) score += 36;
  else if (maxOverdueDays >= 60) score += 30;
  else if (maxOverdueDays >= 30) score += 22;
  else if (maxOverdueDays > 0) score += 12;
  else score += 4;

  if (totalDueAmount >= 50000) score += 20;
  else if (totalDueAmount >= 20000) score += 16;
  else if (totalDueAmount >= 5000) score += 12;
  else score += 7;

  if (dueInvoiceCount >= 5) score += 14;
  else if (dueInvoiceCount >= 3) score += 11;
  else if (dueInvoiceCount >= 1) score += 8;

  score += Math.min(24, Math.floor(daysSinceLastVisit / 5));

  if (latestStatus === "PROMISED") score += 14;
  if (latestStatus === "PARTIAL") score += 10;
  if (latestStatus === "NOT_PAID") score += 4;
  if (latestStatus === "PAID") score -= 40;

  if (nextVisitAt && today && nextVisitAt <= today) {
    score += 8;
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    label: probabilityLabel(normalizedScore),
  };
}

function hasCreditRef(record) {
  return Array.isArray(record?.invoices)
    && record.invoices.some((invoice) => invoiceHasCashRef(invoice));
}

function only0to30Outstanding(record) {
  const b0to30 = toNumber(record?.outstanding_0_30);
  const b31to60 = toNumber(record?.outstanding_30_60);
  const b61to90 = toNumber(record?.outstanding_61_90);
  const b91to120 = toNumber(record?.outstanding_91_120);
  const b120plus = toNumber(record?.outstanding_above_120);
  return b0to30 > 0 && b31to60 <= 0 && b61to90 <= 0 && b91to120 <= 0 && b120plus <= 0;
}

export function buildCollectionQueues(records, todayIso = new Date().toISOString()) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const dueCustomers = [];
  const legalCustomers = [];

  (records || []).forEach((record) => {
    // Calculate due invoices (only past-due and cash)
    const dueInvoices = Array.isArray(record?.invoices)
      ? record.invoices.filter((invoice) => {
          const dueDate = dateOnly(invoice?.due_date);
          if (toNumber(invoice?.pending_amount) <= 0) return false;
          if (invoiceHasCashRef(invoice)) return true;
          return Boolean(dueDate) && dueDate <= today;
        })
      : [];

    // Calculate all invoices with pending amounts (for display)
    const allPendingInvoices = Array.isArray(record?.invoices)
      ? record.invoices.filter((invoice) => toNumber(invoice?.pending_amount) > 0)
      : [];

    const totalDueAmount = dueInvoices.reduce((sum, invoice) => sum + toNumber(invoice?.pending_amount), 0);
    const maxOverdueDays = dueInvoices.reduce((max, invoice) => Math.max(max, toNumber(invoice?.overdue_days)), 0);
    const earliestDueDate = dueInvoices
      .map((invoice) => dateOnly(invoice?.due_date))
      .filter(Boolean)
      .sort()[0] || "";
    const latestStatus = String(record?.latest_collection?.payment_status || "").trim().toUpperCase();
    const priority = buildCollectionPriority({
      ...record,
      total_due_amount: totalDueAmount,
      max_overdue_days: maxOverdueDays,
      due_invoice_count: dueInvoices.length,
      today,
    });

    const next = {
      ...record,
      queue_key: queueKeyFor(record),
      due_invoice_count: dueInvoices.length,
      total_due_amount: totalDueAmount,
      max_overdue_days: maxOverdueDays,
      earliest_due_date: earliestDueDate,
      invoices: Array.isArray(record?.invoices) ? record.invoices : [],
      probability_score: priority.score,
      probability_label: priority.label,
      recommended_visit: dueInvoices.length > 0 && latestStatus !== "PAID" && !record?.legal_transfer?.is_transferred,
    };

    // Add to legal queue if transferred
    if (record?.legal_transfer?.is_transferred) {
      legalCustomers.push(next);
      return;
    }

    // Add ALL customers to due queue (not just those with due invoices)
    dueCustomers.push(next);
  });

  // Sort: customers with due amounts first, then by priority
  dueCustomers.sort((left, right) => {
    // Priority 1: Has due invoices vs no due invoices
    const leftHasDue = Number(left.due_invoice_count > 0);
    const rightHasDue = Number(right.due_invoice_count > 0);
    const byDueStatus = rightHasDue - leftHasDue;
    if (byDueStatus !== 0) return byDueStatus;

    // Priority 2: Cash presence
    const leftCash = toNumber(left?.outstanding_cash);
    const rightCash = toNumber(right?.outstanding_cash);
    const byCashPresence = Number(rightCash > 0) - Number(leftCash > 0);
    if (byCashPresence !== 0) return byCashPresence;

    // Priority 3: Cash amount
    const byCashAmount = rightCash - leftCash;
    if (byCashAmount !== 0) return byCashAmount;

    // Priority 4: Probability score
    const byScore = Number(right.probability_score || 0) - Number(left.probability_score || 0);
    if (byScore !== 0) return byScore;

    // Priority 5: Days overdue
    const byOverdue = Number(right.max_overdue_days || 0) - Number(left.max_overdue_days || 0);
    if (byOverdue !== 0) return byOverdue;

    // Priority 6: Earliest due date
    const byOldestDue = compareDateText(left?.earliest_due_date, right?.earliest_due_date);
    if (byOldestDue !== 0) return byOldestDue;
    const byAmount = Number(right.total_due_amount || 0) - Number(left.total_due_amount || 0);
    if (byAmount !== 0) return byAmount;
    return String(left.customer_name || left.customer_code || "").localeCompare(String(right.customer_name || right.customer_code || ""));
  });

  legalCustomers.sort((left, right) => {
    const byTransferredAt = compareDateText(right?.legal_transfer?.transferred_at, left?.legal_transfer?.transferred_at);
    if (byTransferredAt !== 0) return byTransferredAt;
    return Number(right.total_due_amount || 0) - Number(left.total_due_amount || 0);
  });

  return { dueCustomers, legalCustomers };
}