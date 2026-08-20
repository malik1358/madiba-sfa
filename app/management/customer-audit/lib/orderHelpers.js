import { isDoNotUseItem, normalizeCode } from './helpers';

function hasMeaningfulValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return !['UNCLASSIFIED', 'TO_MAP', 'TBD', 'TODO', 'N/A', 'NA', '-'].includes(text.toUpperCase());
}

function hasCurrentItemName(value, itemCode) {
  const text = String(value || '').trim();
  return Boolean(text) && normalizeCode(text) !== normalizeCode(itemCode) && !isDoNotUseItem(text);
}

export function buildOrderCatalog(itemCatalog, priceSheetItems = [], priceList = {}) {
  const itemMap = new Map();

  (itemCatalog || []).forEach((item) => {
    const code = normalizeCode(item?.item_code);
    if (!code) return;
    itemMap.set(code, {
      ...item,
      item_code: code,
      item_name: String(item.item_name || code).trim(),
      category: String(item.category || 'Unclassified').trim() || 'Unclassified',
    });
  });

  (priceSheetItems || []).forEach((sheetItem) => {
    const code = normalizeCode(sheetItem?.item_code);
    if (!code) return;
    const existing = itemMap.get(code);
    const sheetName = String(sheetItem.item_name || '').trim();
    const sheetCategory = String(sheetItem.category || '').trim();

    itemMap.set(code, {
      ...(existing || {}),
      item_code: code,
      item_name: hasCurrentItemName(sheetName, code)
        ? sheetName
        : (hasCurrentItemName(existing?.item_name, code) ? existing.item_name : code),
      category: hasMeaningfulValue(sheetCategory)
        ? sheetCategory
        : (hasMeaningfulValue(existing?.category) ? existing.category : 'Missing Category'),
    });
  });

  Object.keys(priceList || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code || itemMap.has(code)) return;
    itemMap.set(code, {
      item_code: code,
      item_name: code,
      category: 'Missing Category',
    });
  });

  return Array.from(itemMap.values())
    .filter((item) => !isDoNotUseItem(item.item_name))
    .sort((left, right) => String(left.item_name || left.item_code).localeCompare(String(right.item_name || right.item_code)));
}

function addItemsToLookup(itemLookup, rows) {
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = normalizeCode(row?.item_code);
    if (!code || itemLookup.has(code)) return;
    itemLookup.set(code, row);
  });
}

export function buildOrderItems(orderQuantities, analytics, quickOrderAllItems, catalogItems = []) {
  const itemLookup = new Map();

  // Prefer current catalog names over historical transaction names.
  addItemsToLookup(itemLookup, catalogItems);
  addItemsToLookup(itemLookup, quickOrderAllItems);
  addItemsToLookup(itemLookup, analytics?.items);

  if (itemLookup.size === 0) return [];

  return Object.entries(orderQuantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([itemCode, quantity]) => {
      const code = normalizeCode(itemCode);
      const item = itemLookup.get(code);

      if (!item || isDoNotUseItem(item.item_name)) return null;

      return { ...item, item_code: code, order_quantity: Number(quantity) };
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
