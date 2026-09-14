export const ORDER_STATUS_PENDING_APPROVAL = "Pending for approval";
/** Legacy status kept for existing invoice meta rows. */
export const ORDER_STATUS_PENDING_CREDIT = "Pending for credit approval";
export const ORDER_STATUS_WAITING_CREDIT_APPLICATION = "Waiting for credit application";
export const ORDER_STATUS_QUOTATION_WAITING_PAYMENT = "Quotation submitted waiting for the payment";
export const ORDER_STATUS_REJECTED = "Rejected by management";
export const ORDER_STATUS_STOCK_UNAVAILABLE = "Stock unavailable";
export const ORDER_STATUS_WAITING_STOCK_TRANSFER = "Waiting for stock transfer";
export const ORDER_STATUS_INVOICE_MADE = "Invoice made";

export const ORDER_REJECTION_REASON_CREDIT_LIMIT = "Credit limit";
export const ORDER_REJECTION_REASON_DISCOUNT_PRICE = "Discount or price problem";
export const ORDER_REJECTION_REASON_STOCK = "Stock not available";

export const ORDER_REJECTION_REASONS = [
  ORDER_REJECTION_REASON_CREDIT_LIMIT,
  ORDER_REJECTION_REASON_DISCOUNT_PRICE,
  ORDER_REJECTION_REASON_STOCK,
];

export const ORDER_INVOICE_STATUSES = [
  ORDER_STATUS_PENDING_APPROVAL,
  ORDER_STATUS_PENDING_CREDIT,
  ORDER_STATUS_WAITING_CREDIT_APPLICATION,
  ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
  ORDER_STATUS_REJECTED,
  ORDER_STATUS_STOCK_UNAVAILABLE,
  ORDER_STATUS_WAITING_STOCK_TRANSFER,
  ORDER_STATUS_INVOICE_MADE,
];

export function normalizeInvoiceStatus(value) {
  return String(value || "").trim();
}

export function isPendingForApprovalStatus(status) {
  const normalized = normalizeInvoiceStatus(status).toLowerCase();
  return normalized === ORDER_STATUS_PENDING_APPROVAL.toLowerCase()
    || normalized === ORDER_STATUS_PENDING_CREDIT.toLowerCase();
}

export function displayInvoiceStatus(meta, {
  approvalRequired = false,
  order = null,
} = {}) {
  const status = normalizeInvoiceStatus(meta?.status);
  if (isPendingForApprovalStatus(status)) {
    return ORDER_STATUS_PENDING_APPROVAL;
  }
  if (status && status.toLowerCase() !== "invoice not uploaded") {
    if (status === ORDER_STATUS_REJECTED && meta?.rejectionReason) {
      return `${ORDER_STATUS_REJECTED} (${meta.rejectionReason})`;
    }
    if (status === ORDER_STATUS_STOCK_UNAVAILABLE && meta?.rejectionReason === ORDER_REJECTION_REASON_STOCK) {
      return `${ORDER_STATUS_STOCK_UNAVAILABLE} (${ORDER_REJECTION_REASON_STOCK})`;
    }
    return status;
  }
  if (meta?.approvedAt) {
    return meta?.invoiceUploadedAt || meta?.invoiceFilePath ? ORDER_STATUS_INVOICE_MADE : "-";
  }
  if (approvalRequired || isSubmittedAwaitingInvoiceApproval(order, meta)) {
    return ORDER_STATUS_PENDING_APPROVAL;
  }
  if (meta?.invoiceUploadedAt || meta?.invoiceFilePath) {
    return ORDER_STATUS_INVOICE_MADE;
  }
  return "-";
}

export function isSupportedInvoiceStatus(status) {
  return ORDER_INVOICE_STATUSES.includes(normalizeInvoiceStatus(status));
}

export function isValidRejectionReason(reason) {
  return ORDER_REJECTION_REASONS.includes(normalizeInvoiceStatus(reason));
}

export function statusForRejectionReason(reason) {
  const normalized = normalizeInvoiceStatus(reason);
  if (normalized === ORDER_REJECTION_REASON_STOCK) {
    return ORDER_STATUS_STOCK_UNAVAILABLE;
  }
  return ORDER_STATUS_REJECTED;
}

export function canApprovePendingOrders(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  return normalized === "admin" || normalized === "manager";
}

export function isSubmittedOrder(order) {
  return String(order?.status || "").trim().toUpperCase() === "SUBMITTED";
}

export function hasUploadedInvoice(meta) {
  return Boolean(
    String(meta?.invoiceFilePath || "").trim()
    || String(meta?.invoiceUploadedAt || "").trim(),
  );
}

/** Statuses that already leave the pending-approval queue. */
export function hasSettledInvoiceStatus(meta) {
  const status = normalizeInvoiceStatus(meta?.status).toLowerCase();
  if (!status) return false;
  if (isPendingForApprovalStatus(status)) return false;
  if (status === "invoice not uploaded") return false;
  return true;
}

/**
 * Submitted orders with no invoice uploaded (and not already approved / settled)
 * belong in the pending-approval queue.
 */
export function isSubmittedAwaitingInvoiceApproval(order, meta = null) {
  if (!isSubmittedOrder(order)) return false;
  if (hasUploadedInvoice(meta)) return false;
  if (meta?.approvedAt) return false;
  if (hasSettledInvoiceStatus(meta)) return false;
  return true;
}

export function shouldShowPendingApprovalActions(order, meta = null, { approvalRequired = false } = {}) {
  if (isPendingForApprovalStatus(meta?.status)) return true;
  if (approvalRequired && !normalizeInvoiceStatus(meta?.status) && !meta?.approvedAt && !hasUploadedInvoice(meta)) {
    return true;
  }
  return isSubmittedAwaitingInvoiceApproval(order, meta);
}

export function shouldAutoMarkPendingApproval({
  approvalRequired = false,
  order = null,
  meta = null,
} = {}) {
  if (meta?.approvedAt) return false;
  if (hasUploadedInvoice(meta)) return false;

  const status = normalizeInvoiceStatus(meta?.status);
  if (isPendingForApprovalStatus(status) && status !== ORDER_STATUS_PENDING_APPROVAL) {
    return true;
  }

  if (isSubmittedAwaitingInvoiceApproval(order, meta)) {
    return !status || status.toLowerCase() === "invoice not uploaded" || isPendingForApprovalStatus(status);
  }

  if (!approvalRequired) return false;
  if (!status) return true;
  return isPendingForApprovalStatus(status) && status !== ORDER_STATUS_PENDING_APPROVAL;
}
