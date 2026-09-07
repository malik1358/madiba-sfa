import { listOfflineQueue } from "./offlineSyncQueue.js";

export function buildQueuedPendingOrderId(queueId) {
  return `pending:${String(queueId || "").slice(0, 12)}`;
}

export function isQueuedPendingOrderId(orderId) {
  return String(orderId || "").startsWith("pending:");
}

export function isSalesOrderQueueItem(item) {
  const type = String(item?.metadata?.type || "").trim().toLowerCase();
  if (type === "sales_order") return true;
  return String(item?.url || "").includes("/api/sales-orders");
}

export function queuedSalesOrderToRow(item) {
  const body = item?.jsonBody && typeof item.jsonBody === "object" ? item.jsonBody : {};
  const action = String(item?.metadata?.action || body.action || "submit").toLowerCase();
  const createdAt = new Date(Number(item?.createdAt || Date.now())).toISOString();
  const updatedAt = new Date(Number(item?.updatedAt || item?.createdAt || Date.now())).toISOString();

  return {
    id: buildQueuedPendingOrderId(item?.id),
    customer_code: body.customerCode || item?.metadata?.customerCode || "",
    customer_name: body.customerName || "",
    salesman_code: String(body.salesmanCode || "").trim().toUpperCase(),
    created_by: null,
    created_at: createdAt,
    updated_at: updatedAt,
    status: action.includes("draft") ? "DRAFT" : "SUBMITTED",
    queuedLocally: true,
    syncStatus: item?.status || "pending",
    lastError: String(item?.lastError || "").trim(),
    queueId: item?.id || "",
    queuedLines: Array.isArray(body.lines) ? body.lines : [],
  };
}

export async function listQueuedPendingOrders() {
  const [pending, failed] = await Promise.all([
    listOfflineQueue("pending"),
    listOfflineQueue("failed"),
  ]);

  return [...pending, ...failed]
    .filter(isSalesOrderQueueItem)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .map(queuedSalesOrderToRow);
}

export function mergeServerAndQueuedOrders(serverOrders = [], queuedOrders = []) {
  const merged = [...(queuedOrders || [])];
  const seen = new Set(merged.map((row) => String(row.id)));

  (serverOrders || []).forEach((order) => {
    const id = String(order?.id || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(order);
  });

  return merged.sort((left, right) => (
    new Date(right.updated_at || right.created_at || 0).getTime()
    - new Date(left.updated_at || left.created_at || 0).getTime()
  ));
}
