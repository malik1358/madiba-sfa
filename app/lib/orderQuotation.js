import {
  hasUploadedInvoice,
  isInvoiceMadeStatus,
  isQuotationWaitingPaymentStatus,
  isRejectedByManagementStatus,
  isSubmittedOrder,
} from "./orderApproval.js";
import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";
import {
  addKsaCalendarDays,
  getKsaDateString,
  isKsaOrderDay,
} from "./workdayActivity.js";

/** Default customer quotation validity in KSA working days (Friday excluded). */
export const QUOTATION_VALIDITY_WORKING_DAYS = 3;

/** Allowed validity choices when making a quotation. */
export const QUOTATION_VALIDITY_WORKING_DAY_OPTIONS = [2, 3];

/**
 * Advance `days` KSA working days after `fromDateKey` (issue day not counted).
 * Fridays are skipped via `isKsaOrderDay`.
 */
export function addKsaWorkingDays(fromDateKey, days = QUOTATION_VALIDITY_WORKING_DAYS) {
  const start = String(fromDateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  let remaining = Math.max(0, Math.floor(Number(days) || 0));
  let dateKey = start;
  while (remaining > 0) {
    dateKey = addKsaCalendarDays(dateKey, 1);
    if (isKsaOrderDay(dateKey)) remaining -= 1;
  }
  return dateKey;
}

export function normalizeQuotationWorkingDays(value) {
  const parsed = Math.floor(Number(value));
  if (QUOTATION_VALIDITY_WORKING_DAY_OPTIONS.includes(parsed)) return parsed;
  return QUOTATION_VALIDITY_WORKING_DAYS;
}

export function resolveQuotationValidUntil({
  now = new Date(),
  workingDays = QUOTATION_VALIDITY_WORKING_DAYS,
} = {}) {
  const issueDate = getKsaDateString(now instanceof Date ? now : new Date(now));
  const days = normalizeQuotationWorkingDays(workingDays);
  return {
    issueDate,
    workingDays: days,
    validUntil: addKsaWorkingDays(issueDate, days),
  };
}

/**
 * Persist quotation validity on invoice meta without changing invoice status.
 * Make Quotation must not flip the queue to "Quotation submitted waiting for the payment".
 */
export function buildQuotationInvoiceMeta(existing = {}, {
  userId = "",
  now = new Date(),
  workingDays = QUOTATION_VALIDITY_WORKING_DAYS,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const resolved = resolveQuotationValidUntil({ now: nowDate, workingDays });
  const orderId = String(existing?.orderId || "").trim();

  return {
    ...(existing || {}),
    ...(orderId ? { orderId } : {}),
    quotationCreatedAt: nowIso,
    quotationCreatedBy: userId || existing?.quotationCreatedBy || "",
    quotationWorkingDays: resolved.workingDays,
    quotationValidUntil: resolved.validUntil,
    quotationIssueDate: resolved.issueDate,
    updatedAt: nowIso,
  };
}

export function canMakeOrderQuotation(order, meta = null) {
  if (!isSubmittedOrder(order)) return false;
  if (isQueuedPendingOrderId(order?.id)) return false;
  if (hasUploadedInvoice(meta)) return false;
  if (isInvoiceMadeStatus(meta?.status)) return false;
  if (isRejectedByManagementStatus(meta?.status)) return false;
  return true;
}

export function isOrderQuotationMeta(meta = null) {
  return Boolean(String(meta?.quotationValidUntil || "").trim())
    || isQuotationWaitingPaymentStatus(meta?.status);
}

export function formatQuotationValidUntilLabel(meta = null, language = "en") {
  const validUntil = String(meta?.quotationValidUntil || "").trim();
  if (!validUntil) return "";
  const days = normalizeQuotationWorkingDays(meta?.quotationWorkingDays);
  if (language === "ar") {
    return `صالح حتى ${validUntil} (${days} أيام عمل)`;
  }
  return `Valid until ${validUntil} (${days} working day${days === 1 ? "" : "s"})`;
}

export function quotationPdfSnapshotFields(meta = null, { force = false } = {}) {
  const hasQuotation = force || isOrderQuotationMeta(meta);
  if (!hasQuotation) {
    return {
      documentKind: "order",
      quotationValidUntil: "",
      quotationWorkingDays: null,
      quotationIssueDate: "",
    };
  }
  return {
    documentKind: "quotation",
    quotationValidUntil: String(meta?.quotationValidUntil || "").trim(),
    quotationWorkingDays: normalizeQuotationWorkingDays(meta?.quotationWorkingDays),
    quotationIssueDate: String(meta?.quotationIssueDate || "").trim(),
  };
}
