import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";

const PLACEHOLDER_NUMBERS = new Set(["", "-", "—", "pending", "undefined", "null"]);

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

export function salesOrderNumberNeedsLiveLookup(source = {}) {
  return isPlaceholderSalesOrderNumber(formatSalesOrderNumber(source));
}
