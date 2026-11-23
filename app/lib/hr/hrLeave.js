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

/** Coerce Excel serials / Date objects / strings into YYYY-MM-DD. */
export function coerceLeaveDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (DATE_PATTERN.test(text.slice(0, 10))) return text.slice(0, 10);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return text.slice(0, 10);
}

export function normalizeLeaveInput(input = {}) {
  const errors = [];
  const value = {
    employeeId: String(input.employeeId ?? input.employee_id ?? "").trim(),
    leaveType: String(input.leaveType ?? input.leave_type ?? "ANNUAL").trim().toUpperCase(),
    startDate: coerceLeaveDate(input.startDate ?? input.start_date),
    endDate: coerceLeaveDate(input.endDate ?? input.end_date),
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

/** Approved leave dates (non-Friday) inside an inclusive from/to range (26th–25th cycle). */
export function approvedLeaveDatesInRange(entries = [], fromDate, toDate) {
  const start = String(fromDate || "").trim().slice(0, 10);
  const end = String(toDate || "").trim().slice(0, 10);
  const dates = new Set();
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) return dates;
  for (const entry of entries || []) {
    if (entry.status !== "APPROVED") continue;
    for (const date of listLeaveDates(entry.startDate, entry.endDate)) {
      if (date >= start && date <= end && !isKsaFriday(date)) dates.add(date);
    }
  }
  return dates;
}

export function leaveDaysInMonth(entries = [], month) {
  return approvedLeaveDatesInMonth(entries, month).size;
}

export const HR_LEAVE_TEMPLATE_HEADERS = [
  "Employee Code",
  "Type",
  "Start Date",
  "End Date",
  "Status",
  "Notes",
];

function leaveHeaderToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

const LEAVE_FIELD_ALIASES = new Map([
  ["employeecode", "employeeCode"],
  ["empcode", "employeeCode"],
  ["code", "employeeCode"],
  ["staffcode", "employeeCode"],
  ["رقمالموظف", "employeeCode"],
  ["type", "leaveType"],
  ["leavetype", "leaveType"],
  ["نوع", "leaveType"],
  ["startdate", "startDate"],
  ["from", "startDate"],
  ["fromdate", "startDate"],
  ["start", "startDate"],
  ["enddate", "endDate"],
  ["to", "endDate"],
  ["todate", "endDate"],
  ["end", "endDate"],
  ["status", "status"],
  ["notes", "notes"],
  ["remarks", "notes"],
  ["ملاحظات", "notes"],
]);

export function resolveHrLeaveImportHeader(header) {
  return LEAVE_FIELD_ALIASES.get(leaveHeaderToken(header)) || null;
}

export function buildHrLeaveTemplateRows(employees = []) {
  return (employees || []).slice(0, 3).map((employee) => ({
    "Employee Code": employee.employeeCode,
    Type: "ANNUAL",
    "Start Date": "",
    "End Date": "",
    Status: "APPROVED",
    Notes: "",
  }));
}

export function hrLeaveTemplateListOptions(employees = []) {
  return {
    employeeCodes: (employees || []).map((employee) => employee.employeeCode).filter(Boolean),
    types: [...HR_LEAVE_TYPES],
    statuses: [...HR_LEAVE_STATUSES],
  };
}

/**
 * Parse historic leave spreadsheet rows into validated leave payloads.
 * Returns { items, errors }. Employee Code must match the staff list.
 */
export function parseHrLeaveImportRows(rows = [], { employees = [] } = {}) {
  const byCode = new Map(
    (employees || []).map((employee) => [String(employee.employeeCode || "").trim().toUpperCase(), employee]),
  );
  const items = [];
  const errors = [];

  (rows || []).forEach((rawRow, index) => {
    const rowNumber = index + 2;
    if (!rawRow || typeof rawRow !== "object") return;
    const mapped = {};
    for (const [header, cell] of Object.entries(rawRow)) {
      const key = resolveHrLeaveImportHeader(header);
      if (key) mapped[key] = cell;
    }
    const code = String(mapped.employeeCode ?? "").trim().toUpperCase();
    const hasData = Object.entries(mapped).some(([key, cell]) => key !== "employeeCode" && String(cell ?? "").trim() !== "");
    if (!code && !hasData) return;
    if (!code) {
      errors.push({ rowNumber, message: "Employee code is missing." });
      return;
    }
    const employee = byCode.get(code);
    if (!employee) {
      errors.push({ rowNumber, employeeCode: code, message: `Employee ${code} is not in the staff list.` });
      return;
    }

    let leaveType = String(mapped.leaveType ?? "ANNUAL").trim().toUpperCase();
    const typeMatch = HR_LEAVE_TYPES.find((type) => type === leaveType
      || HR_LEAVE_TYPE_LABELS[type].en.toUpperCase() === leaveType
      || HR_LEAVE_TYPE_LABELS[type].ar === String(mapped.leaveType ?? "").trim());
    if (typeMatch) leaveType = typeMatch;

    let status = String(mapped.status ?? "APPROVED").trim().toUpperCase();
    const statusMatch = HR_LEAVE_STATUSES.find((item) => item === status
      || HR_LEAVE_STATUS_LABELS[item].en.toUpperCase() === status
      || HR_LEAVE_STATUS_LABELS[item].ar === String(mapped.status ?? "").trim());
    if (statusMatch) status = statusMatch;

    const { value, errors: fieldErrors } = normalizeLeaveInput({
      employeeId: employee.id,
      leaveType,
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      status,
      notes: mapped.notes,
    });
    if (fieldErrors.length) {
      errors.push({ rowNumber, employeeCode: code, message: fieldErrors.join(" ") });
      return;
    }
    items.push({ rowNumber, employeeCode: code, value });
  });

  return { items, errors };
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
