import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";
import { isSalesmanOrderNumber } from "./salesmanOrderNumber.js";

const PLACEHOLDER_NUMBERS = new Set(["", "-", "—", "pending", "undefined", "null"]);
export const PENDING_SYNC_ORDER_NUMBER_LABEL = "Pending sync";

export function isPlaceholderSalesOrderNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (PLACEHOLDER_NUMBERS.has(text.toLowerCase())) return true;
  return isQueuedPendingOrderId(text);
}

/**
 * True when order_number is only the bigint row id (legacy accidental fallback).
 * Those must be replaced with a salesman series number (MOI01), never kept.
 */
export function isBareNumericOrderIdFallback(orderNumber, orderId) {
  const numberText = String(orderNumber ?? "").trim();
  const idText = String(orderId ?? "").trim();
  if (!numberText || !idText) return false;
  if (isQueuedPendingOrderId(idText) || isQueuedPendingOrderId(numberText)) return false;
  if (!/^\d+$/.test(numberText) || !/^\d+$/.test(idText)) return false;
  return numberText === idText;
}

/** Real column value only — never invent the row id as the order number. */
export function readStoredSalesOrderNumber(order = {}) {
  const orderNumber = String(order?.order_number || order?.orderNumber || "").trim();
  if (!orderNumber || isPlaceholderSalesOrderNumber(orderNumber)) return "";
  const orderId = order?.id ?? order?.orderId ?? "";
  if (isBareNumericOrderIdFallback(orderNumber, orderId)) return "";
  return orderNumber;
}

/**
 * Prefer a permanent salesman series number. Bare numeric ids matching the row id
 * are treated as missing so callers can allot MOI01 / P01 instead of showing 641.
 */
export function formatSalesOrderNumber(source = {}) {
  const stored = readStoredSalesOrderNumber(source);
  if (stored) return stored;

  // Legacy display-only fallback for very old rows that never got a series number.
  // Do not use this path when allotting/persisting numbers on the server.
  const id = source.id ?? source.orderId ?? "";
  const idStr = String(id).trim();
  if (idStr && !isPlaceholderSalesOrderNumber(idStr) && !isSalesmanOrderNumber(idStr)) {
    return idStr;
  }

  return "";
}

/** Real server number when available; otherwise a safe provisional label for queued local orders. */
export function formatSalesOrderNumberForDisplay(source = {}, {
  pendingLabel = PENDING_SYNC_ORDER_NUMBER_LABEL,
} = {}) {
  const real = formatSalesOrderNumber(source);
  if (real) return real;
  const id = source.id ?? source.orderId ?? "";
  if (isQueuedPendingOrderId(id)) return pendingLabel;
  return "";
}

export function requireSalesOrderNumber(source = {}) {
  const orderNumber = formatSalesOrderNumber(source);
  if (!orderNumber) {
    throw new Error("Order number is required to generate the order PDF.");
  }
  return orderNumber;
}

/** Mandatory PDF header line, e.g. "Order No. 296" or "Order No. PARVEZ-0042". */
export function formatOrderPdfOrderNumberLabel(source = {}) {
  const orderNumber = formatSalesOrderNumberForDisplay(source);
  if (!orderNumber) {
    throw new Error("Order number is required to generate the order PDF.");
  }
  return `Order No. ${orderNumber}`;
}

export function salesOrderNumberNeedsLiveLookup(source = {}) {
  const id = source?.id ?? source?.orderId ?? "";
  // Queued local rows always need a live server number when available.
  if (isQueuedPendingOrderId(String(id))) return true;

  const stored = String(source?.order_number || source?.orderNumber || "").trim();
  // Any non-placeholder stored value (including legacy numeric "503") is enough
  // for PDF/WhatsApp. Bare id-equal repair is a separate Pending Orders action.
  if (stored && !isPlaceholderSalesOrderNumber(stored)) return false;

  return Boolean(String(id).trim());
}

export function orderNeedsSalesmanNumberRepair(order = {}) {
  const id = order?.id ?? order?.orderId ?? "";
  if (!id || isQueuedPendingOrderId(String(id))) return false;
  const stored = String(order?.order_number || order?.orderNumber || "").trim();
  if (!stored || isPlaceholderSalesOrderNumber(stored)) return true;
  return isBareNumericOrderIdFallback(stored, id);
}
