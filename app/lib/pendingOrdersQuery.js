export const PENDING_ORDER_STATUSES = ["DRAFT", "PENDING", "SUBMITTED"];

export const PENDING_ORDERS_SELECT = "id,order_number,customer_code,customer_name,salesman_code,created_by,created_at,updated_at,status,total_value";

export function filterPendingOrdersForScope(orders, scope) {
  return (orders || []).filter((order) => {
    if (scope?.hasAllAccess) return true;

    const createdByVisible = (scope?.visibleUserIds || []).includes(order.created_by);
    const salesmanVisible = (scope?.visibleSalesmanCodes || []).includes(
      String(order.salesman_code || "").trim().toUpperCase(),
    );

    return createdByVisible || salesmanVisible;
  });
}
