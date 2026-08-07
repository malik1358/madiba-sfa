export const OUTSTANDING_DATASET_KEY = "outstanding_customerwise_dataset_v1";

export function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBucketLabelFromHeader(headerValue) {
  const header = String(headerValue || "").trim().toLowerCase();
  if (!header) return null;

  if (header.includes("open") && header.includes("invoice")) {
    return "open_invoices";
  }

  const rangeMatch = header.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return `${start}-${end}`;
    }
  }

  const greaterMatch = header.match(/^\s*>\s*(\d{1,3})\s*$/i) || header.match(/older\s+than\s+(\d{1,3})/i);
  if (greaterMatch) {
    return `>${Number(greaterMatch[1])}`;
  }

  const plusMatch = header.match(/(\d{1,3})\s*\+\s*$/i);
  if (plusMatch) {
    return `${Number(plusMatch[1])}+`;
  }

  return null;
}

export function isOpenInvoicesLabel(label) {
  return String(label || "").trim().toLowerCase() === "open_invoices";
}

export function bucketSortValue(label) {
  const text = String(label || "").trim();
  if (!text) return Number.MAX_SAFE_INTEGER;
  if (isOpenInvoicesLabel(text)) return Number.MAX_SAFE_INTEGER - 1;

  const rangeMatch = text.match(/^(\d{1,3})-(\d{1,3})$/);
  if (rangeMatch) return Number(rangeMatch[1]);

  const greaterMatch = text.match(/^>(\d{1,3})$/);
  if (greaterMatch) return Number(greaterMatch[1]) + 1;

  const plusMatch = text.match(/^(\d{1,3})\+$/);
  if (plusMatch) return Number(plusMatch[1]);

  return Number.MAX_SAFE_INTEGER;
}

export function sortBucketLabels(labels) {
  return [...new Set((labels || []).filter(Boolean))]
    .sort((a, b) => {
      const av = bucketSortValue(a);
      const bv = bucketSortValue(b);
      if (av !== bv) return av - bv;
      return String(a).localeCompare(String(b));
    });
}

export function buildOutstandingRow(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const buckets = row.buckets && typeof row.buckets === "object" ? row.buckets : {};

  const normalizedBuckets = {};
  Object.entries(buckets).forEach(([label, value]) => {
    if (!label || isOpenInvoicesLabel(label)) return;
    normalizedBuckets[label] = toNumber(value);
  });

  const totalOutstanding = Object.values(normalizedBuckets).reduce((sum, value) => sum + toNumber(value), 0);

  return {
    customer_code: String(row.customer_code || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    open_invoices: toNumber(row.open_invoices),
    buckets: normalizedBuckets,
    total_outstanding: toNumber(row.total_outstanding) || totalOutstanding,
  };
}

export function findOutstandingForCustomer(dataset, customerCode, customerName) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  const code = normalizeCode(customerCode);
  const name = normalizeName(customerName);

  if (code) {
    const byCode = rows.find((row) => normalizeCode(row.customer_code) === code);
    if (byCode) return buildOutstandingRow(byCode);
  }

  if (name) {
    const byName = rows.find((row) => normalizeName(row.customer_name) === name);
    if (byName) return buildOutstandingRow(byName);
  }

  return null;
}
