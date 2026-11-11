import { PRICE_CACHE_KEY } from "./priceApiConfig.js";
import { listQueuedPendingOrders } from "./queuedSalesOrders.js";
import {
  DEFAULT_ORDER_QUANTITY_CONTROLS,
  ORDER_QUANTITY_CONTROLS_LOCAL_KEY,
  activeOrderQuantityControls,
  assertOrderQuantityControlsLocal,
  getRiyadhWeekBounds,
  mergeQtyByItemMaps,
  normalizeOrderQuantityControls,
  resolveStoredOrderQuantityControls,
  sumPriorQtyByItemFromLocalOrders,
} from "./orderQuantityControls.js";

export { ORDER_QUANTITY_CONTROLS_LOCAL_KEY };
/**
 * v2 stores qty per order id so re-saves replace instead of accumulate, and
 * delete_draft can release cancelled usage. v1 is intentionally abandoned —
 * its flat per-customer totals kept ghost qty after cancelled drafts (e.g. 1534).
 */
export const ORDER_QUANTITY_USAGE_LOCAL_KEY = "madiba.orderQuantityUsage.v2";
export const ORDER_QUANTITY_USAGE_LEGACY_LOCAL_KEY = "madiba.orderQuantityUsage.v1";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeOrderId(value) {
  return String(value ?? "").trim();
}

function orderIdAliases(orderId) {
  const text = normalizeOrderId(orderId);
  if (!text) return [];
  const aliases = [text];
  if (text.startsWith("pending:")) {
    aliases.push(text.slice("pending:".length));
  } else {
    aliases.push(`pending:${text}`);
  }
  return [...new Set(aliases.filter(Boolean))];
}

function readJsonStorage(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
}

function removeStorageKey(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function persistOrderQuantityControlsLocal(controls) {
  const normalized = normalizeOrderQuantityControls(controls);
  writeJsonStorage(ORDER_QUANTITY_CONTROLS_LOCAL_KEY, {
    controls: normalized,
    savedAt: new Date().toISOString(),
  });
  return normalized;
}

export function readPersistedOrderQuantityControls() {
  const stored = readJsonStorage(ORDER_QUANTITY_CONTROLS_LOCAL_KEY);
  if (stored && typeof stored === "object") {
    return resolveStoredOrderQuantityControls(stored);
  }

  const priceCache = readJsonStorage(PRICE_CACHE_KEY);
  if (priceCache && typeof priceCache === "object" && Object.prototype.hasOwnProperty.call(priceCache, "quantityControls")) {
    return resolveStoredOrderQuantityControls({ controls: priceCache.quantityControls });
  }

  return normalizeOrderQuantityControls(DEFAULT_ORDER_QUANTITY_CONTROLS);
}

function readUsageLedger() {
  // Drop the broken v1 flat ledger so cancelled drafts stop blocking new orders.
  removeStorageKey(ORDER_QUANTITY_USAGE_LEGACY_LOCAL_KEY);
  const stored = readJsonStorage(ORDER_QUANTITY_USAGE_LOCAL_KEY);
  return stored && typeof stored === "object" ? stored : null;
}

function writeUsageLedger(ledger) {
  writeJsonStorage(ORDER_QUANTITY_USAGE_LOCAL_KEY, ledger);
}

function emptyWeekLedger(weekStartIso) {
  return { weekStartIso, byCustomer: {} };
}

function qtyMapFromLines(lines = []) {
  const qtys = {};
  (lines || []).forEach((line) => {
    const code = normalizeCode(line?.item_code || line?.itemCode);
    if (!code) return;
    qtys[code] = Number(qtys[code] || 0) + Number(line?.quantity ?? line?.order_quantity ?? 0);
  });
  return qtys;
}

function customerOrderMap(row) {
  if (!row || typeof row !== "object") return {};
  if (row.byOrder && typeof row.byOrder === "object") {
    return { ...row.byOrder };
  }
  // Ignore accidental flat v1-shaped rows if someone wrote them into v2.
  return {};
}

/**
 * Sum confirmed item qty for one customer this week, optionally excluding an
 * order that is being re-saved / edited.
 */
export function readConfirmedOrderQuantityUsage({
  customerCode,
  weekStartIso = getRiyadhWeekBounds(new Date()).weekStartIso,
  excludeOrderId = null,
} = {}) {
  const customer = normalizeCode(customerCode);
  const ledger = readUsageLedger();
  if (!customer || !ledger || String(ledger.weekStartIso || "") !== String(weekStartIso || "")) {
    return {};
  }
  const byCustomer = ledger.byCustomer && typeof ledger.byCustomer === "object"
    ? ledger.byCustomer
    : {};
  const byOrder = customerOrderMap(byCustomer[customer]);
  const exclude = new Set(orderIdAliases(excludeOrderId));
  const totals = {};
  Object.entries(byOrder).forEach(([orderId, qtys]) => {
    if (exclude.has(normalizeOrderId(orderId))) return;
    Object.entries(qtys || {}).forEach(([code, qty]) => {
      const normalized = normalizeCode(code);
      if (!normalized) return;
      totals[normalized] = Number(totals[normalized] || 0) + Number(qty || 0);
    });
  });
  return totals;
}

/**
 * Upsert one order's item quantities into the device week ledger.
 * Re-saving the same order replaces its previous qty (does not accumulate).
 */
export function recordConfirmedOrderQuantityUsage({
  customerCode,
  lines = [],
  orderId = null,
  weekStartIso = getRiyadhWeekBounds(new Date()).weekStartIso,
} = {}) {
  const customer = normalizeCode(customerCode);
  const qtys = qtyMapFromLines(lines);
  if (!customer || Object.keys(qtys).length === 0) return;

  const current = readUsageLedger();
  const ledger = current && String(current.weekStartIso || "") === String(weekStartIso || "")
    ? {
      weekStartIso,
      byCustomer: { ...(current.byCustomer || {}) },
    }
    : emptyWeekLedger(weekStartIso);

  const byOrder = customerOrderMap(ledger.byCustomer[customer]);
  const resolvedOrderId = normalizeOrderId(orderId) || `anon:${Date.now()}`;

  // Drop pending:/bare aliases for the same order so a sync that learns the
  // server id does not leave a duplicate pending entry behind.
  orderIdAliases(resolvedOrderId).forEach((alias) => {
    if (alias !== resolvedOrderId) delete byOrder[alias];
  });
  byOrder[resolvedOrderId] = qtys;
  ledger.byCustomer[customer] = { byOrder };
  writeUsageLedger(ledger);
}

/** Remove one order from the device week ledger (delete draft / cancel). */
export function releaseConfirmedOrderQuantityUsage({
  customerCode,
  orderId = null,
  weekStartIso = getRiyadhWeekBounds(new Date()).weekStartIso,
} = {}) {
  const customer = normalizeCode(customerCode);
  const aliases = orderIdAliases(orderId);
  if (!customer || aliases.length === 0) return false;

  const current = readUsageLedger();
  if (!current || String(current.weekStartIso || "") !== String(weekStartIso || "")) {
    return false;
  }

  const ledger = {
    weekStartIso,
    byCustomer: { ...(current.byCustomer || {}) },
  };
  const byOrder = customerOrderMap(ledger.byCustomer[customer]);
  let removed = false;
  aliases.forEach((alias) => {
    if (Object.prototype.hasOwnProperty.call(byOrder, alias)) {
      delete byOrder[alias];
      removed = true;
    }
  });
  if (!removed) return false;

  if (Object.keys(byOrder).length === 0) {
    delete ledger.byCustomer[customer];
  } else {
    ledger.byCustomer[customer] = { byOrder };
  }
  writeUsageLedger(ledger);
  return true;
}

function linesFromOrderItems(orderItems = []) {
  return (orderItems || [])
    .map((item) => ({
      item_code: item?.item_code || item?.itemCode || "",
      quantity: Number(item?.order_quantity ?? item?.quantity ?? 0),
    }))
    .filter((line) => normalizeCode(line.item_code) && Number(line.quantity) > 0);
}

/**
 * Offline-safe weekly quantity check: uses cached controls + local queued orders
 * + previously confirmed usage on this device. Never requires a live API call.
 */
export async function assertLocalOrderQuantityControls({
  customerCode,
  orderItems = [],
  lines = null,
  excludeOrderId = null,
  controls = null,
  language = "en",
  referenceDate = new Date(),
} = {}) {
  const resolvedControls = activeOrderQuantityControls(
    Array.isArray(controls) && controls.length > 0
      ? controls
      : readPersistedOrderQuantityControls(),
  );
  if (resolvedControls.length === 0) {
    return { ok: true, violations: [], controls: resolvedControls };
  }

  const checkLines = Array.isArray(lines) ? lines : linesFromOrderItems(orderItems);
  const hasRelevant = checkLines.some((line) => {
    const code = normalizeCode(line?.item_code || line?.itemCode);
    if (!code || !(Number(line?.quantity || 0) > 0)) return false;
    return resolvedControls.some((control) => (
      (control.itemCodes || []).map(normalizeCode).includes(code)
    ));
  });
  if (!hasRelevant) {
    return { ok: true, violations: [], controls: resolvedControls };
  }

  const { weekStartIso, weekEndIso } = getRiyadhWeekBounds(referenceDate);
  const queuedOrders = await listQueuedPendingOrders().catch(() => []);
  const priorFromQueued = sumPriorQtyByItemFromLocalOrders({
    orders: queuedOrders,
    customerCode,
    weekStartIso,
    weekEndIso,
    excludeOrderId,
  });
  const priorFromConfirmed = readConfirmedOrderQuantityUsage({
    customerCode,
    weekStartIso,
    excludeOrderId,
  });
  const priorQtyByItem = mergeQtyByItemMaps(priorFromConfirmed, priorFromQueued);

  const result = assertOrderQuantityControlsLocal({
    lines: checkLines,
    controls: resolvedControls,
    priorQtyByItem,
    language,
  });

  return {
    ...result,
    controls: resolvedControls,
    priorQtyByItem,
    weekStartIso,
    weekEndIso,
  };
}
