export const OUTSTANDING_DATASET_KEY = "outstanding_customerwise_dataset_v1";

export function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeComparableName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outstandingInvoiceCustomerCode(invoice) {
  const storedCode = normalizeCode(invoice?.customer_code);
  return normalizeCode(extractLeadingCustomerCodeAndName(storedCode).customer_code)
    || (storedCode && !/\s/.test(storedCode) ? storedCode : "")
    || normalizeCode(extractLeadingCustomerCodeAndName(invoice?.customer_name).customer_code);
}

export function resolveOutstandingCustomerOwnership(dataset, salesmanIdentities) {
  const identityNames = new Set(
    (salesmanIdentities || []).map(normalizeComparableName).filter(Boolean)
  );
  const assignedCustomerCodes = new Set();
  const ownedCustomerCodes = new Set();

  (Array.isArray(dataset?.invoices) ? dataset.invoices : []).forEach((invoice) => {
    const salesmanName = normalizeComparableName(invoice?.salesman);
    const customerCode = outstandingInvoiceCustomerCode(invoice);
    if (!salesmanName || !customerCode) return;

    assignedCustomerCodes.add(customerCode);
    if (identityNames.has(salesmanName)) ownedCustomerCodes.add(customerCode);
  });

  return { assignedCustomerCodes, ownedCustomerCodes };
}

export function findOutstandingCustomerCodesForSalesmen(dataset, salesmanIdentities) {
  return [...resolveOutstandingCustomerOwnership(dataset, salesmanIdentities).ownedCustomerCodes];
}

export function customerCodeCandidates(value) {
  const storedCode = normalizeCode(value);
  const extractedCode = normalizeCode(extractLeadingCustomerCodeAndName(storedCode).customer_code);
  return [...new Set([storedCode, extractedCode].filter(Boolean))];
}

export function extractLeadingCustomerCodeAndName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { customer_code: "", customer_name: "" };
  }

  const match = text.match(/^([A-Z0-9]{3,12})\s+(.+)$/i);
  if (!match) {
    return { customer_code: "", customer_name: text };
  }

  return {
    customer_code: String(match[1] || "").trim(),
    customer_name: String(match[2] || "").trim(),
  };
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

export function normalizeOutstandingHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isOutstandingCustomerHeader(value) {
  const header = normalizeOutstandingHeader(value);
  return ["customer", "party", "account", "client", "debtor"].some((label) => header.includes(label));
}

export function isOutstandingAmountHeader(value) {
  const header = normalizeOutstandingHeader(value);
  return header.includes("pending") || header.startsWith("pend") || header.includes("open balance") || header === "balance" || header.includes("outstanding balance") || header.includes("outstanding amount") || header.includes("amount due");
}

export function isOutstandingAgeHeader(value) {
  const header = normalizeOutstandingHeader(value);
  return header.includes("invoice day") || header.includes("overdue day") || header.includes("overdue by") || header === "days" || header === "age" || header === "aging" || header === "ageing" || header.includes("aging days") || header.includes("ageing days");
}

export function combineOutstandingHeaderRows(rows, rowIndex) {
  const current = Array.isArray(rows?.[rowIndex]) ? rows[rowIndex] : [];
  const previous = rowIndex > 0 && Array.isArray(rows?.[rowIndex - 1]) ? rows[rowIndex - 1] : [];
  const width = Math.max(current.length, previous.length);

  return Array.from({ length: width }, (_, columnIndex) => {
    const parts = [previous[columnIndex], current[columnIndex]]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return [...new Set(parts)].join(" ");
  });
}

function rowMatchesOutstandingHeader(row) {
  const hasCustomer = row.some(isOutstandingCustomerHeader);
  const hasBucket = row.some((cell) => Boolean(parseBucketLabelFromHeader(cell)));
  const hasAmount = row.some(isOutstandingAmountHeader);
  return hasCustomer && (hasBucket || hasAmount);
}

export function findOutstandingHeaderRow(rows, maxRows = 50) {
  const limit = Math.min(Array.isArray(rows) ? rows.length : 0, maxRows);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    if (rowMatchesOutstandingHeader(row)) return rowIndex;
    if (rowIndex > 0 && rowMatchesOutstandingHeader(combineOutstandingHeaderRows(rows, rowIndex))) return rowIndex;
  }

  return -1;
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
  const codeNoZeros = code.replace(/^0+/, "");
  const cmpName = normalizeComparableName(customerName);

  if (code) {
    const byCode = rows.find((row) => {
      const rowCode = normalizeCode(row.customer_code);
      if (!rowCode) return false;
      if (rowCode === code) return true;
      return rowCode.replace(/^0+/, "") === codeNoZeros;
    });
    if (byCode) return buildOutstandingRow(byCode);
  }

  if (name) {
    const byName = rows.find((row) => {
      const rowName = normalizeName(row.customer_name);
      if (rowName === name) return true;

      const rowCmp = normalizeComparableName(row.customer_name);
      if (!cmpName || !rowCmp) return false;
      return rowCmp === cmpName || rowCmp.includes(cmpName) || cmpName.includes(rowCmp);
    });
    if (byName) return buildOutstandingRow(byName);
  }

  return null;
}

export function isSameOutstandingCustomer(rowCustomerCode, rowCustomerName, customerCode, customerName) {
  const targetCode = normalizeCode(customerCode);
  const targetName = normalizeName(customerName);
  const targetCodeNoZeros = targetCode.replace(/^0+/, "");
  const targetCmpName = normalizeComparableName(customerName);

  const rowCode = normalizeCode(rowCustomerCode);
  if (targetCode && rowCode) {
    if (rowCode === targetCode) return true;
    if (rowCode.replace(/^0+/, "") === targetCodeNoZeros) return true;
  }

  const rowName = normalizeName(rowCustomerName);
  if (targetName && rowName === targetName) return true;

  const rowCmpName = normalizeComparableName(rowCustomerName);
  if (targetCmpName && rowCmpName) {
    if (rowCmpName === targetCmpName) return true;
    if (rowCmpName.includes(targetCmpName)) return true;
    if (targetCmpName.includes(rowCmpName)) return true;
  }

  return false;
}
