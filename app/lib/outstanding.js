import { salesmanValueMatchesScope } from "./mutualSalesmanGroups.js";

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

function isProspectCustomerCode(value) {
  return /^PROSPECT-\d+$/i.test(String(value || "").trim());
}

function outstandingInvoiceCustomerCode(invoice) {
  const storedCode = normalizeCode(invoice?.customer_code);
  return normalizeCode(extractLeadingCustomerCodeAndName(storedCode).customer_code)
    || (storedCode && !/\s/.test(storedCode) ? storedCode : "")
    || normalizeCode(extractLeadingCustomerCodeAndName(invoice?.customer_name).customer_code);
}

export function resolveOutstandingInvoiceCustomerCode(invoice) {
  return outstandingInvoiceCustomerCode(invoice);
}

export function repairOutstandingInvoice(invoice) {
  const code = resolveOutstandingInvoiceCustomerCode(invoice);
  const codeField = normalizeCode(invoice?.customer_code);
  const nameField = String(invoice?.customer_name || "").trim();
  const combinedCandidates = [...new Set([
    nameField,
    codeField && nameField && !nameField.toUpperCase().startsWith(`${codeField} `)
      ? `${codeField} ${nameField}`.trim()
      : "",
    String(invoice?.customer_code || "").trim(),
  ].filter(Boolean))];

  let resolvedCode = code || codeField;
  let resolvedName = nameField;

  combinedCandidates.forEach((combined) => {
    const extracted = extractLeadingCustomerCodeAndName(combined);
    if (extracted.customer_code && !resolvedCode) {
      resolvedCode = normalizeCode(extracted.customer_code);
    }
    resolvedName = pickLongestCustomerName(resolvedName, extracted.customer_name, combined);
  });

  return {
    ...invoice,
    customer_code: resolvedCode || normalizeCode(invoice?.customer_code),
    customer_name: resolvedName || codeField || "",
  };
}

export function synthesizeInvoicesFromOutstandingRows(rows, invoices = []) {
  const existingCodes = new Set(
    (invoices || []).map((invoice) => resolveOutstandingInvoiceCustomerCode(invoice)).filter(Boolean),
  );
  const synthetic = [];

  (rows || []).forEach((rawRow) => {
    const row = buildOutstandingRow(rawRow);
    const code = resolveOutstandingInvoiceCustomerCode({
      customer_code: row.customer_code,
      customer_name: row.customer_name,
    });
    if (!code || existingCodes.has(code)) return;

    const bucketEntries = Object.entries(row.buckets || {}).filter(([, value]) => toNumber(value) > 0);
    const bucketTotal = bucketEntries.reduce((sum, [, value]) => sum + toNumber(value), 0);
    const pendingAmount = toNumber(row.total_outstanding) || bucketTotal;
    if (pendingAmount <= 0) return;

    let overdueDays = 0;
    bucketEntries.forEach(([label, value]) => {
      if (toNumber(value) <= 0) return;
      const startDay = bucketSortValue(label);
      if (startDay > overdueDays && startDay < Number.MAX_SAFE_INTEGER - 10) {
        overdueDays = startDay;
      }
    });

    existingCodes.add(code);
    synthetic.push({
      customer_code: code,
      customer_name: row.customer_name || code,
      pending_amount: pendingAmount,
      ref_no: "",
      due_date: "",
      overdue_days: overdueDays || 30,
      invoice_day: overdueDays || 30,
      salesman: String(rawRow?.salesman || "").trim(),
    });
  });

  return synthetic;
}

export function hydrateOutstandingInvoices(dataset) {
  const repaired = applyOutstandingRowSalesman(
    (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
      .map(repairOutstandingInvoice)
      .filter((invoice) => resolveOutstandingInvoiceCustomerCode(invoice)),
    dataset?.rows,
  );
  const synthesized = synthesizeInvoicesFromOutstandingRows(dataset?.rows, repaired);
  return applyOutstandingRowSalesman([...repaired, ...synthesized], dataset?.rows);
}

export function mergeOutstandingInvoiceSources(primary, supplemental) {
  const primaryCodes = new Set(
    (primary || []).map((invoice) => resolveOutstandingInvoiceCustomerCode(invoice)).filter(Boolean),
  );
  const merged = [...(primary || [])];

  (supplemental || []).forEach((invoice) => {
    const code = resolveOutstandingInvoiceCustomerCode(invoice);
    if (!code || primaryCodes.has(code)) return;
    primaryCodes.add(code);
    merged.push(repairOutstandingInvoice(invoice));
  });

  return merged;
}

function invoiceOwnedByScope(invoice, identityNames, scopeMatchers) {
  const salesman = invoice?.salesman;
  if (!String(salesman || "").trim()) return false;
  if (scopeMatchers) return salesmanValueMatchesScope(salesman, scopeMatchers);

  const salesmanName = normalizeComparableName(salesman);
  return Boolean(salesmanName && identityNames.has(salesmanName));
}

function rowSalesmanOwnedByScope(rowSalesman, identityNames, scopeMatchers) {
  if (!String(rowSalesman || "").trim() || isPlaceholderSalesmanValue(rowSalesman)) return false;
  if (scopeMatchers) return salesmanValueMatchesScope(rowSalesman, scopeMatchers);

  const salesmanName = normalizeComparableName(rowSalesman);
  return Boolean(salesmanName && identityNames.has(salesmanName));
}

export function resolveOutstandingCustomerOwnership(dataset, salesmanIdentities, scopeMatchers = null) {
  const identityNames = new Set(
    (salesmanIdentities || []).map(normalizeComparableName).filter(Boolean)
  );
  const assignedCustomerCodes = new Set();
  const ownedCustomerCodes = new Set();

  hydrateOutstandingInvoices(dataset).forEach((invoice) => {
    const customerCode = outstandingInvoiceCustomerCode(invoice);
    const salesmanName = normalizeComparableName(invoice?.salesman);
    if (!customerCode) return;

    if (salesmanName) {
      assignedCustomerCodes.add(customerCode);
      if (invoiceOwnedByScope(invoice, identityNames, scopeMatchers)) {
        ownedCustomerCodes.add(customerCode);
      }
    }
  });

  (Array.isArray(dataset?.rows) ? dataset.rows : []).forEach((rawRow) => {
    const row = buildOutstandingRow(rawRow);
    const customerCode = resolveOutstandingInvoiceCustomerCode({
      customer_code: row.customer_code,
      customer_name: row.customer_name,
    });
    const aggregateSalesman = row.salesman;
    if (!customerCode || !aggregateSalesman || isPlaceholderSalesmanValue(aggregateSalesman)) return;

    assignedCustomerCodes.add(customerCode);
    if (rowSalesmanOwnedByScope(aggregateSalesman, identityNames, scopeMatchers)) {
      ownedCustomerCodes.add(customerCode);
    }
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

export function resolveCustomerAccountCode(value) {
  const raw = normalizeCode(value);
  if (!raw) return "";

  const numericPrefix = raw.match(/^(\d{3,6}[A-Z]?)[-\s]/);
  if (numericPrefix) return numericPrefix[1];

  const extracted = normalizeCode(extractLeadingCustomerCodeAndName(raw).customer_code);
  return extracted || raw.split(/\s+/)[0] || raw;
}

export function customerAccountCodesMatch(left, right) {
  const leftCode = resolveCustomerAccountCode(left);
  const rightCode = resolveCustomerAccountCode(right);
  if (!leftCode || !rightCode) return false;
  if (leftCode === rightCode) return true;

  const leftCandidates = new Set(
    customerCodeCandidates(left).map((candidate) => resolveCustomerAccountCode(candidate)).filter(Boolean),
  );
  const leftVariants = new Set([leftCode, ...leftCandidates]);
  const rightCandidates = new Set(
    customerCodeCandidates(right).map((candidate) => resolveCustomerAccountCode(candidate)).filter(Boolean),
  );
  const rightVariants = new Set([rightCode, ...rightCandidates]);

  for (const leftVariant of leftVariants) {
    if (rightVariants.has(leftVariant)) return true;
  }

  for (const leftVariant of leftVariants) {
    for (const rightVariant of rightVariants) {
      if (leftVariant === rightVariant) return true;

      const shorter = leftVariant.length <= rightVariant.length ? leftVariant : rightVariant;
      const longer = leftVariant.length > rightVariant.length ? leftVariant : rightVariant;
      if (!longer.startsWith(shorter)) continue;

      const suffix = longer.slice(shorter.length);
      if (/^\d{3,6}$/.test(shorter) && /^[A-Z]$/.test(suffix)) return true;
    }
  }

  return false;
}

export function customerMatchesOutstandingCodeSet(customerCode, codeSet) {
  if (!codeSet || codeSet.size === 0) return false;

  const candidates = customerCodeCandidates(customerCode);
  for (const candidate of candidates) {
    for (const ownedCode of codeSet) {
      if (customerAccountCodesMatch(candidate, ownedCode)) return true;
    }
  }

  return false;
}

function leadingTokenLooksLikeCustomerCode(token) {
  const word = String(token || "").trim();
  if (!word) return false;
  if (/^PROSPECT-\d+$/i.test(word)) return true;
  return /\d/.test(word);
}

export function extractLeadingCustomerCodeAndName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { customer_code: "", customer_name: "" };
  }

  const match = text.match(/^([A-Z0-9-]{3,20})\s+(.+)$/i);
  if (!match || !leadingTokenLooksLikeCustomerCode(match[1])) {
    return { customer_code: "", customer_name: text };
  }

  return {
    customer_code: String(match[1] || "").trim(),
    customer_name: String(match[2] || "").trim(),
  };
}

export function pickLongestCustomerName(...candidates) {
  const names = [...new Set(
    candidates.map((value) => String(value || "").trim()).filter(Boolean),
  )];
  if (names.length === 0) return "";
  return names.sort((left, right) => right.length - left.length)[0];
}

export function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

const EXCEL_SERIAL_MIN = 10000;
const MAX_PLAUSIBLE_AGING_DAYS = 999;

const MONTH_NAME_INDEX = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

function utcDateString(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utc.getTime())) return "";
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return "";
  }
  return utc.toISOString().slice(0, 10);
}

export function excelSerialToIsoDate(value) {
  const serial = toNumber(value);
  if (!isExcelSerialDayValue(serial)) return "";
  // Excel 1900 date system: serial 25569 is 1970-01-01 (includes the fake leap day).
  const utc = new Date(Math.round((Math.floor(serial) - 25569) * 86400 * 1000));
  if (Number.isNaN(utc.getTime())) return "";
  const year = utc.getUTCFullYear();
  if (year < 1990 || year > 2100) return "";
  return utc.toISOString().slice(0, 10);
}

export function formatSheetDateValue(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "number") {
    return excelSerialToIsoDate(value);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return utcDateString(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  return parseOutstandingSheetDate(value);
}

export function parseOutstandingSheetDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return utcDateString(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const monthNameMatch = text.match(/^(\d{1,2})[\/\-\s.]+([A-Za-z]{3,9})[\/\-\s.,]+(\d{2,4})$/);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = MONTH_NAME_INDEX[monthNameMatch[2].toUpperCase()] || 0;
    let year = Number(monthNameMatch[3]);
    if (year < 100) year += 2000;
    const parsed = utcDateString(year, month, day);
    if (parsed) return parsed;
  }

  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    let year = Number(dmyMatch[3]);
    if (year < 100) year += 2000;
    const parsed = utcDateString(year, month, day);
    if (parsed) return parsed;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function dateOnlyFromIso(value) {
  return parseOutstandingSheetDate(value);
}

function daysBetweenDates(laterIso, earlierIso) {
  const later = new Date(`${dateOnlyFromIso(laterIso)}T00:00:00`);
  const earlier = new Date(`${dateOnlyFromIso(earlierIso)}T00:00:00`);
  if (Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) return 0;
  return Math.max(0, Math.floor((later - earlier) / (24 * 60 * 60 * 1000)));
}

export function isPlausibleAgingDayCount(value) {
  const days = toNumber(value);
  return days > 0 && days <= MAX_PLAUSIBLE_AGING_DAYS;
}

export function isExcelSerialDayValue(value) {
  return toNumber(value) >= EXCEL_SERIAL_MIN;
}

export function resolveInvoiceAgingDays(invoice, todayIso = new Date().toISOString()) {
  const invoiceDay = toNumber(invoice?.invoice_day);
  if (isPlausibleAgingDayCount(invoiceDay)) return invoiceDay;

  const rawOverdue = toNumber(invoice?.overdue_days);
  if (isPlausibleAgingDayCount(rawOverdue)) return rawOverdue;

  const dueDate = dateOnlyFromIso(invoice?.due_date);
  if (dueDate) {
    return daysBetweenDates(todayIso, dueDate);
  }

  return 0;
}

export function resolveInvoiceDays(invoice, todayIso = new Date().toISOString()) {
  const invoiceDay = toNumber(invoice?.invoice_day);
  if (isPlausibleAgingDayCount(invoiceDay)) return invoiceDay;

  const invoiceDate = dateOnlyFromIso(invoice?.invoice_date);
  if (invoiceDate) {
    return daysBetweenDates(todayIso, invoiceDate);
  }

  return 0;
}

export function bucketLabelForAgingDays(dayValue) {
  const day = toNumber(dayValue);
  if (!Number.isFinite(day) || day <= 0) return "0-30";
  if (day <= 30) return "0-30";
  if (day <= 60) return "31-60";
  if (day <= 90) return "61-90";
  if (day <= 120) return "91-120";
  return ">120";
}

export function mapOutstandingBucketsToCollectionFields(buckets) {
  const outstanding = {
    outstanding_0_30: 0,
    outstanding_30_60: 0,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  };

  Object.entries(buckets || {}).forEach(([label, value]) => {
    const amount = toNumber(value);
    if (amount <= 0 || isOpenInvoicesLabel(label)) return;

    const startDay = bucketSortValue(label);
    if (startDay <= 30) outstanding.outstanding_0_30 += amount;
    else if (startDay <= 60) outstanding.outstanding_30_60 += amount;
    else if (startDay <= 90) outstanding.outstanding_61_90 += amount;
    else if (startDay <= 120) outstanding.outstanding_91_120 += amount;
    else outstanding.outstanding_above_120 += amount;
  });

  return outstanding;
}

export function buildCollectionOutstandingBucketsFromInvoices(invoices, todayIso = new Date().toISOString()) {
  const outstanding = {
    outstanding_cash: 0,
    outstanding_0_30: 0,
    outstanding_30_60: 0,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
  };

  (invoices || []).forEach((invoice) => {
    const pendingAmount = toNumber(invoice?.pending_amount);
    if (pendingAmount <= 0) return;

    const bucketLabel = bucketLabelForAgingDays(resolveInvoiceAgingDays(invoice, todayIso));
    if (bucketLabel === "0-30") outstanding.outstanding_0_30 += pendingAmount;
    else if (bucketLabel === "31-60") outstanding.outstanding_30_60 += pendingAmount;
    else if (bucketLabel === "61-90") outstanding.outstanding_61_90 += pendingAmount;
    else if (bucketLabel === "91-120") outstanding.outstanding_91_120 += pendingAmount;
    else outstanding.outstanding_above_120 += pendingAmount;
  });

  return outstanding;
}

export function resolveCollectionOutstandingBuckets({
  rowBuckets,
  invoices,
  todayIso = new Date().toISOString(),
}) {
  const hasRowBuckets = Object.values(rowBuckets || {}).some((value) => toNumber(value) > 0);
  if (hasRowBuckets) {
    return {
      outstanding_cash: 0,
      ...mapOutstandingBucketsToCollectionFields(rowBuckets),
    };
  }

  return buildCollectionOutstandingBucketsFromInvoices(invoices, todayIso);
}

export function resolveOverdueDaysFromDueDate(invoice, todayIso = new Date().toISOString()) {
  const dueDate = dateOnlyFromIso(invoice?.due_date);
  if (dueDate) {
    return daysBetweenDates(todayIso, dueDate);
  }

  const rawOverdue = toNumber(invoice?.overdue_days);
  if (isPlausibleAgingDayCount(rawOverdue)) return rawOverdue;
  return 0;
}

export function sanitizeStoredOverdueDays(rawValue, invoiceDay = 0) {
  if (isExcelSerialDayValue(rawValue)) return 0;
  const overdue = toNumber(rawValue);
  if (isPlausibleAgingDayCount(overdue)) return overdue;
  if (isPlausibleAgingDayCount(invoiceDay)) return 0;
  return 0;
}

export function sanitizeStoredInvoiceDays(rawValue) {
  if (isExcelSerialDayValue(rawValue)) return 0;
  const days = toNumber(rawValue);
  if (days === 0 || isPlausibleAgingDayCount(days)) return days;
  return 0;
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
    .replace(/[''\u2018\u2019\u201a\u2032`´]/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isOutstandingCustomerHeader(value) {
  const header = normalizeOutstandingHeader(value);
  return ["customer", "party", "account", "client", "debtor"].some((label) => header.includes(label));
}

export function isOutstandingAmountHeader(value) {
  const header = normalizeOutstandingHeader(value);
  if (!header) return false;
  if (header.includes("pending bills")) return false;
  if (header.includes(" date")) return false;
  if (header === "pending" || header === "pend") return true;
  return header.startsWith("pending amount")
    || header.startsWith("pend ")
    || header.includes("open balance")
    || header === "balance"
    || header.includes("outstanding balance")
    || header.includes("outstanding amount")
    || header.includes("amount due");
}

const PLACEHOLDER_SALESMAN_VALUES = new Set([
  "NOT ADDED IN VOUCHER",
  "N/A",
  "NA",
  "UNASSIGNED",
  "NONE",
  "-",
  "--",
]);

export function isPlaceholderSalesmanValue(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return PLACEHOLDER_SALESMAN_VALUES.has(text.toUpperCase());
}

function outstandingSalesmanColumnPriority(headerValue) {
  const header = normalizeOutstandingHeader(headerValue);
  if (!header) return 0;
  if (header === "salesman") return 4;
  if (header.includes("salesman")) return 3;
  if (header.includes("salesperson")) return 2;
  if (header.includes("sales person")) return 1;
  return 0;
}

export function detectOutstandingSalesmanColumn(headerRow) {
  let bestIndex = -1;
  let bestPriority = 0;

  (headerRow || []).forEach((cell, idx) => {
    const priority = outstandingSalesmanColumnPriority(cell);
    if (priority > bestPriority || (priority === bestPriority && priority > 0 && idx > bestIndex)) {
      bestPriority = priority;
      bestIndex = idx;
    }
  });

  return bestIndex;
}

export function pickOutstandingSalesmanName(invoices) {
  const counts = new Map();

  (invoices || []).forEach((invoice) => {
    const name = String(invoice?.salesman || "").trim();
    if (isPlaceholderSalesmanValue(name)) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  let bestName = "";
  let bestCount = 0;

  counts.forEach((count, name) => {
    if (count > bestCount) {
      bestCount = count;
      bestName = name;
    }
  });

  return bestName;
}

export function buildOutstandingRowSalesmanByCode(rows) {
  const grouped = new Map();

  (rows || []).forEach((row) => {
    const code = resolveOutstandingInvoiceCustomerCode(row);
    if (!code) return;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push({ salesman: row?.salesman });
  });

  const result = new Map();
  grouped.forEach((invoices, code) => {
    const name = pickOutstandingSalesmanName(invoices);
    if (name) result.set(code, name);
  });

  return result;
}

export function applyOutstandingRowSalesman(invoices, rows) {
  const rowSalesmanByCode = buildOutstandingRowSalesmanByCode(rows);

  return (invoices || []).map((invoice) => {
    if (!isPlaceholderSalesmanValue(invoice?.salesman)) return invoice;

    const code = resolveOutstandingInvoiceCustomerCode(invoice);
    const fallback = code ? rowSalesmanByCode.get(code) : "";
    if (!fallback) return invoice;

    return { ...invoice, salesman: fallback };
  });
}

export function detectOutstandingPendingAmountColumn(headerRow) {
  const exactIdx = (headerRow || []).findIndex((cell) => {
    const normalized = normalizeOutstandingHeader(cell);
    return normalized === "pending"
      || normalized === "pending amount"
      || normalized === "open balance"
      || normalized === "balance";
  });
  if (exactIdx >= 0) return exactIdx;

  return (headerRow || []).findIndex((cell) => isOutstandingAmountHeader(cell));
}

export function isOutstandingAgeHeader(value) {
  const header = normalizeOutstandingHeader(value);
  return header.includes("invoice day") || header.includes("overdue day") || header.includes("overdue by") || header === "days" || header === "age" || header === "aging" || header === "ageing" || header.includes("aging days") || header.includes("ageing days");
}

export function isOutstandingInvoiceDayHeader(value) {
  const header = normalizeOutstandingHeader(value);
  if (!header || header.includes("date")) return false;
  return header.includes("invoice day")
    || header === "invoice da"
    || header.startsWith("invoice da ");
}

export function outstandingDueDateColumnScore(value) {
  const header = normalizeOutstandingHeader(value);
  if (!header) return 0;
  if (header.includes("overdue") || header.includes("overd")) return 0;
  if (header === "due" || header === "due on" || header === "due date" || header === "dueon") return 3;
  if (header.includes("due date") || header.includes("due on")) return 2;
  if (header.startsWith("due ") || header.endsWith(" due")) return 1;
  return 0;
}

export function findOutstandingDueDateColumn(headerRow) {
  let bestIndex = -1;
  let bestScore = 0;

  (headerRow || []).forEach((cell, idx) => {
    const score = outstandingDueDateColumnScore(cell);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  return bestIndex;
}

export function findOutstandingInvoiceDayColumn(headerRow, overdueDaysIndex, salesmanIndex) {
  const explicitIndex = (headerRow || []).findIndex(isOutstandingInvoiceDayHeader);
  if (explicitIndex >= 0 && explicitIndex !== overdueDaysIndex) return explicitIndex;

  if (overdueDaysIndex >= 0) {
    const nextIndex = overdueDaysIndex + 1;
    if (nextIndex === salesmanIndex) return -1;
    if (String(headerRow?.[nextIndex] || "").trim()) return nextIndex;
  }

  return -1;
}

export function detectOutstandingColumnIndexes(headerRow) {
  const indexes = {
    customerCode: -1,
    customerName: -1,
    openInvoices: -1,
    pendingAmount: -1,
    date: -1,
    refNo: -1,
    dueDate: -1,
    overdueDays: -1,
    invoiceDay: -1,
    salesman: -1,
    buckets: [],
  };

  const codeAliases = ["customer code", "customer_code", "cust code", "customer no", "account code", "code"];
  const nameAliases = ["customer name", "customer", "party name", "party's name", "partys name", "name", "account name"];

  (headerRow || []).forEach((cell, idx) => {
    const text = String(cell || "").trim();
    const normalized = normalizeOutstandingHeader(text);

    if (indexes.customerCode < 0 && codeAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerCode = idx;
    }

    if (indexes.customerName < 0 && nameAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerName = idx;
    }

    if (indexes.date < 0 && (normalized === "date" || normalized.startsWith("date "))) {
      indexes.date = idx;
    }

    if (indexes.refNo < 0 && (normalized.includes("ref") || normalized.includes("invoice no") || normalized.includes("voucher"))) {
      indexes.refNo = idx;
    }

    if (indexes.overdueDays < 0 && (normalized.includes("overd") || normalized.startsWith("overa"))) {
      indexes.overdueDays = idx;
    }

    const bucketLabel = parseBucketLabelFromHeader(text);
    if (!bucketLabel) return;

    if (bucketLabel === "open_invoices") {
      indexes.openInvoices = idx;
      return;
    }

    indexes.buckets.push({ idx, label: bucketLabel });
  });

  indexes.dueDate = findOutstandingDueDateColumn(headerRow);
  indexes.salesman = detectOutstandingSalesmanColumn(headerRow);
  indexes.invoiceDay = findOutstandingInvoiceDayColumn(
    headerRow,
    indexes.overdueDays,
    indexes.salesman,
  );
  indexes.pendingAmount = detectOutstandingPendingAmountColumn(headerRow);

  return indexes;
}

export function parseOutstandingRows(rows, headerRowIndex) {
  const headerRow = combineOutstandingHeaderRows(rows, headerRowIndex);
  const columns = detectOutstandingColumnIndexes(headerRow);
  const ageColumnIndex = columns.invoiceDay >= 0 ? columns.invoiceDay : columns.overdueDays;

  const hasInvoiceDayLayout = columns.pendingAmount >= 0 && ageColumnIndex >= 0;

  if (!hasInvoiceDayLayout && columns.buckets.length === 0 && columns.openInvoices < 0) {
    throw new Error("Could not detect bucket columns or open invoices column in uploaded file.");
  }

  const aggregate = new Map();
  const invoices = [];
  const bucketLabels = hasInvoiceDayLayout
    ? ["0-30", "31-60", "61-90", "91-120", ">120"]
    : sortBucketLabels(columns.buckets.map((bucket) => bucket.label));

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const rawCustomerCode = columns.customerCode >= 0 ? String(row[columns.customerCode] || "").trim() : "";
    const rawCustomerName = columns.customerName >= 0 ? String(row[columns.customerName] || "").trim() : "";
    const extractedCode = extractLeadingCustomerCodeAndName(rawCustomerCode);
    const extractedName = extractLeadingCustomerCodeAndName(rawCustomerName);
    const customerCode = extractedCode.customer_code || rawCustomerCode || extractedName.customer_code;
    const customerName = extractedName.customer_name || extractedCode.customer_name || rawCustomerName;

    if (!customerCode && !customerName) continue;

    const rowBuckets = {};
    let hasAnyValue = false;
    const invoiceDayValue = ageColumnIndex >= 0 ? sanitizeStoredInvoiceDays(row[ageColumnIndex]) : 0;

    if (hasInvoiceDayLayout) {
      const pendingValue = toNumber(row[columns.pendingAmount]);
      const dayBucket = bucketLabelForAgingDays(invoiceDayValue);
      bucketLabels.forEach((label) => {
        rowBuckets[label] = label === dayBucket ? pendingValue : 0;
      });
      hasAnyValue = pendingValue !== 0;
    } else {
      columns.buckets.forEach((bucket) => {
        const value = toNumber(row[bucket.idx]);
        rowBuckets[bucket.label] = value;
        if (value !== 0) hasAnyValue = true;
      });
    }

    const openInvoices = hasInvoiceDayLayout
      ? (toNumber(row[columns.pendingAmount]) > 0 ? 1 : 0)
      : (columns.openInvoices >= 0 ? toNumber(row[columns.openInvoices]) : 0);
    if (openInvoices !== 0) hasAnyValue = true;

    if (!hasAnyValue) continue;

    const key = normalizeCode(customerCode) || normalizeName(customerName);
    if (!key) continue;

    const current = aggregate.get(key) || {
      customer_code: customerCode,
      customer_name: customerName,
      open_invoices: 0,
      buckets: {},
    };

    if (!current.customer_code && customerCode) current.customer_code = customerCode;
    if (!current.customer_name && customerName) current.customer_name = customerName;

    current.open_invoices += openInvoices;
    bucketLabels.forEach((label) => {
      current.buckets[label] = toNumber(current.buckets[label]) + toNumber(rowBuckets[label]);
    });

    if (columns.salesman >= 0) {
      const rowSalesman = String(row[columns.salesman] || "").trim();
      if (rowSalesman && !isPlaceholderSalesmanValue(rowSalesman)) {
        current.salesman = pickOutstandingSalesmanName([
          ...(current.salesman ? [{ salesman: current.salesman }] : []),
          { salesman: rowSalesman },
        ]);
      }
    }

    aggregate.set(key, current);

    const pendingAmount = columns.pendingAmount >= 0
      ? toNumber(row[columns.pendingAmount])
      : Object.values(rowBuckets).reduce((sum, value) => sum + toNumber(value), 0);
    if (pendingAmount > 0) {
      invoices.push({
        customer_code: customerCode,
        customer_name: customerName,
        invoice_date: columns.date >= 0 ? formatSheetDateValue(row[columns.date]) : "",
        ref_no: columns.refNo >= 0 ? String(row[columns.refNo] || "").trim() : "",
        pending_amount: pendingAmount,
        due_date: columns.dueDate >= 0 ? formatSheetDateValue(row[columns.dueDate]) : "",
        overdue_days: columns.overdueDays >= 0
          ? sanitizeStoredOverdueDays(row[columns.overdueDays], invoiceDayValue)
          : 0,
        invoice_day: invoiceDayValue,
        salesman: columns.salesman >= 0 ? String(row[columns.salesman] || "").trim() : "",
      });
    }
  }

  const parsedRows = Array.from(aggregate.values())
    .map((row) => buildOutstandingRow(row))
    .sort((a, b) => normalizeName(a.customer_name).localeCompare(normalizeName(b.customer_name)));

  return {
    rows: parsedRows,
    bucketLabels,
    invoices,
  };
}

export function selectPreferredOutstandingParses(parsedBySheetName) {
  const entries = (parsedBySheetName || []).filter((entry) => entry?.parsed);
  if (entries.length <= 1) return entries.map((entry) => entry.parsed);

  const pendingBills = entries.filter((entry) => (
    normalizeOutstandingHeader(entry.sheetName).includes("pending bills")
  ));
  const chosen = pendingBills.length ? pendingBills : entries;
  return chosen.map((entry) => entry.parsed);
}

export function combineOutstandingHeaderRows(rows, rowIndex) {
  const current = Array.isArray(rows?.[rowIndex]) ? rows[rowIndex] : [];
  const previous = rowIndex > 0 && Array.isArray(rows?.[rowIndex - 1]) ? rows[rowIndex - 1] : [];
  const previousValues = previous.filter((value) => String(value || "").trim());
  if (previousValues.length <= 1) return current;

  // Report banner rows like "Pending Bills" must not merge into detail column headers.
  const bannerText = normalizeOutstandingHeader(String(previous[0] || ""));
  if (bannerText.includes("pending bills") && !isOutstandingCustomerHeader(previous[0])) {
    return current;
  }

  const width = Math.max(current.length, previous.length);

  return Array.from({ length: width }, (_, columnIndex) => {
    const parts = [previous[columnIndex], current[columnIndex]]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return [...new Set(parts)].join(" ");
  });
}

export function prioritizeOutstandingSheets(sheetNames) {
  const priorities = ["pending bills", "bills receivable"];

  return [...new Set((sheetNames || []).filter(Boolean))].sort((a, b) => {
    const aIndex = priorities.indexOf(String(a).trim().toLowerCase());
    const bIndex = priorities.indexOf(String(b).trim().toLowerCase());
    const aPriority = aIndex < 0 ? priorities.length : aIndex;
    const bPriority = bIndex < 0 ? priorities.length : bIndex;
    return aPriority - bPriority;
  });
}

function parsedOutstandingAggregateKey(row) {
  return normalizeCode(row?.customer_code) || normalizeName(row?.customer_name);
}

function parsedOutstandingInvoiceKey(invoice) {
  return [
    normalizeCode(resolveOutstandingInvoiceCustomerCode(invoice) || invoice?.customer_code),
    String(invoice?.ref_no || "").trim().toUpperCase(),
    String(invoice?.due_date || "").trim(),
    toNumber(invoice?.pending_amount),
  ].join("|");
}

export function mergeParsedOutstandingSheets(parsedSheets) {
  const aggregate = new Map();
  const invoices = [];
  const seenInvoices = new Set();
  let bucketLabels = [];

  (parsedSheets || []).forEach((parsed) => {
    if (!parsed) return;

    if (!bucketLabels.length && Array.isArray(parsed.bucketLabels) && parsed.bucketLabels.length > 0) {
      bucketLabels = parsed.bucketLabels;
    }

    (parsed.invoices || []).forEach((invoice) => {
      const key = parsedOutstandingInvoiceKey(invoice);
      if (seenInvoices.has(key)) return;
      seenInvoices.add(key);
      invoices.push(invoice);
    });

    (parsed.rows || []).forEach((rawRow) => {
      const row = buildOutstandingRow(rawRow);
      const key = parsedOutstandingAggregateKey(row);
      if (!key) return;

      const current = aggregate.get(key);
      if (!current) {
        aggregate.set(key, {
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          open_invoices: row.open_invoices,
          buckets: { ...(row.buckets || {}) },
          total_outstanding: row.total_outstanding,
          ...(row.salesman ? { salesman: row.salesman } : {}),
        });
        return;
      }

      current.customer_name = pickLongestCustomerName(current.customer_name, row.customer_name);
      current.open_invoices = toNumber(current.open_invoices) + toNumber(row.open_invoices);
      Object.entries(row.buckets || {}).forEach(([label, value]) => {
        current.buckets[label] = toNumber(current.buckets[label]) + toNumber(value);
      });
      current.total_outstanding = toNumber(current.total_outstanding) + toNumber(row.total_outstanding);
      if (row.salesman) {
        current.salesman = pickOutstandingSalesmanName([
          ...(current.salesman ? [{ salesman: current.salesman }] : []),
          { salesman: row.salesman },
        ]);
      }
    });
  });

  const rows = Array.from(aggregate.values())
    .map((row) => buildOutstandingRow(row))
    .sort((a, b) => normalizeName(a.customer_name).localeCompare(normalizeName(b.customer_name)));

  return {
    rows,
    bucketLabels: bucketLabels.length
      ? bucketLabels
      : sortBucketLabels([...new Set(rows.flatMap((row) => Object.keys(row.buckets || {})))]),
    invoices,
  };
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

export function visibleOutstandingBucketLabels(labels, buckets) {
  const sortedLabels = sortBucketLabels(labels);
  let lastNonZeroIndex = -1;

  sortedLabels.forEach((label, index) => {
    if (toNumber(buckets?.[label]) !== 0) lastNonZeroIndex = index;
  });

  return lastNonZeroIndex < 0 ? [] : sortedLabels.slice(0, lastNonZeroIndex + 1);
}

export function summarizeOutstandingBuckets(buckets) {
  const summary = { days0To30: 0, days30To60: 0, daysAbove60: 0 };

  Object.entries(buckets || {}).forEach(([label, value]) => {
    const amount = toNumber(value);
    const startDay = bucketSortValue(label);

    if (startDay <= 0) summary.days0To30 += amount;
    else if (startDay <= 60) summary.days30To60 += amount;
    else summary.daysAbove60 += amount;
  });

  return summary;
}

export function summarizeOutstandingBucketsForVisitStatus(buckets) {
  const summary = {
    days0To30: 0,
    days30To60: 0,
    days61To90: 0,
    daysAbove90: 0,
  };

  Object.entries(buckets || {}).forEach(([label, value]) => {
    const amount = toNumber(value);
    const startDay = bucketSortValue(label);

    if (startDay <= 0) summary.days0To30 += amount;
    else if (startDay <= 60) summary.days30To60 += amount;
    else if (startDay <= 90) summary.days61To90 += amount;
    else summary.daysAbove90 += amount;
  });

  return summary;
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

  const salesman = String(row.salesman || "").trim();

  return {
    customer_code: String(row.customer_code || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    open_invoices: toNumber(row.open_invoices),
    buckets: normalizedBuckets,
    total_outstanding: toNumber(row.total_outstanding) || totalOutstanding,
    ...(salesman ? { salesman } : {}),
  };
}

export function findOutstandingForCustomer(dataset, customerCode, customerName) {
  if (isProspectCustomerCode(customerCode)) {
    return null;
  }

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
  if (isProspectCustomerCode(customerCode)) {
    return false;
  }

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

export function laterDateOnly(...values) {
  let latest = "";
  values.forEach((value) => {
    const date = parseOutstandingSheetDate(value);
    if (date && date > latest) latest = date;
  });
  return latest;
}

export function outstandingInvoiceDate(invoice, todayIso = new Date().toISOString()) {
  const fromField = parseOutstandingSheetDate(invoice?.invoice_date);
  if (fromField) return fromField;

  const days = resolveInvoiceDays(invoice, todayIso);
  if (!days) return "";

  const today = parseOutstandingSheetDate(todayIso) || new Date().toISOString().slice(0, 10);
  const dt = new Date(`${today}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

export function latestOutstandingInvoiceDate(invoices, customerCode, customerName, todayIso) {
  let latest = "";

  (invoices || []).forEach((invoice) => {
    const invoiceCode = resolveOutstandingInvoiceCustomerCode(invoice) || invoice?.customer_code;
    const matchesCustomer = isSameOutstandingCustomer(
      invoiceCode,
      invoice?.customer_name,
      customerCode,
      customerName,
    ) || customerAccountCodesMatch(invoiceCode, customerCode);
    if (!matchesCustomer) return;

    const date = outstandingInvoiceDate(invoice, todayIso);
    if (date > latest) latest = date;
  });

  return latest;
}

