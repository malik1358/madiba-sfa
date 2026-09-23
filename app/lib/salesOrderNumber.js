import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";

const PLACEHOLDER_NUMBERS = new Set(["", "-", "—", "pending", "undefined", "null"]);
export const PENDING_SYNC_ORDER_NUMBER_LABEL = "Pending sync";

export function isPlaceholderSalesOrderNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (PLACEHOLDER_NUMBERS.has(text.toLowerCase())) return true;
  return isQueuedPendingOrderId(text);
}

export function formatSalesOrderNumber(source = {}) {
  const orderNumber = String(source.order_number || source.orderNumber || "").trim();
  if (orderNumber && !isPlaceholderSalesOrderNumber(orderNumber)) return orderNumber;

  const id = source.id ?? source.orderId ?? "";
  const idStr = String(id).trim();
  if (idStr && !isPlaceholderSalesOrderNumber(idStr)) return idStr;

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

/** Mandatory PDF header line, e.g. "Order No. 296" or "Order No. Pending sync" while queued. */
export function formatOrderPdfOrderNumberLabel(source = {}) {
  const orderNumber = formatSalesOrderNumberForDisplay(source);
  if (!orderNumber) {
    throw new Error("Order number is required to generate the order PDF.");
  }
  return `Order No. ${orderNumber}`;
}

export function salesOrderNumberNeedsLiveLookup(source = {}) {
  return isPlaceholderSalesOrderNumber(formatSalesOrderNumber(source));
}
