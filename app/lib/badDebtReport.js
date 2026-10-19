import {
  customerAccountCodesMatch,
  resolveCustomerAccountCode,
} from "./outstanding.js";
import { addKsaCalendarDays, getKsaDateString } from "./workdayActivity.js";

export const POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS = 10;

const AGING_FIELDS = [
  "outstanding_0_30",
  "outstanding_30_60",
  "outstanding_61_90",
  "outstanding_91_120",
  "outstanding_above_120",
];

function money(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function positiveMoney(value) {
  return Math.max(0, money(value));
}

export function ksaDateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

export function fundsReceivedWindow(todayKey = getKsaDateString(), lookbackDays = POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS) {
  const today = String(todayKey || "").trim() || getKsaDateString();
  const days = Math.max(1, Math.floor(Number(lookbackDays) || POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS));
  return {
    today,
    start: addKsaCalendarDays(today, -(days - 1)),
    days,
  };
}

export function isFundsReceivedVisit(visit) {
  return String(visit?.visit_outcome || "").trim().toUpperCase() === "FUNDS_RECEIVED"
    && positiveMoney(visit?.amount_received) > 0;
}

export function sumFundsReceivedInWindow(visits = [], {
  todayKey = getKsaDateString(),
  lookbackDays = POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
} = {}) {
  const window = fundsReceivedWindow(todayKey, lookbackDays);
  return (visits || []).reduce((sum, visit) => {
    if (!isFundsReceivedVisit(visit)) return sum;
    const saved = ksaDateKey(visit?.saved_at);
    if (!saved || saved < window.start || saved > window.today) return sum;
    return money(sum + positiveMoney(visit.amount_received));
  }, 0);
}

function indexFundsByAccount(visits, options) {
  const totals = new Map();
  (visits || []).forEach((visit) => {
    if (!isFundsReceivedVisit(visit)) return;
    const saved = ksaDateKey(visit?.saved_at);
    const window = fundsReceivedWindow(options.todayKey, options.lookbackDays);
    if (!saved || saved < window.start || saved > window.today) return;
    const key = resolveCustomerAccountCode(visit.customer_code);
    if (!key) return;
    totals.set(key, money((totals.get(key) || 0) + positiveMoney(visit.amount_received)));
  });
  return totals;
}

export function fundsReceivedForCustomer(customerCode, fundsIndex) {
  if (!fundsIndex || typeof fundsIndex.get !== "function") return 0;
  let total = 0;
  const seen = new Set();
  for (const [key, amount] of fundsIndex.entries()) {
    if (seen.has(key)) continue;
    if (key !== resolveCustomerAccountCode(customerCode) && !customerAccountCodesMatch(key, customerCode)) {
      continue;
    }
    seen.add(key);
    total = money(total + positiveMoney(amount));
  }
  return total;
}

function totalOutstanding(record = {}) {
  return money(AGING_FIELDS.reduce((sum, field) => sum + positiveMoney(record?.[field]), 0));
}

function salesmanLabel(record = {}) {
  return String(record?.salesman_name || record?.salesman_code || record?.current_salesman_code || "").trim();
}

function cityArea(record = {}) {
  return [record?.city, record?.area].map((value) => String(value || "").trim()).filter(Boolean).join(" / ");
}

function findMatchingRecord(records, customerCode) {
  const matches = (records || []).filter((record) => customerAccountCodesMatch(record?.customer_code, customerCode));
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => (
    positiveMoney(right?.outstanding_above_120) - positiveMoney(left?.outstanding_above_120)
    || totalOutstanding(right) - totalOutstanding(left)
  ))[0];
}

function findMatchingCustomer(customers, customerCode) {
  return (customers || []).find((customer) => customerAccountCodesMatch(customer?.customer_code, customerCode)) || null;
}

export function isPotentialBadDebt(record = {}, fundsIndex) {
  if (positiveMoney(record?.outstanding_above_120) <= 0) return false;
  return fundsReceivedForCustomer(record?.customer_code, fundsIndex) <= 0;
}

function reportRow(record, {
  fundsIndex,
  transfer = null,
  actorNames = {},
  customer = null,
} = {}) {
  const code = String(record?.customer_code || transfer?.customer_code || customer?.customer_code || "").trim();
  const transferred = Boolean(transfer?.is_transferred);
  const actorId = String(transfer?.transferred_by || "").trim();
  return {
    customerCode: code,
    customerName: String(record?.customer_name || customer?.customer_name || code).trim(),
    salesman: salesmanLabel(record) || salesmanLabel(customer),
    cityArea: cityArea(record) || cityArea(customer),
    outstandingAbove120: positiveMoney(record?.outstanding_above_120),
    totalOutstanding: totalOutstanding(record),
    receivedLast10Days: fundsReceivedForCustomer(code, fundsIndex),
    transferredToLegal: transferred,
    transferredAt: transferred ? ksaDateKey(transfer?.transferred_at) : "",
    transferredBy: transferred ? String(actorNames[actorId] || "").trim() : "",
    legalNote: transferred ? String(transfer?.note || "").trim() : "",
  };
}

export function activeLegalTransfers(transfers = []) {
  const active = (transfers || []).filter((transfer) => Boolean(transfer?.is_transferred));
  const kept = [];
  [...active].sort((left, right) => String(right?.transferred_at || "").localeCompare(String(left?.transferred_at || "")))
    .forEach((transfer) => {
      if (kept.some((existing) => customerAccountCodesMatch(existing.customer_code, transfer.customer_code))) return;
      kept.push(transfer);
    });
  return kept;
}

export function buildPotentialBadDebtRows(records = [], {
  fundsReceived = [],
  transfers = [],
  actorNames = {},
  todayKey = getKsaDateString(),
  lookbackDays = POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
} = {}) {
  const options = { todayKey, lookbackDays };
  const fundsIndex = indexFundsByAccount(fundsReceived, options);
  const legal = activeLegalTransfers(transfers);
  return (records || [])
    .filter((record) => isPotentialBadDebt(record, fundsIndex))
    .map((record) => reportRow(record, {
      fundsIndex,
      transfer: legal.find((transfer) => customerAccountCodesMatch(transfer.customer_code, record.customer_code)) || null,
      actorNames,
    }))
    .sort((left, right) => (
      right.outstandingAbove120 - left.outstandingAbove120
      || right.totalOutstanding - left.totalOutstanding
      || String(left.customerName || "").localeCompare(String(right.customerName || ""))
    ));
}

export function buildLegalTransferRows({
  transfers = [],
  records = [],
  customers = [],
  fundsReceived = [],
  actorNames = {},
  todayKey = getKsaDateString(),
  lookbackDays = POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
} = {}) {
  const fundsIndex = indexFundsByAccount(fundsReceived, { todayKey, lookbackDays });
  return activeLegalTransfers(transfers)
    .map((transfer) => reportRow(
      findMatchingRecord(records, transfer.customer_code),
      {
        fundsIndex,
        transfer,
        actorNames,
        customer: findMatchingCustomer(customers, transfer.customer_code),
      },
    ))
    .sort((left, right) => (
      String(right.transferredAt || "").localeCompare(String(left.transferredAt || ""))
      || right.outstandingAbove120 - left.outstandingAbove120
      || String(left.customerName || "").localeCompare(String(right.customerName || ""))
    ));
}

export function summarizeDebtRows(rows = []) {
  return (rows || []).reduce((summary, row) => ({
    customers: summary.customers + 1,
    outstandingAbove120: money(summary.outstandingAbove120 + positiveMoney(row?.outstandingAbove120)),
    totalOutstanding: money(summary.totalOutstanding + positiveMoney(row?.totalOutstanding)),
    transferredToLegal: summary.transferredToLegal + (row?.transferredToLegal ? 1 : 0),
    receivedLast10Days: money(summary.receivedLast10Days + positiveMoney(row?.receivedLast10Days)),
  }), {
    customers: 0,
    outstandingAbove120: 0,
    totalOutstanding: 0,
    transferredToLegal: 0,
    receivedLast10Days: 0,
  });
}
