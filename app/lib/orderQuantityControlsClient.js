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
export const ORDER_QUANTITY_USAGE_LOCAL_KEY = "madiba.orderQuantityUsage.v1";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
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
  const stored = readJsonStorage(ORDER_QUANTITY_USAGE_LOCAL_KEY);
  return stored && typeof stored === "object" ? stored : null;
}

function writeUsageLedger(ledger) {
  writeJsonStorage(ORDER_QUANTITY_USAGE_LOCAL_KEY, ledger);
}

export function readConfirmedOrderQuantityUsage({
  customerCode,
  weekStartIso = getRiyadhWeekBounds(new Date()).weekStartIso,
} = {}) {
  const customer = normalizeCode(customerCode);
  const ledger = readUsageLedger();
  if (!customer || !ledger || String(ledger.weekStartIso || "") !== String(weekStartIso || "")) {
    return {};
  }
  const byCustomer = ledger.byCustomer && typeof ledger.byCustomer === "object"
    ? ledger.byCustomer
    : {};
  const row = byCustomer[customer];
  if (!row || typeof row !== "object") return {};
  return Object.fromEntries(
    Object.entries(row).map(([code, qty]) => [normalizeCode(code), Number(qty || 0)]),
  );
}

export function recordConfirmedOrderQuantityUsage({
  customerCode,
  lines = [],
  weekStartIso = getRiyadhWeekBounds(new Date()).weekStartIso,
} = {}) {
  const customer = normalizeCode(customerCode);
  if (!customer) return;

  const current = readUsageLedger();
  const ledger = current && String(current.weekStartIso || "") === String(weekStartIso || "")
    ? {
      weekStartIso,
      byCustomer: { ...(current.byCustomer || {}) },
    }
    : { weekStartIso, byCustomer: {} };

  const existing = { ...(ledger.byCustomer[customer] || {}) };
  (lines || []).forEach((line) => {
    const code = normalizeCode(line?.item_code || line?.itemCode);
    if (!code) return;
    existing[code] = Number(existing[code] || 0) + Number(line?.quantity ?? line?.order_quantity ?? 0);
  });
  ledger.byCustomer[customer] = existing;
  writeUsageLedger(ledger);
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
  const priorFromConfirmed = readConfirmedOrderQuantityUsage({ customerCode, weekStartIso });
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
