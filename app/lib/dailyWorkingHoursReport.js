import {
  extractWorkdayTimesFromRoute,
  resolveDayRouteWorkingHours,
} from "./dayRouteMap.js";
import { formatWorkingHours } from "./workdayActivity.js";

const NEAR_CUSTOMER_TRANSACTION_TYPES = new Set([
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
]);

function entryType(entry) {
  return String(entry?.transactionType || entry?.transaction_type || entry?.type || "")
    .trim()
    .toUpperCase();
}

function isNearCustomerEntry(entry) {
  if (!NEAR_CUSTOMER_TRANSACTION_TYPES.has(entryType(entry))) return false;
  return !entry?.isFarFromCustomer;
}

function countByType(entries, type) {
  return (entries || []).filter((entry) => entryType(entry) === type).length;
}

/**
 * Build attendance-style daily working-hours rows from daily-visit user payloads.
 * Hours use resolveDayRouteWorkingHours (near visits around lunch / attendance fallback).
 */
export function buildDailyWorkingHoursRow(user = {}) {
  const entries = Array.isArray(user?.entries) ? user.entries : [];
  const times = extractWorkdayTimesFromRoute(entries);
  const hours = resolveDayRouteWorkingHours(entries);
  const nearStops = entries.filter(isNearCustomerEntry).length;
  const farStops = entries.filter((entry) => (
    NEAR_CUSTOMER_TRANSACTION_TYPES.has(entryType(entry)) && Boolean(entry?.isFarFromCustomer)
  )).length;

  return {
    userId: user.userId || user.id || "",
    userName: user.userName || "",
    salesmanCode: user.salesmanCode || user.salesman_code || "",
    role: user.role || "",
    email: user.email || "",
    loginAt: times.loginAt,
    lunchOutAt: times.lunchOutAt,
    lunchInAt: times.lunchInAt,
    logoutAt: times.logoutAt,
    logoutAutoClosed: Boolean(
      entries.some((entry) => entryType(entry) === "END_OF_DAY" && entry?.logoutAutoClosed),
    ),
    workingHoursMinutes: hours.minutes,
    workingHoursLabel: hours.value,
    nearStopCount: nearStops,
    farStopCount: farStops,
    visitReports: countByType(entries, "VISIT_REPORT"),
    ordersSubmitted: countByType(entries, "ORDER_SUBMITTED"),
    collections: countByType(entries, "COLLECTION_VISIT"),
  };
}

export function buildDailyWorkingHoursRows(users = []) {
  return (users || [])
    .map((user) => buildDailyWorkingHoursRow(user))
    .sort((left, right) => String(left.userName || "").localeCompare(String(right.userName || "")));
}

export function summarizeDailyWorkingHours(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    userCount: list.length,
    loggedInCount: list.filter((row) => row.loginAt).length,
    withHoursCount: list.filter((row) => Number(row.workingHoursMinutes || 0) > 0).length,
    totalWorkingMinutes: list.reduce((sum, row) => sum + Number(row.workingHoursMinutes || 0), 0),
    totalNearStops: list.reduce((sum, row) => sum + Number(row.nearStopCount || 0), 0),
    totalFarStops: list.reduce((sum, row) => sum + Number(row.farStopCount || 0), 0),
  };
}

export function formatDailyWorkingHoursTotal(minutes) {
  return formatWorkingHours(minutes);
}
