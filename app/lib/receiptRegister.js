import * as XLSX from "xlsx";
import {
  extractLeadingCustomerCodeAndName,
  isSameOutstandingCustomer,
  normalizeCode,
  normalizeName,
  toNumber,
} from "./outstanding.js";
import { parsePartyName, splitPartyByLeadingCode } from "./customerCode.js";

export const RECEIPT_DATASET_KEY = "receipt_register_dataset_v1";

const HEADER_ALIASES = {
  date: ["date", "voucher date", "vch date", "receipt date"],
  particulars: ["particulars", "party", "party name", "account", "customer", "ledger"],
  salesman: ["salesman", "sales man", "sales person", "executive"],
  city: ["city"],
  state: ["state", "region"],
  vchType: ["vch type", "voucher type", "type"],
  vchNo: ["vch no", "vch no.", "voucher no", "voucher number", "ref no", "receipt no"],
  debit: ["debit", "dr"],
  credit: ["credit", "cr", "amount", "receipt amount", "received"],
};

function cellText(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function findColumnIndex(headerRow, aliases) {
  const normalized = (headerRow || []).map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.findIndex((cell) => cell === alias || cell.includes(alias));
    if (index >= 0) return index;
  }
  return -1;
}

export function excelDateToIso(value) {
  if (!value && value !== 0) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = cellText(value);
  if (!text) return "";

  const dmy = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const ymd = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

export function findReceiptHeaderRow(sheetRows) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] || [];
    const dateIndex = findColumnIndex(row, HEADER_ALIASES.date);
    const particularsIndex = findColumnIndex(row, HEADER_ALIASES.particulars);
    const creditIndex = findColumnIndex(row, HEADER_ALIASES.credit);
    if (dateIndex >= 0 && particularsIndex >= 0 && creditIndex >= 0) {
      return {
        headerRowIndex: index,
        columns: {
          date: dateIndex,
          particulars: particularsIndex,
          salesman: findColumnIndex(row, HEADER_ALIASES.salesman),
          city: findColumnIndex(row, HEADER_ALIASES.city),
          state: findColumnIndex(row, HEADER_ALIASES.state),
          vchType: findColumnIndex(row, HEADER_ALIASES.vchType),
          vchNo: findColumnIndex(row, HEADER_ALIASES.vchNo),
          debit: findColumnIndex(row, HEADER_ALIASES.debit),
          credit: creditIndex,
        },
      };
    }
  }
  return null;
}

export function parseParticularsParty(particularsRaw) {
  const text = cellText(particularsRaw);
  if (!text) {
    return { customer_code: "", customer_name: "", particulars: "" };
  }

  const split = splitPartyByLeadingCode(text);
  if (split.customer_code) {
    return {
      customer_code: normalizeCode(split.customer_code),
      customer_name: split.customer_name || text,
      particulars: text,
    };
  }

  const extracted = extractLeadingCustomerCodeAndName(text);
  if (extracted.customer_code) {
    return {
      customer_code: normalizeCode(extracted.customer_code),
      customer_name: extracted.customer_name || text,
      particulars: text,
    };
  }

  const parsed = parsePartyName(text);
  return {
    customer_code: normalizeCode(parsed.customer_code),
    customer_name: parsed.customer_name || text,
    particulars: text,
  };
}

function isTotalRow(particulars, dateValue) {
  const text = normalizeName(particulars);
  if (!text && !dateValue) return true;
  return text === "TOTAL" || text.startsWith("TOTAL:") || text === "GRAND TOTAL";
}

function looksLikeReceiptType(value) {
  const text = normalizeName(value);
  if (!text) return true;
  return text.includes("RECEIPT");
}

export function buildCustomerLookup(customers = []) {
  const byCode = new Map();
  const byName = new Map();

  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const code = normalizeCode(customer?.customer_code);
    const name = normalizeName(customer?.customer_name);
    if (code) byCode.set(code, customer);
    if (name && !byName.has(name)) byName.set(name, customer);

    const fromName = parseParticularsParty(`${code} ${name}`.trim());
    if (fromName.customer_code && !byCode.has(fromName.customer_code)) {
      byCode.set(fromName.customer_code, customer);
    }
    const comparable = normalizeName(fromName.customer_name || name);
    if (comparable && !byName.has(comparable)) byName.set(comparable, customer);
  });

  return { byCode, byName };
}

export function mapReceiptPartyToCustomer(party, lookup) {
  const code = normalizeCode(party?.customer_code);
  const name = normalizeName(party?.customer_name || party?.particulars);

  if (code && lookup?.byCode?.has(code)) {
    const matched = lookup.byCode.get(code);
    return {
      customer_code: normalizeCode(matched.customer_code || code),
      customer_name: String(matched.customer_name || party.customer_name || "").trim(),
      matched: true,
    };
  }

  if (name && lookup?.byName?.has(name)) {
    const matched = lookup.byName.get(name);
    return {
      customer_code: normalizeCode(matched.customer_code || ""),
      customer_name: String(matched.customer_name || party.customer_name || "").trim(),
      matched: Boolean(matched.customer_code || matched.customer_name),
    };
  }

  if (lookup?.byCode || lookup?.byName) {
    const customers = [
      ...new Map(
        [...(lookup.byCode?.values() || []), ...(lookup.byName?.values() || [])]
          .map((row) => [normalizeCode(row.customer_code) || normalizeName(row.customer_name), row])
      ).values(),
    ];
    const matched = customers.find((customer) => (
      isSameOutstandingCustomer(
        customer.customer_code,
        customer.customer_name,
        code,
        party?.customer_name || party?.particulars,
      )
    ));
    if (matched) {
      return {
        customer_code: normalizeCode(matched.customer_code || code),
        customer_name: String(matched.customer_name || party.customer_name || "").trim(),
        matched: true,
      };
    }
  }

  return {
    customer_code: code,
    customer_name: String(party?.customer_name || party?.particulars || "").trim(),
    matched: Boolean(code),
  };
}

export function buildReceiptRow(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const amount = toNumber(row.amount ?? row.credit);
  return {
    receipt_date: excelDateToIso(row.receipt_date) || cellText(row.receipt_date).slice(0, 10),
    customer_code: normalizeCode(row.customer_code),
    customer_name: String(row.customer_name || "").trim(),
    particulars: String(row.particulars || row.customer_name || "").trim(),
    salesman: String(row.salesman || "").trim(),
    city: String(row.city || "").trim(),
    state: String(row.state || "").trim(),
    vch_type: String(row.vch_type || "Receipt").trim() || "Receipt",
    vch_no: String(row.vch_no || "").trim(),
    amount,
    matched: Boolean(row.matched),
  };
}

export function parseReceiptRegisterRows(sheetRows, headerInfo, customerLookup = null) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const header = headerInfo || findReceiptHeaderRow(rows);
  if (!header) {
    return { rows: [], dates: [], matchedCount: 0, unmatchedCount: 0 };
  }

  const { headerRowIndex, columns } = header;
  const parsed = [];
  const dates = new Set();
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const particulars = cellText(row[columns.particulars]);
    const receiptDate = excelDateToIso(row[columns.date]);
    if (isTotalRow(particulars, receiptDate)) continue;
    if (!receiptDate && !particulars) continue;

    const vchType = columns.vchType >= 0 ? cellText(row[columns.vchType]) : "Receipt";
    if (vchType && !looksLikeReceiptType(vchType)) continue;

    const credit = columns.credit >= 0 ? toNumber(row[columns.credit]) : 0;
    const debit = columns.debit >= 0 ? toNumber(row[columns.debit]) : 0;
    const amount = credit || (debit > 0 ? debit : 0);
    if (!receiptDate || amount <= 0) continue;

    const party = parseParticularsParty(particulars);
    const mapped = mapReceiptPartyToCustomer(party, customerLookup);
    if (mapped.matched || mapped.customer_code) matchedCount += 1;
    else unmatchedCount += 1;

    const built = buildReceiptRow({
      receipt_date: receiptDate,
      customer_code: mapped.customer_code,
      customer_name: mapped.customer_name,
      particulars,
      salesman: columns.salesman >= 0 ? cellText(row[columns.salesman]) : "",
      city: columns.city >= 0 ? cellText(row[columns.city]) : "",
      state: columns.state >= 0 ? cellText(row[columns.state]) : "",
      vch_type: vchType || "Receipt",
      vch_no: columns.vchNo >= 0 ? cellText(row[columns.vchNo]) : "",
      amount,
      matched: mapped.matched || Boolean(mapped.customer_code),
    });

    parsed.push(built);
    dates.add(built.receipt_date);
  }

  return {
    rows: parsed,
    dates: [...dates].sort(),
    matchedCount,
    unmatchedCount,
  };
}

export function prioritizeReceiptSheets(sheetNames = []) {
  const names = Array.isArray(sheetNames) ? sheetNames : [];
  return [...names].sort((left, right) => {
    const score = (name) => {
      const text = String(name || "").toLowerCase();
      if (text.includes("receipt")) return 0;
      if (text.includes("daybook") || text.includes("day book")) return 1;
      return 5;
    };
    return score(left) - score(right);
  });
}

export function mergeReceiptDatasets(existingRows, incomingRows, uploadDates) {
  const dateSet = new Set((uploadDates || []).map((value) => String(value || "").slice(0, 10)).filter(Boolean));
  const kept = (Array.isArray(existingRows) ? existingRows : [])
    .map(buildReceiptRow)
    .filter((row) => row.receipt_date && !dateSet.has(row.receipt_date));
  const incoming = (Array.isArray(incomingRows) ? incomingRows : []).map(buildReceiptRow);
  return [...kept, ...incoming].sort((left, right) => {
    if (left.receipt_date !== right.receipt_date) return left.receipt_date.localeCompare(right.receipt_date);
    return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
  });
}

export function emptyReceiptDataset() {
  return {
    uploadedAt: "",
    fileName: "",
    rows: [],
    datesUpdated: [],
    matchedCount: 0,
    unmatchedCount: 0,
    rowsCount: 0,
  };
}

export function normalizeReceiptDataset(raw) {
  if (!raw || typeof raw !== "object") return emptyReceiptDataset();
  const rows = Array.isArray(raw.rows) ? raw.rows.map(buildReceiptRow) : [];
  return {
    uploadedAt: String(raw.uploadedAt || ""),
    fileName: String(raw.fileName || ""),
    rows,
    datesUpdated: Array.isArray(raw.datesUpdated) ? raw.datesUpdated : [],
    matchedCount: Number(raw.matchedCount || 0),
    unmatchedCount: Number(raw.unmatchedCount || 0),
    rowsCount: Number(raw.rowsCount || rows.length),
  };
}

export function findReceiptsForCustomer(dataset, customerCode, customerName = "") {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  return rows
    .filter((row) => isSameOutstandingCustomer(row.customer_code, row.customer_name || row.particulars, customerCode, customerName))
    .map(buildReceiptRow)
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) return left.receipt_date.localeCompare(right.receipt_date);
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
}

export function monthKeyFromReceiptDate(value) {
  const iso = excelDateToIso(value) || String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "";
}

export function summarizeReceiptsByMonth(receipts = []) {
  const byMonth = new Map();
  (Array.isArray(receipts) ? receipts : []).forEach((row) => {
    const month = monthKeyFromReceiptDate(row?.receipt_date);
    if (!month) return;
    byMonth.set(month, Number(byMonth.get(month) || 0) + toNumber(row?.amount));
  });
  return byMonth;
}

export function attachMonthlyReceipts(analytics, receipts = []) {
  if (!analytics || !Array.isArray(analytics.monthlySummary)) return analytics;
  const byMonth = summarizeReceiptsByMonth(receipts);
  const monthlySummary = analytics.monthlySummary.map((month) => ({
    ...month,
    receipts: Number(byMonth.get(month.month) || 0),
  }));
  const receiptTotal = monthlySummary.reduce((total, month) => total + Number(month.receipts || 0), 0);
  return {
    ...analytics,
    monthlySummary,
    receiptTotal,
    receiptCount: Array.isArray(receipts) ? receipts.length : 0,
  };
}
