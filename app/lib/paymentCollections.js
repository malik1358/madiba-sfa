import {
  extractLeadingCustomerCodeAndName,
  isPlaceholderSalesmanValue,
  parseOutstandingSheetDate,
  pickOutstandingSalesmanName,
  resolveInvoiceAgingDays,
  resolveInvoiceDays,
} from "./outstanding.js";
import { salesmanValueMatchesScope } from "./mutualSalesmanGroups.js";
import {
  customerAssignmentMatchesScope,
  customerHasActiveSalesmanTransfer,
} from "./customerSalesmanAssignment.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function comparableName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loosePersonName(value) {
  return comparableName(value)
    .replace(/[^A-Z]/g, "")
    .replace(/[AEIOU]/g, "")
    .replace(/(.)\1+/g, "$1");
}

export const COLLECTION_QUEUE_EXCLUDED_SALESMEN = [
  "Zia",
  "Asrar Ahmed",
];

export function isExcludedCollectionQueueSalesman(value, {
  excludedNames = COLLECTION_QUEUE_EXCLUDED_SALESMEN,
} = {}) {
  const key = loosePersonName(value);
  if (!key) return false;
  return excludedNames.some((name) => loosePersonName(name) === key);
}

export function filterCollectionQueueInvoices(invoices, options = {}) {
  return (invoices || []).filter((invoice) => !isExcludedCollectionQueueSalesman(invoice?.salesman, options));
}

function customerMasterInScope(customer, scopeMatchers, scopeCodeSet) {
  return customerAssignmentMatchesScope(customer, scopeMatchers, scopeCodeSet);
}

export function customerMatchesCollectionScope({
  customer = {},
  customerInvoices = [],
  scopeMatchers,
  normalizedScopeCodes = [],
  aggregateRowSalesman = "",
  hasAllAccess = false,
} = {}) {
  if (hasAllAccess) return true;

  const scopeCodeSet = new Set(
    (normalizedScopeCodes || []).map((code) => normalizeCode(code)).filter(Boolean),
  );
  const uploadSalesman = pickOutstandingSalesmanName(customerInvoices);
  const invoiceSalesmen = (customerInvoices || [])
    .map((invoice) => invoice.salesman)
    .filter((name) => name && !isPlaceholderSalesmanValue(name));

  const invoiceOwned = (uploadSalesman && !isPlaceholderSalesmanValue(uploadSalesman)
    && salesmanValueMatchesScope(uploadSalesman, scopeMatchers))
    || invoiceSalesmen.some((name) => salesmanValueMatchesScope(name, scopeMatchers));

  const rowOwned = aggregateRowSalesman && !isPlaceholderSalesmanValue(aggregateRowSalesman)
    && salesmanValueMatchesScope(aggregateRowSalesman, scopeMatchers);
  const masterInScope = customerMasterInScope(customer, scopeMatchers, scopeCodeSet);

  const hasInvoiceSalesman = Boolean(
    (uploadSalesman && !isPlaceholderSalesmanValue(uploadSalesman))
    || invoiceSalesmen.length > 0,
  );

  if (hasInvoiceSalesman) {
    return Boolean(invoiceOwned || rowOwned || (
      customerHasActiveSalesmanTransfer(customer) && masterInScope
    ));
  }

  return Boolean(masterInScope || rowOwned);
}

export function canViewerSeeScheduledRevisit(visit, _schedulerProfile, viewer = {}) {
  if (!visit?.next_visit_at || !visit?.created_by) return true;
  if (viewer.canSeeAllSchedulers) return true;

  const schedulerId = String(visit.created_by || visit.scheduled_by_id || "").trim();
  const allowedIds = (viewer.visibleSchedulerUserIds || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (allowedIds.length === 0) {
    const viewerId = String(viewer.userId || "").trim();
    return Boolean(viewerId && viewerId === schedulerId);
  }

  return allowedIds.includes(schedulerId);
}

export function canViewerSeeCollectorScheduledRevisit(visit, schedulerProfile, viewer = {}) {
  return canViewerSeeScheduledRevisit(visit, schedulerProfile, viewer);
}

export function redactCollectionVisitScheduleForViewer(visit, schedulerProfile, viewer = {}) {
  if (!visit || canViewerSeeScheduledRevisit(visit, schedulerProfile, viewer)) {
    return visit;
  }

  return {
    ...visit,
    next_visit_at: null,
  };
}

export function shouldExcludeCollectionQueueRecord(record, options = {}) {
  const invoices = filterCollectionQueueInvoices(record?.invoices, options);
  if (invoices.length > 0) return false;

  const candidateNames = [
    record?.salesman_name,
    record?.salesman_code,
    record?.current_salesman_code,
  ].filter(Boolean);

  return candidateNames.some((name) => isExcludedCollectionQueueSalesman(name, options));
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  return parseOutstandingSheetDate(value);
}

export function collectionRowMatchesCustomerQuery(row, customerFilter) {
  const customerQuery = String(customerFilter || "").trim().toLowerCase();
  if (!customerQuery) return true;

  const fields = [
    row?.customer_code,
    row?.customer_name,
    extractLeadingCustomerCodeAndName(row?.customer_code).customer_code,
    extractLeadingCustomerCodeAndName(row?.customer_name).customer_code,
    extractLeadingCustomerCodeAndName(row?.customer_name).customer_name,
  ];
  if (fields.some((value) => String(value || "").toLowerCase().includes(customerQuery))) {
    return true;
  }

  const compactQuery = customerQuery.replace(/[^a-z0-9]/g, "");
  if (!compactQuery) return false;
  return fields.some((value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(compactQuery));
}

export function scheduledRevisitDate(record) {
  return dateOnly(record?.latest_collection?.next_visit_at);
}

export function hasCollectionVisit(record) {
  return Boolean(dateOnly(record?.latest_collection?.saved_at));
}

function scheduledRevisitTier(record, today) {
  const revisitAt = scheduledRevisitDate(record);
  if (!revisitAt) return 2;
  if (revisitAt >= today) return 0;
  return 1;
}

function compareScheduledRevisitPriority(left, right, today) {
  const byTier = scheduledRevisitTier(left, today) - scheduledRevisitTier(right, today);
  if (byTier !== 0) return byTier;

  const leftDate = scheduledRevisitDate(left);
  const rightDate = scheduledRevisitDate(right);
  if (leftDate && rightDate) {
    const byDate = compareDateText(leftDate, rightDate);
    if (byDate !== 0) return byDate;
  }

  return 0;
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
  const refText = String(invoice?.ref_no || "").trim();
  return /C/i.test(refText);
}

export function isInvoiceCashDue(invoice) {
  return invoiceHasCashRef(invoice) && toNumber(invoice?.pending_amount) > 0;
}

export function hasFutureScheduledRevisit(record, today) {
  const revisitAt = scheduledRevisitDate(record);
  return Boolean(revisitAt && revisitAt > today);
}

export function hasUpcomingScheduledRevisit(record, todayIso = new Date().toISOString()) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const revisitAt = scheduledRevisitDate(record);
  return Boolean(revisitAt && revisitAt >= today);
}

export function hasPendingScheduledRevisit(record) {
  return Boolean(scheduledRevisitDate(record));
}

export function isOverdueScheduledRevisit(record, todayIso = new Date().toISOString()) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const revisitAt = scheduledRevisitDate(record);
  return Boolean(revisitAt && revisitAt < today);
}

export function isScheduledRevisitQueueCustomer(record, todayIso = new Date().toISOString()) {
  if (!hasPendingScheduledRevisit(record)) return false;
  if (!hasCollectionVisit(record)) return false;

  const status = String(record?.latest_collection?.payment_status || "").trim().toUpperCase();
  return status !== "PAID";
}

export function hasCashDueInvoices(record) {
  if (toNumber(record?.outstanding_cash) > 0) return true;
  return Array.isArray(record?.invoices)
    && record.invoices.some((invoice) => isInvoiceCashDue(invoice));
}

export function shouldPrioritizeCashVisit(record, today) {
  return hasCashDueInvoices(record) && !hasFutureScheduledRevisit(record, today);
}

export function isInvoiceCreditDue(invoice, today) {
  if (toNumber(invoice?.pending_amount) <= 0) return false;
  if (isInvoiceCashDue(invoice)) return false;
  return isInvoicePastDue(invoice, today);
}

export function hasCreditDueInvoices(record, todayIso = new Date().toISOString()) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  return Array.isArray(record?.invoices)
    && record.invoices.some((invoice) => isInvoiceCreditDue(invoice, today));
}

export function isCashQueueCustomer(record, todayIso = new Date().toISOString()) {
  if (!hasCashDueInvoices(record)) return false;
  if (isScheduledRevisitQueueCustomer(record, todayIso)) return false;
  return true;
}

export function isCashOnlyQueueCustomer(record, todayIso = new Date().toISOString()) {
  return isCashQueueCustomer(record, todayIso) && !hasCreditDueInvoices(record, todayIso);
}

export function sortCashQueueCustomers(rows) {
  return [...(rows || [])].sort((left, right) => {
    const byCashAmount = toNumber(right?.outstanding_cash) - toNumber(left?.outstanding_cash);
    if (byCashAmount !== 0) return byCashAmount;

    const byExposure = Number(right?.exposure_score || 0) - Number(left.exposure_score || 0);
    if (byExposure !== 0) return byExposure;

    return String(left.customer_name || left.customer_code || "")
      .localeCompare(String(right.customer_name || right.customer_code || ""));
  });
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

export function buildExposureScore(totalDueAmount, invoiceDays) {
  const amount = Math.max(0, Number(totalDueAmount || 0));
  const days = Math.max(0, Number(invoiceDays || 0));
  return amount * days;
}

export function buildExposureScoreFromInvoices(invoices, todayIso = new Date().toISOString()) {
  const today = `${dateOnly(todayIso) || new Date().toISOString().slice(0, 10)}T00:00:00`;

  return (invoices || []).reduce((sum, invoice) => {
    const amount = toNumber(invoice?.pending_amount);
    if (amount <= 0) return sum;
    const days = Math.max(0, resolveInvoiceDays(invoice, today));
    return sum + (amount * days);
  }, 0);
}

export function buildCollectionPriority(record) {
  const maxOverdueDays = Math.max(0, Number(record?.max_overdue_days || 0));
  const totalDueAmount = Math.max(0, Number(record?.total_due_amount || 0));
  const dueInvoiceCount = Math.max(0, Number(record?.due_invoice_count || 0));
  const exposureScore = Number(record?.exposure_score) > 0
    ? Number(record.exposure_score)
    : buildExposureScore(totalDueAmount, maxOverdueDays);
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

  if (exposureScore >= 2500000) score += 28;
  else if (exposureScore >= 1500000) score += 24;
  else if (exposureScore >= 1000000) score += 20;
  else if (exposureScore >= 500000) score += 14;
  else   if (exposureScore > 0) score += 8;

  if (toNumber(record?.outstanding_cash) > 0) score += 30;

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

  if (lastVisitAt) {
    score -= 15;
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    label: probabilityLabel(normalizedScore),
  };
}

function only0to30Outstanding(record) {
  const b0to30 = toNumber(record?.outstanding_0_30);
  const b31to60 = toNumber(record?.outstanding_30_60);
  const b61to90 = toNumber(record?.outstanding_61_90);
  const b91to120 = toNumber(record?.outstanding_91_120);
  const b120plus = toNumber(record?.outstanding_above_120);
  return b0to30 > 0 && b31to60 <= 0 && b61to90 <= 0 && b91to120 <= 0 && b120plus <= 0;
}

export function isInvoicePastDue(invoice, today) {
  if (toNumber(invoice?.pending_amount) <= 0) return false;
  const dueDate = dateOnly(invoice?.due_date);
  if (dueDate && dueDate < today) return true;
  return resolveInvoiceAgingDays(invoice, `${today}T00:00:00`) > 0;
}

export function isInvoiceDueForCollection(invoice, today) {
  return isInvoicePastDue(invoice, today) || isInvoiceCashDue(invoice);
}

export function isInvoiceNotYetDue(invoice, today) {
  if (toNumber(invoice?.pending_amount) <= 0) return false;
  if (isInvoiceCashDue(invoice)) return false;
  return !isInvoicePastDue(invoice, today);
}

export function buildCollectionQueues(records, todayIso = new Date().toISOString()) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const dueCustomers = [];
  const notDueCustomers = [];
  const legalCustomers = [];

  (records || []).forEach((record) => {
    const filteredInvoices = filterCollectionQueueInvoices(record?.invoices);
    if (filteredInvoices.length === 0) return;

    const queueRecord = {
      ...record,
      invoices: filteredInvoices,
    };

    const dueInvoices = Array.isArray(queueRecord?.invoices)
      ? queueRecord.invoices.filter((invoice) => isInvoiceDueForCollection(invoice, today))
      : [];

    const notDueInvoices = Array.isArray(queueRecord?.invoices)
      ? queueRecord.invoices.filter((invoice) => isInvoiceNotYetDue(invoice, today))
      : [];

    const totalDueAmount = dueInvoices.reduce((sum, invoice) => sum + toNumber(invoice?.pending_amount), 0);
    const cashDueAmount = dueInvoices.reduce(
      (sum, invoice) => sum + (isInvoiceCashDue(invoice) ? toNumber(invoice?.pending_amount) : 0),
      0,
    );
    const maxOverdueDays = dueInvoices.reduce(
      (max, invoice) => Math.max(max, resolveInvoiceAgingDays(invoice, `${today}T00:00:00`)),
      0,
    );
    const earliestDueDate = dueInvoices
      .map((invoice) => dateOnly(invoice?.due_date))
      .filter(Boolean)
      .sort()[0] || "";
    const latestStatus = String(queueRecord?.latest_collection?.payment_status || "").trim().toUpperCase();
    const exposureScore = buildExposureScoreFromInvoices(dueInvoices, todayIso);
    const priority = buildCollectionPriority({
      ...queueRecord,
      total_due_amount: totalDueAmount,
      max_overdue_days: maxOverdueDays,
      due_invoice_count: dueInvoices.length,
      exposure_score: exposureScore,
      today,
    });

    const next = {
      ...queueRecord,
      queue_key: queueKeyFor(queueRecord),
      due_invoice_count: dueInvoices.length,
      total_due_amount: totalDueAmount,
      max_overdue_days: maxOverdueDays,
      earliest_due_date: earliestDueDate,
      scheduled_revisit_at: scheduledRevisitDate(queueRecord),
      exposure_score: exposureScore,
      outstanding_cash: cashDueAmount,
      has_cash_due: cashDueAmount > 0,
      invoices: Array.isArray(queueRecord?.invoices) ? queueRecord.invoices : [],
      probability_score: priority.score,
      probability_label: priority.label,
      recommended_visit: dueInvoices.length > 0 && latestStatus !== "PAID" && !queueRecord?.legal_transfer?.is_transferred,
    };

    // Add to legal queue if transferred
    if (queueRecord?.legal_transfer?.is_transferred) {
      legalCustomers.push(next);
      return;
    }

    if (dueInvoices.length > 0) {
      dueCustomers.push(next);
      return;
    }

    if (notDueInvoices.length === 0) return;

    const totalNotDueAmount = notDueInvoices.reduce((sum, invoice) => sum + toNumber(invoice?.pending_amount), 0);
    const earliestFutureDueDate = notDueInvoices
      .map((invoice) => dateOnly(invoice?.due_date))
      .filter(Boolean)
      .sort()[0] || "";

    notDueCustomers.push({
      ...next,
      queue_kind: "not_due",
      due_invoice_count: notDueInvoices.length,
      not_due_invoice_count: notDueInvoices.length,
      total_due_amount: totalNotDueAmount,
      total_not_due_amount: totalNotDueAmount,
      max_overdue_days: 0,
      earliest_due_date: earliestFutureDueDate,
      invoices: notDueInvoices,
      probability_score: 0,
      probability_label: "N/A",
      recommended_visit: false,
    });
  });

  dueCustomers.sort((left, right) => {
    const byExposure = Number(right.exposure_score || 0) - Number(left.exposure_score || 0);
    if (byExposure !== 0) return byExposure;

    const byVisitStatus = Number(hasCollectionVisit(left)) - Number(hasCollectionVisit(right));
    if (byVisitStatus !== 0) return byVisitStatus;

    const leftHasDue = Number(left.due_invoice_count > 0);
    const rightHasDue = Number(right.due_invoice_count > 0);
    const byDueStatus = rightHasDue - leftHasDue;
    if (byDueStatus !== 0) return byDueStatus;

    // Probability score
    const byScore = Number(right.probability_score || 0) - Number(left.probability_score || 0);
    if (byScore !== 0) return byScore;

    // Days overdue
    const byOverdue = Number(right.max_overdue_days || 0) - Number(left.max_overdue_days || 0);
    if (byOverdue !== 0) return byOverdue;

    // Earliest due date
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

  notDueCustomers.sort((left, right) => {
    const byDueDate = compareDateText(left?.earliest_due_date, right?.earliest_due_date);
    if (byDueDate !== 0) return byDueDate;
    const byAmount = Number(right.total_not_due_amount || 0) - Number(left.total_not_due_amount || 0);
    if (byAmount !== 0) return byAmount;
    return String(left.customer_name || left.customer_code || "").localeCompare(String(right.customer_name || right.customer_code || ""));
  });

  return { dueCustomers, notDueCustomers, legalCustomers };
}