import { isKsaFriday, listKsaMonthDates } from "../monthlyAttendanceReport.js";

export const HR_LEAVE_TYPES = ["ANNUAL", "SICK", "UNPAID", "EMERGENCY", "HAJJ", "OTHER"];
export const HR_LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export const HR_LEAVE_TYPE_LABELS = {
  ANNUAL: { en: "Annual", ar: "سنوية" },
  SICK: { en: "Sick", ar: "مرضية" },
  UNPAID: { en: "Unpaid", ar: "بدون راتب" },
  EMERGENCY: { en: "Emergency", ar: "طارئة" },
  HAJJ: { en: "Hajj", ar: "حج" },
  OTHER: { en: "Other", ar: "أخرى" },
};

export const HR_LEAVE_STATUS_LABELS = {
  PENDING: { en: "Pending", ar: "قيد الانتظار" },
  APPROVED: { en: "Approved", ar: "معتمدة" },
  REJECTED: { en: "Rejected", ar: "مرفوضة" },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateString, count) {
  const [year, month, day] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return next.toISOString().slice(0, 10);
}

/** Every calendar date from start to end inclusive (YYYY-MM-DD). */
export function listLeaveDates(startDate, endDate) {
  if (!DATE_PATTERN.test(String(startDate || "")) || !DATE_PATTERN.test(String(endDate || ""))) return [];
  if (endDate < startDate) return [];
  const dates = [];
  let cursor = startDate;
  while (cursor <= endDate && dates.length < 400) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** Leave days between two dates. Fridays are holidays and are not counted. */
export function countLeaveDays(startDate, endDate) {
  return listLeaveDates(startDate, endDate).filter((date) => !isKsaFriday(date)).length;
}

export function normalizeLeaveInput(input = {}) {
  const errors = [];
  const value = {
    employeeId: String(input.employeeId ?? input.employee_id ?? "").trim(),
    leaveType: String(input.leaveType ?? input.leave_type ?? "ANNUAL").trim().toUpperCase(),
    startDate: String(input.startDate ?? input.start_date ?? "").trim().slice(0, 10),
    endDate: String(input.endDate ?? input.end_date ?? "").trim().slice(0, 10),
    status: String(input.status || "APPROVED").trim().toUpperCase(),
    notes: String(input.notes ?? "").trim(),
    days: 0,
  };
  if (!value.employeeId) errors.push("Employee is required.");
  if (!HR_LEAVE_TYPES.includes(value.leaveType)) errors.push("Unknown leave type.");
  if (!HR_LEAVE_STATUSES.includes(value.status)) errors.push("Unknown leave status.");
  if (!DATE_PATTERN.test(value.startDate)) errors.push("Start date must be YYYY-MM-DD.");
  if (!DATE_PATTERN.test(value.endDate)) errors.push("End date must be YYYY-MM-DD.");
  if (!errors.length && value.endDate < value.startDate) errors.push("End date cannot be before start date.");
  if (!errors.length) {
    value.days = countLeaveDays(value.startDate, value.endDate);
    if (value.days <= 0) errors.push("Leave range has no working days (Fridays are holidays).");
  }
  return { value, errors };
}

export function leaveToRow(leave = {}) {
  return {
    employee_id: leave.employeeId,
    leave_type: leave.leaveType,
    start_date: leave.startDate,
    end_date: leave.endDate,
    days: leave.days,
    status: leave.status,
    notes: leave.notes || "",
  };
}

export function rowToLeave(row = {}) {
  return {
    id: row.id || "",
    employeeId: row.employee_id || "",
    leaveType: row.leave_type || "ANNUAL",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    days: Number(row.days || 0),
    status: row.status || "APPROVED",
    notes: row.notes || "",
    createdAt: row.created_at || null,
  };
}

/** Do two leave ranges for the same employee overlap? Rejected leave never blocks. */
export function findLeaveOverlap(entries = [], candidate = {}) {
  return (entries || []).find((entry) => (
    entry.id !== candidate.id
    && entry.employeeId === candidate.employeeId
    && entry.status !== "REJECTED"
    && candidate.status !== "REJECTED"
    && entry.startDate <= candidate.endDate
    && entry.endDate >= candidate.startDate
  )) || null;
}

/** Set of APPROVED leave dates (non-Friday) that fall inside a YYYY-MM month. */
export function approvedLeaveDatesInMonth(entries = [], month) {
  const monthDates = new Set(listKsaMonthDates(month));
  const dates = new Set();
  for (const entry of entries || []) {
    if (entry.status !== "APPROVED") continue;
    for (const date of listLeaveDates(entry.startDate, entry.endDate)) {
      if (monthDates.has(date) && !isKsaFriday(date)) dates.add(date);
    }
  }
  return dates;
}

export function leaveDaysInMonth(entries = [], month) {
  return approvedLeaveDatesInMonth(entries, month).size;
}

/** Leave balance helper for the leave screen: approved days per type. */
export function summarizeLeaveByType(entries = []) {
  const totals = Object.fromEntries(HR_LEAVE_TYPES.map((type) => [type, 0]));
  for (const entry of entries || []) {
    if (entry.status !== "APPROVED") continue;
    totals[entry.leaveType] = (totals[entry.leaveType] || 0) + Number(entry.days || 0);
  }
  return totals;
}
