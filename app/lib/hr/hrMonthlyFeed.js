import { addKsaCalendarDays, getKsaDateString } from "../workdayActivity.js";
import { isKsaFriday, listKsaMonthDates } from "../monthlyAttendanceReport.js";
import { normalizeEmployeeCode, roundHrMoney } from "./hrEmployees.js";

export const HR_RECORD_STATUSES = ["DRAFT", "FINAL"];
export const HR_RECORD_SOURCES = ["MANUAL", "IMPORT", "PREFILL"];

/** Earnings shown on the monthly editor (housing / other allowance are not used). */
export const HR_VISIBLE_EARNING_FIELDS = [
  "basicSalary",
  "transportAllowance",
  "overtimeAmount",
  "bonusAmount",
  "commissionAmount",
];

export const HR_EARNING_FIELDS = [
  "basicSalary",
  "housingAllowance",
  "transportAllowance",
  "otherAllowance",
  "overtimeAmount",
  "bonusAmount",
  "commissionAmount",
];

export const HR_DEDUCTION_FIELDS = [
  "absenceDeduction",
  "loanDeduction",
  "advanceDeduction",
  "penaltyDeduction",
  "otherDeduction",
];

export const HR_ATTENDANCE_FIELDS = [
  "workingDays",
  "presentDays",
  "absentDays",
  "halfDays",
  "leaveDays",
  "holidayDays",
  "overtimeHours",
];

export const HR_MONEY_FIELDS = [...HR_EARNING_FIELDS, ...HR_DEDUCTION_FIELDS];
export const HR_NUMBER_FIELDS = [...HR_MONEY_FIELDS, ...HR_ATTENDANCE_FIELDS];

export const HR_FIELD_LABELS = {
  basicSalary: { en: "Basic salary", ar: "الراتب الأساسي" },
  housingAllowance: { en: "Housing", ar: "بدل السكن" },
  transportAllowance: { en: "Transport", ar: "بدل النقل" },
  otherAllowance: { en: "Other allowance", ar: "بدلات أخرى" },
  overtimeAmount: { en: "Overtime", ar: "العمل الإضافي" },
  bonusAmount: { en: "Bonus", ar: "مكافأة" },
  commissionAmount: { en: "Commission", ar: "عمولة" },
  absenceDeduction: { en: "Absence deduction", ar: "خصم الغياب" },
  loanDeduction: { en: "Loan deduction", ar: "خصم القرض" },
  advanceDeduction: { en: "Advance deduction", ar: "خصم السلفة" },
  penaltyDeduction: { en: "Penalty", ar: "جزاءات" },
  otherDeduction: { en: "Other deduction", ar: "خصومات أخرى" },
  workingDays: { en: "Working days", ar: "أيام العمل" },
  presentDays: { en: "Present days", ar: "أيام الحضور" },
  absentDays: { en: "Absent days", ar: "أيام الغياب" },
  halfDays: { en: "Half days", ar: "أيام نصف دوام" },
  leaveDays: { en: "Leave days", ar: "أيام الإجازة" },
  holidayDays: { en: "Holidays (Fri)", ar: "العطلات (الجمعة)" },
  overtimeHours: { en: "Overtime hours", ar: "ساعات إضافية" },
};

/**
 * Payroll month YYYY-MM uses attendance from previous-month 26th through this-month 25th.
 * Example: 2026-11 → 2026-10-26 … 2026-11-25.
 */
export function hrPayrollPeriodForMonth(month) {
  if (!isValidHrMonth(month)) throw new Error("Invalid month. Use YYYY-MM.");
  const [year, mon] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(year, mon - 2, 26));
  const fromDate = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-26`;
  const toDate = `${month}-25`;
  return { month, fromDate, toDate };
}

/** Prefill is allowed only on/after the period end date (25th of the payroll month). */
export function canPrefillHrPayrollMonth(month, today = getKsaDateString()) {
  const period = hrPayrollPeriodForMonth(month);
  const asOf = String(today || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return { ok: false, reason: "Invalid today date.", ...period, today: asOf };
  }
  if (asOf < period.toDate) {
    return {
      ok: false,
      reason: `Prefill opens on/after ${period.toDate} (salary cycle ${period.fromDate}–${period.toDate}).`,
      ...period,
      today: asOf,
    };
  }
  return { ok: true, reason: "", ...period, today: asOf };
}

/** Every KSA calendar date from fromDate to toDate inclusive. */
export function listHrPayrollPeriodDates(fromDate, toDate) {
  const start = String(fromDate || "").trim().slice(0, 10);
  const end = String(toDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return [];
  const dates = [];
  let cursor = start;
  while (cursor <= end && dates.length < 62) {
    dates.push(cursor);
    cursor = addKsaCalendarDays(cursor, 1);
  }
  return dates;
}

/**
 * Absence deduction = (absentDays + halfDays×0.5) × (basicSalary / workingDays).
 * Transport stays in earnings; it is not part of the daily charge rate.
 */
export function computeAbsenceDeduction({
  basicSalary = 0,
  workingDays = 0,
  absentDays = 0,
  halfDays = 0,
} = {}) {
  const work = Number(workingDays) || 0;
  if (work <= 0) return 0;
  const charged = Number(absentDays || 0) + Number(halfDays || 0) * 0.5;
  if (charged <= 0) return 0;
  return roundHrMoney((Number(basicSalary || 0) / work) * charged);
}

const SNAKE = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function isValidHrMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function toAmount(value) {
  if (value === "" || value == null) return 0;
  const amount = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(amount) ? amount : NaN;
}

/** Net pay = sum of earnings minus sum of deductions. No GOSI or statutory engine. */
export function computeMonthlyTotals(record = {}) {
  const grossEarnings = roundHrMoney(
    HR_EARNING_FIELDS.reduce((sum, key) => sum + Number(record[key] || 0), 0),
  );
  const totalDeductions = roundHrMoney(
    HR_DEDUCTION_FIELDS.reduce((sum, key) => sum + Number(record[key] || 0), 0),
  );
  return {
    grossEarnings,
    totalDeductions,
    netPay: roundHrMoney(grossEarnings - totalDeductions),
  };
}

export function emptyMonthlyRecord() {
  const record = { notes: "", status: "DRAFT", source: "MANUAL" };
  for (const key of HR_NUMBER_FIELDS) record[key] = 0;
  return { ...record, ...computeMonthlyTotals(record) };
}

/** New month defaults: basic + transport from master (housing/other are not used). */
export function defaultMonthlyRecordForEmployee(employee = {}) {
  const record = emptyMonthlyRecord();
  record.basicSalary = roundHrMoney(employee.basicSalary);
  record.housingAllowance = 0;
  record.transportAllowance = roundHrMoney(employee.transportAllowance);
  record.otherAllowance = 0;
  return { ...record, ...computeMonthlyTotals(record) };
}

/** Apply master basic+transport and auto absence deduction onto a prefill/save patch. */
export function applyMasterPayAndAbsence(employee = {}, attendanceOrPatch = {}) {
  const workingDays = Number(attendanceOrPatch.workingDays ?? 0);
  const absentDays = Number(attendanceOrPatch.absentDays ?? 0);
  const halfDays = Number(attendanceOrPatch.halfDays ?? 0);
  const basicSalary = roundHrMoney(employee.basicSalary);
  const transportAllowance = roundHrMoney(employee.transportAllowance);
  return {
    ...attendanceOrPatch,
    basicSalary,
    transportAllowance,
    housingAllowance: 0,
    otherAllowance: 0,
    absenceDeduction: computeAbsenceDeduction({
      basicSalary,
      workingDays,
      absentDays,
      halfDays,
    }),
  };
}

/**
 * Validate the numeric/text fields in `input`. With { partial: true } only the keys that are
 * present are returned (used by Excel import and prefill). Negative amounts are rejected.
 */
export function normalizeMonthlyRecordInput(input = {}, { partial = false } = {}) {
  const errors = [];
  const value = {};
  for (const key of HR_NUMBER_FIELDS) {
    const raw = input[key] ?? input[SNAKE(key)];
    if (raw === undefined && partial) continue;
    const amount = toAmount(raw);
    if (Number.isNaN(amount) || amount < 0) {
      errors.push(`${key} must be a non-negative number.`);
      value[key] = 0;
    } else {
      value[key] = roundHrMoney(amount);
    }
  }
  if (input.notes !== undefined || !partial) value.notes = String(input.notes ?? "").trim();
  return { value, errors };
}

/** Apply a patch to an existing/default record and recompute totals. */
export function mergeMonthlyRecord(base = {}, patch = {}) {
  const merged = { ...emptyMonthlyRecord(), ...base, ...patch };
  return { ...merged, ...computeMonthlyTotals(merged) };
}

/** FINAL rows are protected. They only change after an explicit reopen (status back to DRAFT). */
export function canOverwriteMonthlyRecord(existing) {
  if (!existing) return { ok: true, reason: "" };
  if (existing.status === "FINAL") {
    return { ok: false, reason: "Record is FINAL. Reopen it before changing." };
  }
  return { ok: true, reason: "" };
}

export function monthlyRecordToRow(employeeId, month, record = {}, extra = {}) {
  const merged = mergeMonthlyRecord({}, record);
  const row = {
    employee_id: employeeId,
    month,
    status: merged.status === "FINAL" ? "FINAL" : "DRAFT",
    source: HR_RECORD_SOURCES.includes(merged.source) ? merged.source : "MANUAL",
    notes: merged.notes || "",
    gross_earnings: merged.grossEarnings,
    total_deductions: merged.totalDeductions,
    net_pay: merged.netPay,
    ...extra,
  };
  for (const key of HR_NUMBER_FIELDS) row[SNAKE(key)] = merged[key];
  return row;
}

export function rowToMonthlyRecord(row = {}) {
  const record = {
    id: row.id || "",
    employeeId: row.employee_id || "",
    month: row.month || "",
    status: row.status || "DRAFT",
    source: row.source || "MANUAL",
    notes: row.notes || "",
    finalizedAt: row.finalized_at || null,
    updatedAt: row.updated_at || null,
  };
  for (const key of HR_NUMBER_FIELDS) record[key] = Number(row[SNAKE(key)] || 0);
  return {
    ...record,
    grossEarnings: Number(row.gross_earnings || 0),
    totalDeductions: Number(row.total_deductions || 0),
    netPay: Number(row.net_pay || 0),
  };
}

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------

function headerToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

const EMPLOYEE_CODE_ALIASES = ["employeecode", "empcode", "code", "employeeid", "empid", "staffcode", "رقمالموظف", "كودالموظف"];
const NOTES_ALIASES = ["notes", "remarks", "remark", "ملاحظات"];

const FIELD_ALIASES = (() => {
  const map = new Map();
  for (const alias of EMPLOYEE_CODE_ALIASES) map.set(alias, "employeeCode");
  for (const alias of NOTES_ALIASES) map.set(alias, "notes");
  for (const key of HR_NUMBER_FIELDS) {
    map.set(headerToken(key), key);
    map.set(headerToken(SNAKE(key)), key);
    map.set(headerToken(HR_FIELD_LABELS[key].en), key);
    map.set(headerToken(HR_FIELD_LABELS[key].ar), key);
  }
  map.set("basic", "basicSalary");
  map.set("housing", "housingAllowance");
  map.set("transport", "transportAllowance");
  map.set("overtime", "overtimeAmount");
  map.set("bonus", "bonusAmount");
  map.set("commission", "commissionAmount");
  map.set("absence", "absenceDeduction");
  map.set("loan", "loanDeduction");
  map.set("advance", "advanceDeduction");
  map.set("penalty", "penaltyDeduction");
  map.set("holidays", "holidayDays");
  map.set("fridays", "holidayDays");
  return map;
})();

export function resolveHrImportHeader(header) {
  return FIELD_ALIASES.get(headerToken(header)) || null;
}

/** Column order of the downloadable Excel template. */
export const HR_MONTHLY_TEMPLATE_HEADERS = [
  "Employee Code",
  ...HR_NUMBER_FIELDS.map((key) => HR_FIELD_LABELS[key].en),
  "Notes",
];

export function buildHrMonthlyTemplateRows(employees = []) {
  return (employees || []).map((employee) => {
    const defaults = defaultMonthlyRecordForEmployee(employee);
    const row = { "Employee Code": employee.employeeCode };
    for (const key of HR_NUMBER_FIELDS) row[HR_FIELD_LABELS[key].en] = defaults[key];
    row.Notes = "";
    return row;
  });
}

/**
 * Turn spreadsheet rows (objects keyed by the file's own headers) into record patches.
 * Unknown headers are ignored; a missing column leaves that field untouched on merge.
 * Returns { items: [{ rowNumber, employeeId, employeeCode, patch }], errors: [{ rowNumber, message }] }.
 */
export function parseHrMonthlyImportRows(rows = [], { employees = [] } = {}) {
  const byCode = new Map(
    (employees || []).map((employee) => [normalizeEmployeeCode(employee.employeeCode), employee]),
  );
  const items = [];
  const errors = [];
  const seen = new Set();

  (rows || []).forEach((rawRow, index) => {
    const rowNumber = index + 2; // header is row 1
    if (!rawRow || typeof rawRow !== "object") return;
    const mapped = {};
    for (const [header, cell] of Object.entries(rawRow)) {
      const key = resolveHrImportHeader(header);
      if (key) mapped[key] = cell;
    }
    const code = normalizeEmployeeCode(mapped.employeeCode);
    const hasData = Object.entries(mapped).some(([key, cell]) => key !== "employeeCode" && String(cell ?? "").trim() !== "");
    if (!code && !hasData) return; // blank spacer row
    if (!code) {
      errors.push({ rowNumber, message: "Employee code is missing." });
      return;
    }
    const employee = byCode.get(code);
    if (!employee) {
      errors.push({ rowNumber, employeeCode: code, message: `Employee ${code} is not in the staff list.` });
      return;
    }
    if (seen.has(code)) {
      errors.push({ rowNumber, employeeCode: code, message: `Employee ${code} appears more than once.` });
      return;
    }
    seen.add(code);

    const { employeeCode: _code, ...fields } = mapped;
    const { value, errors: fieldErrors } = normalizeMonthlyRecordInput(fields, { partial: true });
    if (fieldErrors.length) {
      errors.push({ rowNumber, employeeCode: code, message: fieldErrors.join(" ") });
      return;
    }
    items.push({ rowNumber, employeeId: employee.id, employeeCode: code, patch: value });
  });

  return { items, errors };
}

// ---------------------------------------------------------------------------
// Attendance prefill
// ---------------------------------------------------------------------------

/**
 * Own HR ledger numbers from My Day attendance rows for the 26th–25th payroll period.
 * Fridays are holidays. Approved leave turns a no-login day into leave instead of absence.
 * Half days start at 0 (editable after Prefill). Pass fromDate/toDate for the cycle;
 * `month` alone still uses the calendar month for older callers.
 */
export function buildAttendanceFromLedger({
  month = "",
  fromDate = "",
  toDate = "",
  reportRows = [],
  leaveDates = new Set(),
} = {}) {
  let allDates;
  if (fromDate && toDate) {
    allDates = listHrPayrollPeriodDates(fromDate, toDate);
  } else {
    if (!isValidHrMonth(month)) throw new Error("Invalid month. Use YYYY-MM.");
    allDates = listKsaMonthDates(month);
  }
  const holidayDays = allDates.filter((date) => isKsaFriday(date)).length;
  const workingDays = allDates.length - holidayDays;
  const periodSet = new Set(allDates);

  let presentDays = 0;
  let absentDays = 0;
  const leaveCounted = new Set();
  for (const row of reportRows || []) {
    const date = String(row?.date || "");
    if (!date || !periodSet.has(date) || isKsaFriday(date)) continue;
    if (row.attended) {
      presentDays += 1;
    } else if (leaveDates.has(date)) {
      leaveCounted.add(date);
    } else {
      absentDays += 1;
    }
  }
  for (const date of leaveDates) {
    if (periodSet.has(date) && !isKsaFriday(date)) leaveCounted.add(date);
  }

  return {
    workingDays,
    presentDays,
    absentDays,
    halfDays: 0,
    leaveDays: leaveCounted.size,
    holidayDays,
  };
}

// ---------------------------------------------------------------------------
// Payroll summary
// ---------------------------------------------------------------------------

/** One row per month: staff count, gross, deductions, net, FINAL/DRAFT counts. */
export function summarizePayrollByMonth(records = []) {
  const buckets = new Map();
  for (const record of records || []) {
    const month = String(record.month || "");
    if (!month) continue;
    const bucket = buckets.get(month) || {
      month,
      employeeCount: 0,
      grossEarnings: 0,
      totalDeductions: 0,
      netPay: 0,
      finalCount: 0,
      draftCount: 0,
    };
    bucket.employeeCount += 1;
    bucket.grossEarnings += Number(record.grossEarnings || 0);
    bucket.totalDeductions += Number(record.totalDeductions || 0);
    bucket.netPay += Number(record.netPay || 0);
    if (record.status === "FINAL") bucket.finalCount += 1;
    else bucket.draftCount += 1;
    buckets.set(month, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((bucket) => ({
      ...bucket,
      grossEarnings: roundHrMoney(bucket.grossEarnings),
      totalDeductions: roundHrMoney(bucket.totalDeductions),
      netPay: roundHrMoney(bucket.netPay),
    }));
}

/** Department split for one month. `employeesById` is a Map or plain object of employees. */
export function summarizePayrollByDepartment(records = [], employeesById = {}, month = "") {
  const lookup = (id) => (employeesById instanceof Map ? employeesById.get(id) : employeesById?.[id]);
  const buckets = new Map();
  for (const record of records || []) {
    if (month && record.month !== month) continue;
    const department = String(lookup(record.employeeId)?.department || "").trim() || "—";
    const bucket = buckets.get(department) || {
      department,
      employeeCount: 0,
      grossEarnings: 0,
      totalDeductions: 0,
      netPay: 0,
    };
    bucket.employeeCount += 1;
    bucket.grossEarnings += Number(record.grossEarnings || 0);
    bucket.totalDeductions += Number(record.totalDeductions || 0);
    bucket.netPay += Number(record.netPay || 0);
    buckets.set(department, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.department.localeCompare(right.department))
    .map((bucket) => ({
      ...bucket,
      grossEarnings: roundHrMoney(bucket.grossEarnings),
      totalDeductions: roundHrMoney(bucket.totalDeductions),
      netPay: roundHrMoney(bucket.netPay),
    }));
}

/** Last N months ending at `endMonth`, oldest first. */
export function listHrMonthsBack(endMonth, count = 6) {
  if (!isValidHrMonth(endMonth)) throw new Error("Invalid month. Use YYYY-MM.");
  const [year, month] = endMonth.split("-").map(Number);
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}
