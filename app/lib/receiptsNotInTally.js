import {
  extractLeadingCustomerCodeAndName,
  isSameOutstandingCustomer,
  normalizeName,
  toNumber,
} from "./outstanding.js";
import { getKsaDateString } from "./workdayActivity.js";

/** Allow small bank/cash rounding differences (e.g. 4896.00 vs 4895.90). */
export const RECEIPT_AMOUNT_TOLERANCE = 1;
export const DEFAULT_DATE_WINDOW_DAYS = 1;

function parseIsoDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  return { year, month, day, iso: text };
}

function daysBetween(leftIso, rightIso) {
  const left = parseIsoDate(leftIso);
  const right = parseIsoDate(rightIso);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day);
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day);
  return Math.abs(Math.round((leftUtc - rightUtc) / 86400000));
}

function amountsMatch(left, right, tolerance = RECEIPT_AMOUNT_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

function comparableReceiptCustomerName(customerCode, customerName) {
  const rawName = String(customerName || "").trim();
  const rawCode = String(customerCode || "").trim();
  // Prefer the party name only — do not append the account code, or different
  // codes for the same trading name (1106 vs 1108) would never match.
  const fromName = extractLeadingCustomerCodeAndName(rawName);
  let name = fromName.customer_name || rawName;
  if (!name && rawCode) {
    name = extractLeadingCustomerCodeAndName(rawCode).customer_name || "";
  }
  if (rawCode) {
    const escaped = rawCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name
      .replace(new RegExp(`^${escaped}[\\s_-]+`, "i"), "")
      .replace(new RegExp(`[\\s_-]+${escaped}$`, "i"), "")
      .trim();
  }
  return normalizeName(name)
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Receipt reconcile match: prefer account-code identity, but also accept the same
 * trading name when Tally and the app use different customer codes (e.g. 1106 vs 1108).
 */
export function isSameReceiptCustomer(receiptCode, receiptName, visitCode, visitName) {
  if (isSameOutstandingCustomer(receiptCode, receiptName, visitCode, visitName)) {
    return true;
  }
  const left = comparableReceiptCustomerName(receiptCode, receiptName);
  const right = comparableReceiptCustomerName(visitCode, visitName);
  return Boolean(left && right && left.length >= 8 && left === right);
}

function receiptCustomerMatchRank(receipt, visit) {
  if (isSameOutstandingCustomer(
    receipt.customer_code,
    receipt.customer_name || receipt.particulars,
    visit.customer_code,
    visit.customer_name,
  )) {
    return 0;
  }
  if (isSameReceiptCustomer(
    receipt.customer_code,
    receipt.customer_name || receipt.particulars,
    visit.customer_code,
    visit.customer_name,
  )) {
    return 1;
  }
  return null;
}

function normalizeAppVisit(visit) {
  const row = visit && typeof visit === "object" ? visit : {};
  const savedAt = row.saved_at || row.savedAt || "";
  const visitDate = row.visit_date || row.visitDate || (savedAt ? getKsaDateString(new Date(savedAt)) : "");
  return {
    id: row.id || "",
    customer_code: String(row.customer_code || row.customerCode || "").trim(),
    customer_name: String(row.customer_name || row.customerName || "").trim(),
    amount_received: toNumber(row.amount_received ?? row.amountReceived),
    receipt_mode: String(row.receipt_mode || row.receiptMode || "").trim(),
    payment_status: String(row.payment_status || row.paymentStatus || "").trim(),
    visit_outcome: String(row.visit_outcome || row.visitOutcome || "").trim(),
    saved_at: savedAt,
    visit_date: visitDate,
    created_by: row.created_by || row.createdBy || "",
    collector_name: String(row.collector_name || row.collectorName || "").trim(),
  };
}

function normalizeTallyReceipt(receipt) {
  const row = receipt && typeof receipt === "object" ? receipt : {};
  return {
    receipt_date: String(row.receipt_date || row.receiptDate || "").trim().slice(0, 10),
    customer_code: String(row.customer_code || row.customerCode || "").trim(),
    customer_name: String(row.customer_name || row.customerName || row.particulars || "").trim(),
    particulars: String(row.particulars || "").trim(),
    vch_type: String(row.vch_type || row.vchType || "").trim(),
    vch_no: String(row.vch_no || row.vchNo || "").trim(),
    amount: toNumber(row.amount),
    matched: Boolean(row.matched),
  };
}

/**
 * Soft-join app FUNDS_RECEIVED visits to Tally receipt register rows.
 * Matching: same customer + amount within tolerance + date within windowDays.
 * Exact-date matches run first so nearby visits do not steal same-day vouchers.
 * Each Tally row is consumed at most once.
 */
export function reconcileAppReceiptsToTally({
  appVisits = [],
  tallyReceipts = [],
  windowDays = DEFAULT_DATE_WINDOW_DAYS,
  amountTolerance = RECEIPT_AMOUNT_TOLERANCE,
} = {}) {
  const visits = (Array.isArray(appVisits) ? appVisits : [])
    .map(normalizeAppVisit)
    .filter((visit) => (
      visit.amount_received > 0
      && (visit.visit_outcome === "FUNDS_RECEIVED" || !visit.visit_outcome)
      && visit.visit_date
    ))
    .sort((left, right) => {
      if (left.visit_date !== right.visit_date) return left.visit_date.localeCompare(right.visit_date);
      return String(left.saved_at || "").localeCompare(String(right.saved_at || ""));
    });

  const tallyPool = (Array.isArray(tallyReceipts) ? tallyReceipts : [])
    .map(normalizeTallyReceipt)
    .filter((row) => row.amount > 0 && row.receipt_date)
    .map((row, index) => ({ ...row, _index: index, _used: false }));

  const matchedByVisitId = new Map();

  function findBestReceipt(visit, maxDayGap) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    tallyPool.forEach((receipt) => {
      if (receipt._used) return;
      if (!amountsMatch(visit.amount_received, receipt.amount, amountTolerance)) return;
      const customerRank = receiptCustomerMatchRank(receipt, visit);
      if (customerRank === null) return;

      const dayGap = daysBetween(visit.visit_date, receipt.receipt_date);
      if (dayGap > maxDayGap) return;

      const amountGap = Math.abs(visit.amount_received - receipt.amount);
      // Prefer exact customer codes, closer dates, then closer amounts.
      const score = (customerRank * 100000)
        + (dayGap * 1000)
        + (amountGap * 10)
        + (receipt.vch_no ? 0 : 1)
        + (receipt._index * 0.0001);
      if (score < bestScore) {
        bestScore = score;
        best = receipt;
      }
    });

    return best;
  }

  function tryMatchVisit(visit, maxDayGap) {
    if (matchedByVisitId.has(visit.id)) return;
    const best = findBestReceipt(visit, maxDayGap);
    if (!best) return;
    best._used = true;
    matchedByVisitId.set(visit.id, {
      visit,
      tally: {
        receipt_date: best.receipt_date,
        customer_code: best.customer_code,
        customer_name: best.customer_name,
        particulars: best.particulars,
        vch_type: best.vch_type,
        vch_no: best.vch_no,
        amount: best.amount,
        matched: best.matched,
      },
      dayGap: daysBetween(visit.visit_date, best.receipt_date),
    });
  }

  // Pass 1: exact date only.
  visits.forEach((visit) => tryMatchVisit(visit, 0));
  // Pass 2: nearby dates within window.
  if (windowDays > 0) {
    visits.forEach((visit) => tryMatchVisit(visit, windowDays));
  }

  const matched = [];
  const missingInTally = [];
  visits.forEach((visit) => {
    const row = matchedByVisitId.get(visit.id);
    if (row) matched.push(row);
    else missingInTally.push(visit);
  });

  const appTotal = visits.reduce((sum, visit) => sum + visit.amount_received, 0);
  const missingTotal = missingInTally.reduce((sum, visit) => sum + visit.amount_received, 0);
  const matchedTotal = matched.reduce((sum, row) => sum + row.visit.amount_received, 0);

  return {
    appCount: visits.length,
    matchedCount: matched.length,
    missingCount: missingInTally.length,
    appTotal,
    matchedTotal,
    missingTotal,
    windowDays,
    amountTolerance,
    missingInTally,
    matched,
  };
}

export function shiftIsoDate(isoDate, days) {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return "";
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day + Number(days || 0));
  const date = new Date(utc);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
