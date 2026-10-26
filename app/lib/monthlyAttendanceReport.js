import { findUnloggedIdleGaps } from "./collectionDaySummary.js";
import { resolveDayRouteWorkingHours, extractWorkdayTimesFromRoute } from "./dayRouteMap.js";
import {
  assignOnSiteVisitNumbers,
  hideDuplicateVisitEntries,
  hideSupersededOrderDrafts,
  visitEntryType,
} from "./dailyVisitReportStats.js";
import { isCollectionOnlyAccess, isSalesmanRole, canViewManagementReports } from "./moduleAccess.js";
import { getKsaDateString } from "./workdayActivity.js";

const CUSTOMER_VISIT_TYPES = new Set([
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
]);

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function roundMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function entryAmount(entry) {
  const amount = Number(
    entry?.amountReceived
    ?? entry?.amount_received
    ?? entry?.meta?.amountReceived
    ?? entry?.meta?.amount_received
    ?? 0,
  );
  return Number.isFinite(amount) ? amount : 0;
}

function entryOrderId(entry) {
  const value = Number(entry?.orderId ?? entry?.order_id ?? entry?.meta?.orderId ?? entry?.meta?.order_id);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function entryOrderValue(entry) {
  const value = Number(entry?.orderValue ?? entry?.order_value ?? entry?.meta?.orderValue ?? entry?.meta?.order_value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function listKsaMonthDates(month, { throughDate = "" } = {}) {
  const match = String(month || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("Invalid month. Use YYYY-MM.");
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) throw new Error("Invalid month. Use YYYY-MM.");

  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cap = String(throughDate || "").trim();
  const dates = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
    if (cap && date > cap) break;
    dates.push(date);
  }
  return dates;
}

export function resolveMonthlyAttendanceDates(month, today = getKsaDateString()) {
  const target = String(month || "").trim();
  const currentMonth = String(today || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(target)) throw new Error("Invalid month. Use YYYY-MM.");
  if (target > currentMonth) throw new Error("Choose the current month or an earlier month.");
  const throughDate = target === currentMonth ? today : "";
  return {
    month: target,
    throughDate: throughDate || listKsaMonthDates(target).at(-1) || "",
    dates: listKsaMonthDates(target, { throughDate }),
  };
}

export function canOpenMonthlyAttendance(profile = {}) {
  if (canViewManagementReports(profile?.role)) return true;
  if (isCollectionOnlyAccess({
    role: profile?.role,
    salesmanCode: profile?.salesman_code || profile?.salesmanCode,
  })) return true;
  return isSalesmanRole(profile?.role);
}

export function isMonthlyAttendanceSubject(profile = {}) {
  return isSalesmanRole(profile?.role) || isCollectionOnlyAccess({
    role: profile?.role,
    salesmanCode: profile?.salesman_code || profile?.salesmanCode,
  });
}

function prepareEntries(entries = []) {
  return assignOnSiteVisitNumbers(
    hideDuplicateVisitEntries(hideSupersededOrderDrafts(entries)),
  );
}

export function countCustomerVisits(entries = []) {
  const codes = new Set();
  let anonymous = 0;
  (entries || []).forEach((entry) => {
    if (!CUSTOMER_VISIT_TYPES.has(visitEntryType(entry))) return;
    const code = normalizeCode(entry?.customerCode || entry?.customer_code);
    if (code) codes.add(code);
    else anonymous += 1;
  });
  return codes.size + anonymous;
}

export function sumCollectionAmount(entries = []) {
  return roundMoney((entries || []).reduce((sum, entry) => {
    if (visitEntryType(entry) !== "COLLECTION_VISIT") return sum;
    const amount = entryAmount(entry);
    return amount > 0 ? sum + amount : sum;
  }, 0));
}

export function sumOrderAmount(entries = []) {
  const seen = new Set();
  let total = 0;
  (entries || []).forEach((entry) => {
    if (visitEntryType(entry) !== "ORDER_SUBMITTED") return;
    const orderId = entryOrderId(entry);
    const key = orderId > 0 ? `id:${orderId}` : `row:${entry?.id || entry?.savedAt || entry?.saved_at || total}`;
    if (seen.has(key)) return;
    seen.add(key);
    const value = entryOrderValue(entry);
    if (value > 0) total += value;
  });
  return roundMoney(total);
}

function idleGapsForEntries(entries = []) {
  const times = extractWorkdayTimesFromRoute(entries);
  return findUnloggedIdleGaps({
    activities: (entries || [])
      .filter((entry) => visitEntryType(entry) !== "GPS_PING")
      .map((entry) => ({ saved_at: entry?.savedAt || entry?.saved_at })),
    loginAt: times.loginAt,
    logoutAt: times.logoutAt,
    lunchOutAt: times.lunchOutAt,
    lunchInAt: times.lunchInAt,
  });
}

export function buildMonthlyAttendanceDayRow({ date, entries = [] } = {}) {
  const prepared = prepareEntries(entries);
  const times = extractWorkdayTimesFromRoute(prepared);
  const hours = resolveDayRouteWorkingHours(prepared, idleGapsForEntries(prepared));
  return {
    date: String(date || ""),
    attended: Boolean(times.loginAt),
    loginAt: times.loginAt,
    workingHoursMinutes: Number(hours.minutes || 0),
    workingHoursLabel: hours.value || "0h",
    customerVisits: countCustomerVisits(prepared),
    collectionAmount: sumCollectionAmount(prepared),
    orderAmount: sumOrderAmount(prepared),
  };
}

export function summarizeMonthlyAttendance(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    dayCount: list.length,
    attendedDays: list.filter((row) => row.attended).length,
    totalWorkingMinutes: list.reduce((sum, row) => sum + Number(row.workingHoursMinutes || 0), 0),
    totalCustomerVisits: list.reduce((sum, row) => sum + Number(row.customerVisits || 0), 0),
    totalCollectionAmount: roundMoney(list.reduce((sum, row) => sum + Number(row.collectionAmount || 0), 0)),
    totalOrderAmount: roundMoney(list.reduce((sum, row) => sum + Number(row.orderAmount || 0), 0)),
  };
}

export function buildMonthlyAttendanceReport({ month, user = null, dates = [], entriesByDate = {} } = {}) {
  const rows = (dates || []).map((date) => buildMonthlyAttendanceDayRow({
    date,
    entries: entriesByDate?.get?.(date) || entriesByDate?.[date] || [],
  }));
  return {
    month: String(month || ""),
    user,
    rows,
    totals: summarizeMonthlyAttendance(rows),
  };
}
