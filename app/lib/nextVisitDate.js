import { getKsaDateString } from "./workdayActivity.js";

export const NEXT_VISIT_PAST_ERROR = "Next visit date cannot be in the past.";
export const NEXT_VISIT_REQUIRED_ERROR = "Next visit date is required.";
export const NEXT_VISIT_INVALID_ERROR = "Next visit date is invalid.";

/** Normalize to YYYY-MM-DD, or empty string when unusable. */
export function normalizeDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function getTodayDateKey(now = new Date()) {
  return getKsaDateString(now);
}

/** Calendar day for a visit or schedule value, using KSA when a timestamp is present. */
export function visitCalendarDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/T|\d{2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return getKsaDateString(parsed);
  }
  return normalizeDateOnly(raw);
}

/**
 * Keep a next-visit date only while it is still after the latest visit.
 * A visit on or after the scheduled day fulfills that booking.
 */
export function activeScheduledVisitDate(nextVisitAt, lastVisitAt) {
  const next = visitCalendarDateKey(nextVisitAt);
  if (!next) return "";
  const last = visitCalendarDateKey(lastVisitAt);
  if (last && last >= next) return "";
  return next;
}

/**
 * Returns a date-input value for scheduling, clearing dates before today
 * so overdue revisit dates are not re-saved by accident.
 */
export function nextVisitDateInputValue(value, todayKey = getTodayDateKey()) {
  const dateKey = normalizeDateOnly(value);
  if (!dateKey) return "";
  return dateKey < todayKey ? "" : dateKey;
}

/**
 * Validate a next-visit / follow-up date.
 * Allows today and future dates (KSA calendar day).
 * @returns {string|null} normalized YYYY-MM-DD, or null when empty and not required
 */
export function validateNextVisitDate(value, {
  required = false,
  todayKey = getTodayDateKey(),
} = {}) {
  const dateKey = normalizeDateOnly(value);
  if (!dateKey) {
    if (required) {
      throw new Error(NEXT_VISIT_REQUIRED_ERROR);
    }
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(NEXT_VISIT_INVALID_ERROR);
  }
  if (dateKey < todayKey) {
    throw new Error(NEXT_VISIT_PAST_ERROR);
  }
  return dateKey;
}
