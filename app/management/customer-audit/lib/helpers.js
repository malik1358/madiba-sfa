export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

export function getPrice(priceList, itemCode) {
  return Number(
    priceList[
      normalizeCode(itemCode)
    ] || 0
  );
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
