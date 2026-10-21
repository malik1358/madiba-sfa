import * as XLSX from "xlsx";
import {
  extractLeadingCustomerCodeAndName,
  formatSheetDateValue,
  isSameOutstandingCustomer,
  normalizeCode,
  normalizeName,
  toNumber,
} from "./outstanding.js";
import { parsePartyName, splitPartyByLeadingCode } from "./customerCode.js";

export const RECEIPT_DATASET_KEY = "receipt_register_dataset_v1";

const HEADER_ALIASES = {
  date: [
    "transaction date",
    "transactiondate",
    "date",
    "voucher date",
    "vch date",
    "receipt date",
  ],
  particulars: [
    "ledger name",
    "ledgername",
    "particulars",
    "party",
    "party name",
    "account",
    "customer",
    "ledger",
  ],
  salesman: ["salesman", "sales man", "sales person", "executive"],
  city: ["city"],
  state: ["state", "region"],
  vchType: [
    "voucher type name",
    "vouchertypename",
    "vch type",
    "voucher type",
    "type",
  ],
  vchNo: [
    "voucher number",
    "vouchernumber",
    "vch no",
    "vch no.",
    "voucher no",
    "ref no",
    "receipt no",
  ],
  debit: ["debit", "dr"],
  credit: ["credit", "cr", "amount", "receipt amount", "received"],
};

function cellText(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatSheetDateValue(value) || value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/[^a-z0-9]+/g, "");
}

function findColumnIndex(headerRow, aliases) {
  const normalized = (headerRow || []).map(normalizeHeader);
  const compacted = normalized.map((cell) => cell.replace(/[^a-z0-9]+/g, ""));
  for (const alias of aliases) {
    const aliasNorm = normalizeHeader(alias);
    const aliasCompact = compactHeader(alias);
    const index = normalized.findIndex((cell, cellIndex) => (
      cell === aliasNorm
      || cell.includes(aliasNorm)
      || compacted[cellIndex] === aliasCompact
      || (aliasCompact.length >= 3 && compacted[cellIndex].includes(aliasCompact))
    ));
    if (index >= 0) return index;
  }
  return -1;
}

export function excelDateToIso(value) {
  if (!value && value !== 0) return "";

  const fromSheet = formatSheetDateValue(value);
  if (fromSheet) return fromSheet;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatSheetDateValue(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = cellText(value);
  if (!text) return "";

  const slashDate = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashDate) {
    const left = Number(slashDate[1]);
    const right = Number(slashDate[2]);
    const year = Number(slashDate[3]);
    // If one side is > 12 it disambiguates MDY vs DMY (e.g. 9/20/2026 → 20 Sep).
    if (right > 12 && left >= 1 && left <= 12) {
      return `${year}-${String(left).padStart(2, "0")}-${String(right).padStart(2, "0")}`;
    }
    if (left > 12 && right >= 1 && right <= 12) {
      return `${year}-${String(right).padStart(2, "0")}-${String(left).padStart(2, "0")}`;
    }
    // Ambiguous (both <= 12): prefer DMY for KSA uploads.
    if (left >= 1 && left <= 31 && right >= 1 && right <= 12) {
      return `${year}-${String(right).padStart(2, "0")}-${String(left).padStart(2, "0")}`;
    }
  }

  const ymd = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return formatSheetDateValue(parsed) || parsed.toISOString().slice(0, 10);
  }

  return "";
}

/**
 * Payment voucher types from Tally (Payment Register / day book). Used for
 * dual customer+supplier parties where supplier-side payments also move the
 * party ledger that FIFO settlement must match.
 */
export function isPaymentVoucherType(vchType) {
  const text = normalizeHeader(vchType);
  if (!text) return false;
  if (text === "payment") return true;
  if (text.includes("payment voucher")) return true;
  if (text.startsWith("payment ")) return true;
  if (text.endsWith(" payment")) return true;
  return false;
}

/** True for any non-zero receipt/payment amount (payments are stored negative). */
export function hasReceiptRegisterAmount(amount) {
  return Math.abs(toNumber(amount)) > 0;
}

/**
 * Drop Payment voucher rows from a live receipt register (cleanup after a bad
 * positive-amount import). Returns kept rows plus how many payments were removed.
 */
export function stripPaymentVoucherRows(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const kept = [];
  let removed = 0;
  for (const row of source) {
    if (isPaymentVoucherType(row?.vch_type)) {
      removed += 1;
      continue;
    }
    kept.push(row);
  }
  return { rows: kept, removed };
}

export function findReceiptHeaderRow(sheetRows) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] || [];
    const dateIndex = findColumnIndex(row, HEADER_ALIASES.date);
    const particularsIndex = findColumnIndex(row, HEADER_ALIASES.particulars);
    const creditIndex = findColumnIndex(row, HEADER_ALIASES.credit);
    const debitIndex = findColumnIndex(row, HEADER_ALIASES.debit);
    // Receipt Register uses Cr; Payment Register uses Dr. Accept either amount column.
    if (dateIndex >= 0 && particularsIndex >= 0 && (creditIndex >= 0 || debitIndex >= 0)) {
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
          debit: debitIndex,
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
  if (split.customer_code && /\d/.test(split.customer_code)) {
    return {
      customer_code: normalizeCode(split.customer_code),
      customer_name: split.customer_name || text,
      particulars: text,
    };
  }

  const extracted = extractLeadingCustomerCodeAndName(text);
  if (extracted.customer_code && /\d/.test(extracted.customer_code)) {
    return {
      customer_code: normalizeCode(extracted.customer_code),
      customer_name: extracted.customer_name || text,
      particulars: text,
    };
  }

  const parsed = parsePartyName(text);
  if (parsed.customer_code && /\d/.test(parsed.customer_code)) {
    return {
      customer_code: normalizeCode(parsed.customer_code),
      customer_name: parsed.customer_name || text,
      particulars: text,
    };
  }

  return {
    customer_code: "",
    customer_name: text,
    particulars: text,
  };
}

function isTotalRow(particulars, dateValue) {
  const text = normalizeName(particulars);
  if (!text && !dateValue) return true;
  return text === "TOTAL" || text.startsWith("TOTAL:") || text === "GRAND TOTAL";
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

export function parseReceiptRegisterRows(
  sheetRows,
  headerInfo,
  customerLookup = null,
  options = {},
) {
  const includePaymentVouchers = Boolean(options?.includePaymentVouchers);
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const header = headerInfo || findReceiptHeaderRow(rows);
  if (!header) {
    return { rows: [], dates: [], matchedCount: 0, unmatchedCount: 0, skippedPaymentCount: 0 };
  }

  const { headerRowIndex, columns } = header;
  const parsed = [];
  const dates = new Set();
  let skippedPaymentCount = 0;

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const particulars = cellText(row[columns.particulars]);
    const receiptDate = excelDateToIso(row[columns.date]);
    if (isTotalRow(particulars, receiptDate)) continue;
    if (!receiptDate && !particulars) continue;

    // Keep collection voucher types (Receipt, JV-Collection, NSTC JV, etc.).
    // Payment vouchers are opt-in: they settle dual customer+supplier party ledgers.
    const vchType = columns.vchType >= 0 ? cellText(row[columns.vchType]) : "Receipt";
    const isPayment = isPaymentVoucherType(vchType);
    if (isPayment && !includePaymentVouchers) {
      skippedPaymentCount += 1;
      continue;
    }

    const credit = columns.credit >= 0 ? toNumber(row[columns.credit]) : 0;
    const debit = columns.debit >= 0 ? toNumber(row[columns.debit]) : 0;
    // Receipt / JV collection credit the party (positive). Payment debits the
    // party for dual customer+supplier ledgers, so it lands as a negative receipt.
    const signedMagnitude = isPayment
      ? (debit || credit || 0)
      : (credit || (debit > 0 ? debit : 0));
    const amount = isPayment ? -Math.abs(signedMagnitude) : signedMagnitude;
    if (!receiptDate || !hasReceiptRegisterAmount(amount)) continue;

    const party = parseParticularsParty(particulars);
    const mapped = mapReceiptPartyToCustomer(party, customerLookup);

    const built = buildReceiptRow({
      receipt_date: receiptDate,
      customer_code: mapped.customer_code,
      customer_name: mapped.customer_name,
      particulars,
      salesman: columns.salesman >= 0 ? cellText(row[columns.salesman]) : "",
      city: columns.city >= 0 ? cellText(row[columns.city]) : "",
      state: columns.state >= 0 ? cellText(row[columns.state]) : "",
      vch_type: vchType || (isPayment ? "Payment" : "Receipt"),
      vch_no: columns.vchNo >= 0 ? cellText(row[columns.vchNo]) : "",
      amount,
      matched: mapped.matched || Boolean(mapped.customer_code),
    });

    parsed.push(built);
    dates.add(built.receipt_date);
  }

  const cleaned = removeUnanchoredDuplicateReceipts(parsed);
  const keptRows = cleaned.rows;
  let liveMatched = 0;
  let liveUnmatched = 0;
  keptRows.forEach((row) => {
    if (row.matched || row.customer_code) liveMatched += 1;
    else liveUnmatched += 1;
  });

  return {
    rows: keptRows,
    dates: [...dates].sort(),
    matchedCount: liveMatched,
    unmatchedCount: liveUnmatched,
    skippedPaymentCount,
    removedDuplicateReceipts: cleaned.removed,
  };
}

export function prioritizeReceiptSheets(sheetNames = [], options = {}) {
  const includePaymentVouchers = Boolean(options?.includePaymentVouchers);
  const names = Array.isArray(sheetNames) ? sheetNames : [];
  return [...names].sort((left, right) => {
    const score = (name) => {
      const text = String(name || "").toLowerCase();
      if (includePaymentVouchers && text.includes("payment")) return 0;
      if (text.includes("receipt")) return includePaymentVouchers ? 1 : 0;
      if (text.includes("daybook") || text.includes("day book")) return 2;
      if (text === "export" || text.includes("export")) return 3;
      return 5;
    };
    return score(left) - score(right);
  });
}

/** Header + sample rows for the Receipt Register upload template (Cr amounts). */
export function receiptRegisterTemplateMatrix() {
  return [
    ["TRANSACTIONDATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "LEDGERNAME", "Cr"],
    ["2026-01-15", "Receipt", "1", "1006  SAMPLE CUSTOMER TRADING EST.", 1500],
    ["2026-01-15", "JV-Collection", "JV/Coll/2026/0001", "1144  SAMPLE CUSTOMER TWO EST.", 837.2],
  ];
}

/** Header + sample rows for the Payment Register upload template (Dr amounts). */
export function paymentRegisterTemplateMatrix() {
  return [
    ["TRANSACTIONDATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "LEDGERNAME", "Dr"],
    ["2026-01-15", "Payment", "PV/0001", "1415  SAMPLE DUAL CUSTOMER SUPPLIER", 2500],
  ];
}

/**
 * Stable identity for upsert merges. Prefer date + voucher type + voucher no;
 * fall back to date + customer + amount when the voucher number is blank.
 * Same-key incoming rows overwrite existing ones (amount/name/mapping updates)
 * without deleting other receipts on those dates.
 */
export function receiptRowIdentity(row) {
  const built = buildReceiptRow(row);
  const date = String(built.receipt_date || "").slice(0, 10);
  const vchNo = String(built.vch_no || "").trim().toUpperCase();
  const vchType = String(built.vch_type || "").trim().toUpperCase();
  const code = built.customer_code
    || normalizeName(built.customer_name || built.particulars)
    || "";
  if (date && vchNo) return `${date}|${vchType}|${vchNo}|${code}`;
  const amount = Number(built.amount || 0).toFixed(3);
  return `${date}|${vchType}|${code}|${amount}`;
}

function ledgerText(row) {
  return `${row?.particulars || ""} ${row?.customer_name || ""}`;
}

/** Bank, cash, and charge lines explain a customer receipt. Collector receivables do not. */
export function isReceiptMoneyLedger(row) {
  const text = ledgerText(row);
  if (/receivable/i.test(text)) return false;
  return /bank|cash|charge/i.test(text);
}

function isReceiptCustomerLine(row) {
  if (!normalizeCode(row?.customer_code)) return false;
  if (isReceiptMoneyLedger(row)) return false;
  if (/receivable/i.test(ledgerText(row))) return false;
  return true;
}

function amountCents(value) {
  return Math.round(toNumber(value) * 100);
}

function amountsClose(left, right) {
  return Math.abs(toNumber(left) - toNumber(right)) < 0.05;
}

/**
 * Tally receipt uploads sometimes repeat one customer receipt on the next
 * voucher number. Keep the copy that sits on the voucher whose bank/cash
 * total matches that receipt, and drop the copies that do not.
 * Same-amount receipts that each have their own matching bank line stay.
 * Copies with no bank line anywhere stay, so a real repeat is not deleted.
 * Receipts on or before 10 Oct 2026 are left alone: bank lines on those
 * vouchers were overwritten, so the matching bank is not a safe guide.
 * Those dates were repaired once from the Tally export.
 */
const RECEIPT_VOUCHER_ANCHOR_FROM = "2026-10-11";

export function removeUnanchoredDuplicateReceipts(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).map(buildReceiptRow);
  const moneyByVoucher = new Map();
  const partySumByVoucher = new Map();

  list.forEach((row) => {
    if (normalizeName(row.vch_type) !== "RECEIPT") return;
    if (!/^\d+$/.test(String(row.vch_no || "").trim())) return;
    const voucherKey = `${row.receipt_date}|${String(row.vch_no).trim()}`;
    if (isReceiptMoneyLedger(row) && toNumber(row.amount) > 0) {
      const bucket = moneyByVoucher.get(voucherKey) || { sum: 0, amounts: [] };
      bucket.sum += toNumber(row.amount);
      bucket.amounts.push(toNumber(row.amount));
      moneyByVoucher.set(voucherKey, bucket);
    }
    if (isReceiptCustomerLine(row) && toNumber(row.amount) > 0) {
      partySumByVoucher.set(
        voucherKey,
        toNumber(partySumByVoucher.get(voucherKey) || 0) + toNumber(row.amount),
      );
    }
  });

  function score(row) {
    const voucherKey = `${row.receipt_date}|${String(row.vch_no).trim()}`;
    const money = moneyByVoucher.get(voucherKey);
    if (!money || money.sum <= 0) return 0;
    if (money.amounts.some((amount) => amountsClose(amount, row.amount))) return 2;
    if (amountsClose(money.sum, row.amount)) return 2;
    if (amountsClose(money.sum, partySumByVoucher.get(voucherKey))) return 1;
    return 0;
  }

  const groups = new Map();
  list.forEach((row, index) => {
    if (normalizeName(row.vch_type) !== "RECEIPT") return;
    if (String(row.receipt_date || "") < RECEIPT_VOUCHER_ANCHOR_FROM) return;
    if (!isReceiptCustomerLine(row) || toNumber(row.amount) <= 0) return;
    if (!/^\d+$/.test(String(row.vch_no || "").trim())) return;
    const key = `${row.receipt_date}|${normalizeCode(row.customer_code)}|${amountCents(row.amount)}`;
    const group = groups.get(key) || [];
    group.push({ index, score: score(row), vch: String(row.vch_no).trim() });
    groups.set(key, group);
  });

  const drop = new Set();
  groups.forEach((group) => {
    const vouchers = new Set(group.map((entry) => entry.vch));
    if (vouchers.size < 2) return;
    const best = group.reduce((max, entry) => Math.max(max, entry.score), 0);
    if (best <= 0) return;
    group.forEach((entry) => {
      if (entry.score < best) drop.add(entry.index);
    });
  });

  if (drop.size === 0) return { rows: list, removed: 0 };
  return {
    rows: list.filter((_, index) => !drop.has(index)),
    removed: drop.size,
  };
}

function sortReceiptRows(rows) {
  return [...rows].sort((left, right) => {
    if (left.receipt_date !== right.receipt_date) {
      return left.receipt_date.localeCompare(right.receipt_date);
    }
    const vch = String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    if (vch !== 0) return vch;
    return String(left.customer_code || "").localeCompare(String(right.customer_code || ""));
  });
}

/**
 * Merge receipt uploads by row identity. Existing receipts are kept; incoming
 * rows add new vouchers or update matching ones. `uploadDates` is accepted for
 * call-site compatibility and is not used to wipe a whole day.
 */
export function mergeReceiptDatasets(existingRows, incomingRows, _uploadDates = []) {
  const byKey = new Map();
  for (const row of (Array.isArray(existingRows) ? existingRows : []).map(buildReceiptRow)) {
    if (!row.receipt_date || !hasReceiptRegisterAmount(row.amount)) continue;
    byKey.set(receiptRowIdentity(row), row);
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of (Array.isArray(incomingRows) ? incomingRows : []).map(buildReceiptRow)) {
    if (!row.receipt_date || !hasReceiptRegisterAmount(row.amount)) continue;
    const key = receiptRowIdentity(row);
    if (byKey.has(key)) {
      const previous = byKey.get(key);
      const changed = (
        Number(previous.amount || 0) !== Number(row.amount || 0)
        || String(previous.customer_code || "") !== String(row.customer_code || "")
        || String(previous.customer_name || "") !== String(row.customer_name || "")
        || String(previous.particulars || "") !== String(row.particulars || "")
        || String(previous.vch_type || "") !== String(row.vch_type || "")
        || Boolean(previous.matched) !== Boolean(row.matched)
      );
      if (changed) updated += 1;
      else unchanged += 1;
      byKey.set(key, row);
    } else {
      added += 1;
      byKey.set(key, row);
    }
  }

  const cleaned = removeUnanchoredDuplicateReceipts([...byKey.values()]);
  return {
    rows: sortReceiptRows(cleaned.rows),
    added,
    updated,
    unchanged,
    removedDuplicateReceipts: cleaned.removed,
  };
}

export function emptyReceiptDataset() {
  return {
    uploadedAt: "",
    fileName: "",
    filePath: "",
    rows: [],
    datesUpdated: [],
    matchedCount: 0,
    unmatchedCount: 0,
    rowsCount: 0,
  };
}

export function normalizeReceiptDataset(raw) {
  if (!raw || typeof raw !== "object") return emptyReceiptDataset();
  const cleaned = removeUnanchoredDuplicateReceipts(
    Array.isArray(raw.rows) ? raw.rows : [],
  );
  const rows = cleaned.rows;
  return {
    uploadedAt: String(raw.uploadedAt || ""),
    fileName: String(raw.fileName || ""),
    filePath: String(raw.filePath || ""),
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
