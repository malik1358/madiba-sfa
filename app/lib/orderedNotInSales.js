import { addKsaCalendarDays, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const DEFAULT_ORDERED_NOT_IN_SALES_DAYS = 7;
export const MIN_ORDERED_NOT_IN_SALES_DAYS = 1;
export const MAX_ORDERED_NOT_IN_SALES_DAYS = 31;

function money(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function quantity(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

export function normalizeOrderedItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function clampOrderedNotInSalesDays(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_ORDERED_NOT_IN_SALES_DAYS;
  return Math.min(MAX_ORDERED_NOT_IN_SALES_DAYS, Math.max(MIN_ORDERED_NOT_IN_SALES_DAYS, parsed));
}

/** Inclusive KSA calendar window ending today (default last 7 days = today and 6 days back). */
export function resolveOrderedNotInSalesWindow({
  days = DEFAULT_ORDERED_NOT_IN_SALES_DAYS,
  now = new Date(),
  fromDate = "",
  toDate = "",
} = {}) {
  const today = getKsaDateString(now);
  const to = String(toDate || "").trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Invalid to date. Use YYYY-MM-DD.");
  }
  const explicitFrom = String(fromDate || "").trim();
  let from = explicitFrom;
  let dayCount = clampOrderedNotInSalesDays(days);
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      throw new Error("Invalid from date. Use YYYY-MM-DD.");
    }
  } else {
    from = addKsaCalendarDays(to, -(dayCount - 1));
  }
  if (from > to) {
    throw new Error("From date must not be after to date.");
  }
  if (explicitFrom) {
    const fromUtc = Date.UTC(...from.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
    const toUtc = Date.UTC(...to.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
    dayCount = Math.max(1, Math.round((toUtc - fromUtc) / 86400000) + 1);
  }
  const { startIso } = ksaDayBounds(from);
  const { endIso } = ksaDayBounds(to);
  return {
    fromDate: from,
    toDate: to,
    days: dayCount,
    startIso,
    endIso,
  };
}

function orderTimestamp(order) {
  return String(order?.submitted_at || order?.created_at || "").trim();
}

function lineValue(line) {
  const explicit = money(line?.line_value);
  if (explicit) return explicit;
  return money(quantity(line?.quantity) * money(line?.rate));
}

export function normalizeSaleDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

/** Whole KSA calendar days from earlier date to later date (0 when same day). */
export function ksaCalendarDaysBetween(earlierDate, laterDate) {
  const earlier = normalizeSaleDate(earlierDate);
  const later = normalizeSaleDate(laterDate);
  if (!earlier || !later || earlier > later) return null;
  const earlierUtc = Date.UTC(...earlier.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
  const laterUtc = Date.UTC(...later.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
  return Math.round((laterUtc - earlierUtc) / 86400000);
}

export function attachLastSaleFields(rows = [], lastSaleByCode = {}, asOfDate = "") {
  const asOf = normalizeSaleDate(asOfDate) || getKsaDateString();
  return (rows || []).map((row) => {
    const code = normalizeOrderedItemCode(row?.itemCode || row?.item_code);
    const lastSaleDate = normalizeSaleDate(
      lastSaleByCode?.[code]
      ?? lastSaleByCode?.[row?.itemCode]
      ?? row?.lastSaleDate
      ?? "",
    );
    const daysSinceLastSale = lastSaleDate == null || lastSaleDate === ""
      ? null
      : ksaCalendarDaysBetween(lastSaleDate, asOf);
    return {
      ...row,
      lastSaleDate: lastSaleDate || "",
      daysSinceLastSale,
    };
  });
}

/**
 * Aggregate submitted order lines by item, then keep items that never appear in sales codes.
 * @param {{ orderLines?: Array, soldItemCodes?: Iterable<string>, lastSaleByCode?: object, window?: object }} input
 */
export function buildOrderedNotInSalesReport({
  orderLines = [],
  soldItemCodes = [],
  lastSaleByCode = {},
  window = null,
} = {}) {
  const sold = new Set(
    [...(soldItemCodes || [])]
      .map((code) => normalizeOrderedItemCode(code))
      .filter(Boolean),
  );

  const byCode = new Map();
  for (const line of orderLines || []) {
    const itemCode = normalizeOrderedItemCode(line?.item_code || line?.itemCode);
    if (!itemCode) continue;
    const qty = quantity(line?.quantity);
    if (!(qty > 0)) continue;

    const orderId = String(line?.order_id || line?.orderId || "").trim();
    const existing = byCode.get(itemCode);
    if (!existing) {
      byCode.set(itemCode, {
        itemCode,
        itemName: String(line?.item_name || line?.itemName || "").trim() || itemCode,
        category: String(line?.category || "").trim() || "Unclassified",
        orderedQty: qty,
        orderValue: lineValue(line),
        orderIds: new Set(orderId ? [orderId] : []),
        lastOrderedAt: orderTimestamp(line),
      });
      continue;
    }
    existing.orderedQty += qty;
    existing.orderValue = money(existing.orderValue + lineValue(line));
    if (orderId) existing.orderIds.add(orderId);
    const name = String(line?.item_name || line?.itemName || "").trim();
    if (name) existing.itemName = name;
    const category = String(line?.category || "").trim();
    if (category) existing.category = category;
    const stamped = orderTimestamp(line);
    if (stamped && stamped > existing.lastOrderedAt) existing.lastOrderedAt = stamped;
  }

  const rows = [];
  let orderedItemCount = 0;
  let orderedQtyTotal = 0;
  let orderedValueTotal = 0;
  let soldItemCount = 0;

  for (const item of byCode.values()) {
    orderedItemCount += 1;
    orderedQtyTotal += item.orderedQty;
    orderedValueTotal = money(orderedValueTotal + item.orderValue);
    if (sold.has(item.itemCode)) {
      soldItemCount += 1;
      continue;
    }
    rows.push({
      itemCode: item.itemCode,
      itemName: item.itemName,
      category: item.category,
      orderedQty: Math.round(item.orderedQty * 1000) / 1000,
      orderCount: item.orderIds.size,
      orderValue: item.orderValue,
      lastOrderedAt: item.lastOrderedAt || "",
    });
  }

  const enriched = attachLastSaleFields(
    rows,
    lastSaleByCode,
    window?.toDate || "",
  );

  enriched.sort((left, right) => {
    if (right.orderedQty !== left.orderedQty) return right.orderedQty - left.orderedQty;
    return left.itemCode.localeCompare(right.itemCode);
  });

  return {
    window: window || null,
    rows: enriched,
    summary: {
      orderedItems: orderedItemCount,
      soldItems: soldItemCount,
      missingItems: rows.length,
      orderedQty: Math.round(orderedQtyTotal * 1000) / 1000,
      orderedValue: money(orderedValueTotal),
      missingQty: Math.round(enriched.reduce((sum, row) => sum + Number(row.orderedQty || 0), 0) * 1000) / 1000,
      missingValue: money(enriched.reduce((sum, row) => sum + Number(row.orderValue || 0), 0)),
    },
  };
}
