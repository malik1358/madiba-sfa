import { bucketSortValue } from "./outstanding.js";

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Midpoint day count for an outstanding aging bucket label. */
export function outstandingBucketMidpointDays(label) {
  const text = String(label || "").trim();
  const rangeMatch = text.match(/^(\d{1,3})-(\d{1,3})$/);
  if (rangeMatch) {
    return Math.round((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2);
  }
  const start = bucketSortValue(text);
  if (!Number.isFinite(start) || start >= Number.MAX_SAFE_INTEGER - 10) return null;
  if (/^>/.test(text) || /\+$/.test(text)) return start + 30;
  return start;
}

/**
 * Amount-weighted open-AR aging days for one outstanding customer row.
 * Same fallback idea as WhatsApp when paid FIFO avg days are unavailable.
 */
export function avgPayingDaysFromOutstandingCustomer(row = {}) {
  const buckets = row.buckets && typeof row.buckets === "object" ? row.buckets : null;
  if (buckets) {
    let weighted = 0;
    let total = 0;
    Object.entries(buckets).forEach(([label, value]) => {
      const amount = toNumber(value);
      if (!(amount > 0)) return;
      const mid = outstandingBucketMidpointDays(label);
      if (mid == null) return;
      weighted += mid * amount;
      total += amount;
    });
    if (total > 0) return Math.round(weighted / total);
  }
  const overdue = toNumber(row.overdue_days || row.invoice_day);
  if (overdue > 0) return Math.round(overdue);
  return null;
}

/** Build customer_code → avg paying days from an outstanding dataset. */
export function customerAvgPayingDaysFromOutstandingDataset(dataset = null) {
  const map = new Map();
  const customers = Array.isArray(dataset?.rows)
    ? dataset.rows
    : (Array.isArray(dataset?.customers) ? dataset.customers : []);
  customers.forEach((row) => {
    const code = String(row?.customer_code || "").trim().toUpperCase();
    if (!code) return;
    const days = avgPayingDaysFromOutstandingCustomer(row);
    if (days == null) return;
    map.set(code, days);
  });
  return map;
}
