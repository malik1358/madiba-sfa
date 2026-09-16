import { formatIdleDuration } from "./collectionDaySummary.js";
import { escapeHtml } from "./dailyVisitReportEmail.js";
import { formatResumeMoney } from "./dailySalesmanResume.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  ORDER_STATUS_PENDING_CREDIT,
  ORDER_STATUS_PENDING_INVOICE_CREATION,
  ORDER_STATUS_PENDING_WITH_SALESMAN,
  ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
  ORDER_STATUS_WAITING_OVERDUE_COLLECTION,
  isPendingForApprovalStatus,
  isPendingForInvoiceCreationStatus,
  isPendingWithSalesmanStatus,
  isQuotationWaitingPaymentStatus,
  isWaitingForOverdueCollectionStatus,
} from "./orderApproval.js";
import { formatKsaDateTime, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const MISSING_INVOICE_GRACE_MS = 60 * 60 * 1000;
export const MISSING_INVOICE_EMAIL_MIN_INTERVAL_MS = 12 * 60 * 1000;
export const MISSING_INVOICE_EMAIL_LAST_SENT_KEY = "missing_invoice_email_last_sent_at";
export const MISSING_INVOICE_CREATED_FROM = "2026-09-01";
export const MISSING_INVOICE_STATUS_REJECTED = "Rejected by management";
export const MISSING_INVOICE_STATUS_NOT_UPLOADED = "Invoice not uploaded";
export const MISSING_INVOICE_STATUS_PENDING_APPROVAL = "Pending for approval";
export const MISSING_INVOICE_STATUS_PENDING_INVOICE_CREATION = ORDER_STATUS_PENDING_INVOICE_CREATION;
export const MISSING_INVOICE_STATUS_WAITING_OVERDUE_COLLECTION = ORDER_STATUS_WAITING_OVERDUE_COLLECTION;
export const MISSING_INVOICE_STATUS_QUOTATION_WAITING_PAYMENT = ORDER_STATUS_QUOTATION_WAITING_PAYMENT;
export const MISSING_INVOICE_STATUS_PENDING_WITH_SALESMAN = ORDER_STATUS_PENDING_WITH_SALESMAN;
export const IST_TIMEZONE = "Asia/Kolkata";
export const MISSING_INVOICE_EMAIL_START_MINUTES = 9 * 60;
export const MISSING_INVOICE_EMAIL_END_MINUTES = 20 * 60;
export const MISSING_INVOICE_EMAIL_FRIDAY = 5;
export const DEFAULT_MISSING_INVOICE_EMAIL_TO = [
  "shreyansh.sharma@noorshukran.com",
  "vinit.kulkarni@noorshukran.com",
  "prem.shah@noorshukran.com",
  "badrish.thapliyal@noorshukran.com",
  "ranish@pinasz.com",
  "malik@pinasz.com",
];
export const DEFAULT_MISSING_INVOICE_EMAIL_CC = [
  "jenil.modi@noorshukran.com",
  "soyeb@noorshukran.com",
  "fazlur.rahiman@noorshukran.com",
];

const EXCLUDED_INVOICE_STATUSES = new Set([
  MISSING_INVOICE_STATUS_REJECTED.toLowerCase(),
  "stock unavailable",
  "waiting for credit application",
  "waiting for stock transfer",
  "invoice made",
]);

const IST_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getIstDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: IST_WEEKDAY_INDEX[parts.weekday] ?? 0,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function isWithinMissingInvoiceEmailWindow(date = new Date()) {
  const parts = getIstDateTimeParts(date);
  if (parts.weekday === MISSING_INVOICE_EMAIL_FRIDAY) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= MISSING_INVOICE_EMAIL_START_MINUTES && minutes <= MISSING_INVOICE_EMAIL_END_MINUTES;
}

export function parseLastSentAt(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? String(value.lastSentAt || value.last_sent_at || "")
    : String(value || "");
  const ts = Date.parse(raw.trim());
  return Number.isFinite(ts) ? ts : null;
}

export function wasMissingInvoiceEmailSentRecently(lastSentAt, now = new Date(), minIntervalMs = MISSING_INVOICE_EMAIL_MIN_INTERVAL_MS) {
  const sentAt = typeof lastSentAt === "number" ? lastSentAt : parseLastSentAt(lastSentAt);
  if (!sentAt) return false;
  return now.getTime() - sentAt < minIntervalMs;
}

export function invoiceMetaKey(orderId) {
  return `order_invoice_meta:${String(orderId || "").trim()}`;
}

export function parseInvoiceMeta(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasUploadedInvoice(meta) {
  const payload = parseInvoiceMeta(meta) || {};
  return Boolean(String(payload.invoiceFilePath || "").trim() || String(payload.invoiceUploadedAt || "").trim());
}

export function invoiceStatusLabel(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  if (isPendingForApprovalStatus(status) || status.toLowerCase() === ORDER_STATUS_PENDING_CREDIT.toLowerCase()) {
    return MISSING_INVOICE_STATUS_PENDING_APPROVAL;
  }
  if (isPendingForInvoiceCreationStatus(status)) {
    return MISSING_INVOICE_STATUS_PENDING_INVOICE_CREATION;
  }
  if (isWaitingForOverdueCollectionStatus(status)) {
    return MISSING_INVOICE_STATUS_WAITING_OVERDUE_COLLECTION;
  }
  if (isQuotationWaitingPaymentStatus(status)) {
    return MISSING_INVOICE_STATUS_QUOTATION_WAITING_PAYMENT;
  }
  if (isPendingWithSalesmanStatus(status)) {
    return MISSING_INVOICE_STATUS_PENDING_WITH_SALESMAN;
  }
  return status || MISSING_INVOICE_STATUS_NOT_UPLOADED;
}

export function isInvoiceNotUploadedStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim().toLowerCase();
  return !status || status === MISSING_INVOICE_STATUS_NOT_UPLOADED.toLowerCase();
}

export function isPendingApprovalEmailStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  return isPendingForApprovalStatus(status);
}

export function isPendingInvoiceCreationEmailStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  if (isPendingForInvoiceCreationStatus(status)) return true;
  return isInvoiceNotUploadedStatus(meta);
}

export function isWaitingOverdueCollectionEmailStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  return isWaitingForOverdueCollectionStatus(status);
}

export function isQuotationWaitingPaymentEmailStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  return isQuotationWaitingPaymentStatus(status);
}

export function isPendingWithSalesmanEmailStatus(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim();
  return isPendingWithSalesmanStatus(status);
}

export function isRejectedByManagement(meta) {
  const status = String(parseInvoiceMeta(meta)?.status || "").trim().toLowerCase();
  return status === MISSING_INVOICE_STATUS_REJECTED.toLowerCase();
}

export function isExcludedFromMissingInvoiceEmail(meta) {
  if (hasUploadedInvoice(meta)) return true;
  if (isRejectedByManagement(meta)) return true;
  const status = String(parseInvoiceMeta(meta)?.status || "").trim().toLowerCase();
  if (!status) return false;
  if (isPendingForApprovalStatus(status) || isPendingForInvoiceCreationStatus(status)) return false;
  if (isWaitingForOverdueCollectionStatus(status)) return false;
  if (isQuotationWaitingPaymentStatus(status)) return false;
  if (isPendingWithSalesmanStatus(status)) return false;
  if (status === MISSING_INVOICE_STATUS_NOT_UPLOADED.toLowerCase()) return false;
  return EXCLUDED_INVOICE_STATUSES.has(status);
}

export function missingInvoiceCreatedFromIso() {
  return ksaDayBounds(MISSING_INVOICE_CREATED_FROM).startIso;
}

export function orderCreatedAtMs(order) {
  const ts = Date.parse(String(order?.created_at || ""));
  return Number.isFinite(ts) ? ts : null;
}

export function isCreatedFromSeptember2026(order) {
  const createdAt = orderCreatedAtMs(order);
  if (!createdAt) return false;
  return createdAt >= Date.parse(missingInvoiceCreatedFromIso());
}

export function isTestCustomerName(value) {
  return /(^|[^a-z])test([^a-z]|$)/i.test(String(value || "").trim());
}

export function isTestCustomerOrder(order) {
  return isTestCustomerName(order?.customer_name);
}

export function isMissingInvoiceOverdue(order, meta, now = new Date()) {
  if (String(order?.status || "").trim().toUpperCase() !== "SUBMITTED") return false;
  if (isTestCustomerOrder(order)) return false;
  const createdAt = orderCreatedAtMs(order);
  if (!createdAt) return false;
  if (!isCreatedFromSeptember2026(order)) return false;
  if (now.getTime() - createdAt < MISSING_INVOICE_GRACE_MS) return false;
  if (isExcludedFromMissingInvoiceEmail(meta)) return false;
  return isPendingApprovalEmailStatus(meta)
    || isPendingInvoiceCreationEmailStatus(meta)
    || isWaitingOverdueCollectionEmailStatus(meta)
    || isQuotationWaitingPaymentEmailStatus(meta)
    || isPendingWithSalesmanEmailStatus(meta);
}

export function selectMissingInvoiceOrders(orders = [], metaByOrder = new Map(), now = new Date()) {
  return (orders || [])
    .filter((order) => isMissingInvoiceOverdue(order, metaByOrder.get(String(order?.id || "").trim()), now))
    .sort((left, right) => (orderCreatedAtMs(left) || 0) - (orderCreatedAtMs(right) || 0));
}

export function partitionMissingInvoiceOrders(orders = [], metaByOrder = new Map()) {
  const pendingApproval = [];
  const pendingInvoiceCreation = [];
  const waitingOverdueCollection = [];
  const quotationWaitingPayment = [];
  const pendingWithSalesman = [];

  (orders || []).forEach((order) => {
    const meta = metaByOrder.get(String(order?.id || "").trim());
    if (isWaitingOverdueCollectionEmailStatus(meta)) {
      waitingOverdueCollection.push(order);
      return;
    }
    if (isQuotationWaitingPaymentEmailStatus(meta)) {
      quotationWaitingPayment.push(order);
      return;
    }
    if (isPendingWithSalesmanEmailStatus(meta)) {
      pendingWithSalesman.push(order);
      return;
    }
    if (isPendingApprovalEmailStatus(meta)) {
      pendingApproval.push(order);
      return;
    }
    pendingInvoiceCreation.push(order);
  });

  return {
    pendingApproval,
    pendingInvoiceCreation,
    waitingOverdueCollection,
    quotationWaitingPayment,
    pendingWithSalesman,
  };
}

export function formatMissingInvoiceAge(createdAt, now = new Date()) {
  const createdMs = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(createdMs)) return "-";
  return formatIdleDuration(Math.max(0, Math.round((now.getTime() - createdMs) / 60000)));
}

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

export function resolveMissingInvoiceEmailRecipients(env = process.env) {
  return mergeEmailList(DEFAULT_MISSING_INVOICE_EMAIL_TO, env.MISSING_INVOICE_EMAIL_TO);
}

export function resolveMissingInvoiceEmailCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList(DEFAULT_MISSING_INVOICE_EMAIL_CC, env.MISSING_INVOICE_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

function customerLabel(order) {
  const code = String(order?.customer_code || "").trim();
  const name = String(order?.customer_name || "").trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || "-";
}

function salesmanLabel(order) {
  const name = String(order?.salesman_name || "").trim();
  const code = String(order?.salesman_code || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "-";
}

function orderLabel(order) {
  return String(order?.order_number || "").trim() || String(order?.id || "").trim() || "-";
}

function orderRow(order, meta, now) {
  return {
    order: orderLabel(order),
    customer: customerLabel(order),
    salesman: salesmanLabel(order),
    createdAt: formatKsaDateTime(order?.created_at),
    age: formatMissingInvoiceAge(order?.created_at, now),
    value: formatResumeMoney(order?.total_value),
    invoiceStatus: invoiceStatusLabel(meta),
  };
}

function renderOrderTableRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="7" style="border:1px solid #c5d4de;padding:8px;">No orders in this queue.</td></tr>`;
  }
  return rows.map((row, index) => {
    const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
    return `<tr style="background:${rowBg};">
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.order)}</td>
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.customer)}</td>
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.salesman)}</td>
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.createdAt)}</td>
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.age)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.value)}</td>
        <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.invoiceStatus)}</td>
      </tr>`;
  }).join("");
}

function renderOrderTableHtml(title, rows) {
  return `<h3 style="margin: 20px 0 8px; color: #0f4c5c;">${escapeHtml(title)} (${rows.length})</h3>
  <table style="border-collapse: collapse; font-size: 13px; width: 100%;">
    <thead>
      <tr style="background:#0f4c5c;color:#ffffff;">
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Order</th>
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Customer</th>
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Salesman</th>
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Created (KSA)</th>
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Waiting</th>
        <th style="text-align:right;padding:6px 8px;border:1px solid #0f4c5c;">Value</th>
        <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c5c;">Invoice status</th>
      </tr>
    </thead>
    <tbody>${renderOrderTableRows(rows)}</tbody>
  </table>`;
}

function renderOrderTableText(title, rows) {
  return [
    `${title} (${rows.length})`,
    "Order | Customer | Salesman | Created (KSA) | Waiting | Value | Invoice status",
    ...rows.map((row) => [
      row.order,
      row.customer,
      row.salesman,
      row.createdAt,
      row.age,
      row.value,
      row.invoiceStatus,
    ].join(" | ")),
  ].join("\n");
}

export function buildMissingInvoiceAlertEmail({
  now = new Date(),
  orders = [],
  metaByOrder = new Map(),
} = {}) {
  const date = getKsaDateString(now);
  const partitioned = partitionMissingInvoiceOrders(orders, metaByOrder);
  const approvalRows = partitioned.pendingApproval.map((order) => (
    orderRow(order, metaByOrder.get(String(order?.id || "").trim()), now)
  ));
  const invoiceRows = partitioned.pendingInvoiceCreation.map((order) => (
    orderRow(order, metaByOrder.get(String(order?.id || "").trim()), now)
  ));
  const overdueCollectionRows = partitioned.waitingOverdueCollection.map((order) => (
    orderRow(order, metaByOrder.get(String(order?.id || "").trim()), now)
  ));
  const quotationRows = partitioned.quotationWaitingPayment.map((order) => (
    orderRow(order, metaByOrder.get(String(order?.id || "").trim()), now)
  ));
  const pendingWithSalesmanRows = partitioned.pendingWithSalesman.map((order) => (
    orderRow(order, metaByOrder.get(String(order?.id || "").trim()), now)
  ));
  const count = approvalRows.length
    + invoiceRows.length
    + overdueCollectionRows.length
    + quotationRows.length
    + pendingWithSalesmanRows.length;
  const subject = `${count} order${count === 1 ? "" : "s"} pending invoice / approval after 1 hour — ${date}`;

  const text = [
    `${count} submitted order${count === 1 ? "" : "s"} from September 2026 onward still ${count === 1 ? "needs" : "need"} invoice action more than 1 hour after creation.`,
    `Pending for approval: ${approvalRows.length}. Pending for invoice creation: ${invoiceRows.length}. Waiting for overdue collection: ${overdueCollectionRows.length}. Quotation submitted waiting for the payment: ${quotationRows.length}. Pending with salesman: ${pendingWithSalesmanRows.length}.`,
    "Orders rejected by management, stock unavailable, waiting-credit/stock-transfer, invoice-made, test-customer orders, and orders created before September 2026 are excluded.",
    `Checked at (KSA): ${formatKsaDateTime(now)}`,
    "",
    renderOrderTableText(MISSING_INVOICE_STATUS_PENDING_APPROVAL, approvalRows),
    "",
    renderOrderTableText(MISSING_INVOICE_STATUS_PENDING_INVOICE_CREATION, invoiceRows),
    "",
    renderOrderTableText(MISSING_INVOICE_STATUS_WAITING_OVERDUE_COLLECTION, overdueCollectionRows),
    "",
    renderOrderTableText(MISSING_INVOICE_STATUS_QUOTATION_WAITING_PAYMENT, quotationRows),
    "",
    renderOrderTableText(MISSING_INVOICE_STATUS_PENDING_WITH_SALESMAN, pendingWithSalesmanRows),
  ].join("\n");

  const html = `<div style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
  <h2 style="margin: 0 0 12px; color: #0f4c5c;">Orders pending invoice action after 1 hour</h2>
  <p style="margin: 0 0 16px;">${count} submitted order${count === 1 ? "" : "s"} from September 2026 onward ${count === 1 ? "still needs" : "still need"} invoice action more than 1 hour after creation. This email includes <strong>Pending for approval</strong> (${approvalRows.length}), <strong>Pending for invoice creation</strong> (${invoiceRows.length}), <strong>Waiting for overdue collection</strong> (${overdueCollectionRows.length}), <strong>Quotation submitted waiting for the payment</strong> (${quotationRows.length}), and <strong>Pending with salesman</strong> (${pendingWithSalesmanRows.length}) in separate tables.</p>
  <p style="margin: 0 0 16px; color: #52616b; font-size: 13px;">Checked at (KSA): ${escapeHtml(formatKsaDateTime(now))}. Rejected, stock-unavailable, waiting-credit/stock-transfer, invoice-made, test-customer, and pre-September-2026 orders are excluded.</p>
  ${renderOrderTableHtml(MISSING_INVOICE_STATUS_PENDING_APPROVAL, approvalRows)}
  ${renderOrderTableHtml(MISSING_INVOICE_STATUS_PENDING_INVOICE_CREATION, invoiceRows)}
  ${renderOrderTableHtml(MISSING_INVOICE_STATUS_WAITING_OVERDUE_COLLECTION, overdueCollectionRows)}
  ${renderOrderTableHtml(MISSING_INVOICE_STATUS_QUOTATION_WAITING_PAYMENT, quotationRows)}
  ${renderOrderTableHtml(MISSING_INVOICE_STATUS_PENDING_WITH_SALESMAN, pendingWithSalesmanRows)}
  <p style="margin: 16px 0 0; color: #52616b; font-size: 13px;">This reminder is sent every 15 minutes during India back-office hours (Saturday–Thursday, 9:00 AM–8:00 PM IST) while any qualifying order remains. Friday is a holiday.</p>
</div>`;

  return {
    subject,
    text,
    html,
    orderCount: count,
    pendingApprovalCount: approvalRows.length,
    pendingInvoiceCreationCount: invoiceRows.length,
    waitingOverdueCollectionCount: overdueCollectionRows.length,
    quotationWaitingPaymentCount: quotationRows.length,
    pendingWithSalesmanCount: pendingWithSalesmanRows.length,
  };
}
