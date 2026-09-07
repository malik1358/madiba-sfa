import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";

export function formatSalesOrderNumber(source = {}) {
  const orderNumber = String(source.order_number || source.orderNumber || "").trim();
  if (orderNumber && !isQueuedPendingOrderId(orderNumber)) return orderNumber;

  const id = source.id ?? source.orderId ?? "";
  const idStr = String(id).trim();
  if (idStr && !isQueuedPendingOrderId(idStr)) return idStr;

  return orderNumber || idStr || "";
}

export function salesOrderNumberNeedsLiveLookup(source = {}) {
  const formatted = formatSalesOrderNumber(source);
  return !formatted || isQueuedPendingOrderId(formatted);
}
