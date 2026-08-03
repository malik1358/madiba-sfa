export function buildOrderItems(orderQuantities, analytics, quickOrderAllItems) {
  if (!analytics) return [];

  return Object.entries(orderQuantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([itemCode, quantity]) => {
      let item = analytics.items.find((row) => row.item_code === itemCode);

      if (!item) {
        item = quickOrderAllItems.find((row) => row.item_code === itemCode);
      }

      if (!item) return null;

      return { ...item, order_quantity: Number(quantity) };
    })
    .filter(Boolean);
}

export function buildOrderSummary(orderItems) {
  const totalQuantity = orderItems.reduce((sum, item) => sum + Number(item.order_quantity || 0), 0);

  return {
    itemCount: orderItems.length,
    totalQuantity,
  };
}

export function getOrderLineValue(priceList, itemCode, qty) {
  return Number(priceList[String(itemCode).trim().toUpperCase()] || 0) * Number(qty || 0);
}

export function calculateGrandTotal(orderItems, priceList) {
  return orderItems.reduce((sum, item) => sum + getOrderLineValue(priceList, item.item_code, item.order_quantity), 0);
}

export function changeOrderQty(orderQuantities, itemCode, value) {
  if (!itemCode) return orderQuantities;

  let newValue = Number(value || 0);
  if (!Number.isFinite(newValue)) newValue = 0;
  if (newValue < 0) newValue = 0;

  const next = { ...orderQuantities };
  if (newValue <= 0) {
    delete next[itemCode];
  } else {
    next[itemCode] = newValue;
  }

  return next;
}

export function increaseOrderQty(orderQuantities, itemCode) {
  const current = Number(orderQuantities[itemCode] || 0);
  return changeOrderQty(orderQuantities, itemCode, current + 1);
}

export function decreaseOrderQty(orderQuantities, itemCode) {
  const current = Number(orderQuantities[itemCode] || 0);
  return changeOrderQty(orderQuantities, itemCode, Math.max(current - 1, 0));
}
