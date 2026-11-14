import { lookupPositiveRate } from "../../../lib/itemCodeAliases.js";

export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

/** Coerce a stale Salesman <select> value back to ALL when it is not in the current result options. */
export function resolveCustomerAuditSalesmanFilter(selectedSalesman, salesmen) {
  if (selectedSalesman === "ALL") return "ALL";
  if ((salesmen || []).includes(selectedSalesman)) return selectedSalesman;
  return "ALL";
}

export function getPrice(priceList, itemCode) {
  return lookupPositiveRate(priceList, itemCode, 0);
}

export function lineTotal(
  priceList,
  itemCode,
  qty
) {
  return (
    getPrice(priceList, itemCode) *
    Number(qty || 0)
  );
}

export function grandTotal(
  orderItems,
  priceList
) {
  return orderItems.reduce(
    (sum, item) =>
      sum +
      lineTotal(
        priceList,
        item.item_code,
        item.order_quantity
      ),
    0
  );
}

export function isDoNotUseItem(name) {
  return /do\s*not\s*use+/i.test(
    String(name || "")
      .trim()
      .toLowerCase()
  );
}
