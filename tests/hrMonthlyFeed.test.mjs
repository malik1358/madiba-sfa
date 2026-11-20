import test from "node:test";
import assert from "node:assert/strict";

import {
  HR_MONTHLY_TEMPLATE_HEADERS,
  buildAttendanceFromLedger,
  buildHrMonthlyTemplateRows,
  canOverwriteMonthlyRecord,
  computeMonthlyTotals,
  defaultMonthlyRecordForEmployee,
  isValidHrMonth,
  listHrMonthsBack,
  mergeMonthlyRecord,
  monthlyRecordToRow,
  normalizeMonthlyRecordInput,
  parseHrMonthlyImportRows,
  resolveHrImportHeader,
  rowToMonthlyRecord,
  summarizePayrollByDepartment,
  summarizePayrollByMonth,
} from "../app/lib/hr/hrMonthlyFeed.js";
import { listKsaMonthDates } from "../app/lib/monthlyAttendanceReport.js";

const employees = [
  { id: "e1", employeeCode: "E001", fullName: "Ahmed", basicSalary: 4000, housingAllowance: 1000, transportAllowance: 500, otherAllowance: 0, department: "Sales" },
  { id: "e2", employeeCode: "E002", fullName: "Sara", basicSalary: 6000, housingAllowance: 1500, transportAllowance: 0, otherAllowance: 250, department: "Finance" },
];

test("net pay is the sum of earnings minus the sum of deductions", () => {
  const totals = computeMonthlyTotals({
    basicSalary: 4000,
    housingAllowance: 1000,
    transportAllowance: 500,
    overtimeAmount: 250.5,
    bonusAmount: 100,
    absenceDeduction: 133.33,
    loanDeduction: 500,
    penaltyDeduction: 50.25,
  });
  assert.equal(totals.grossEarnings, 5850.5);
  assert.equal(totals.totalDeductions, 683.58);
  assert.equal(totals.netPay, 5166.92);
});

test("net pay can go negative when deductions exceed earnings (no statutory engine)", () => {
  assert.equal(computeMonthlyTotals({ basicSalary: 100, loanDeduction: 250 }).netPay, -150);
});

test("a new month defaults earnings from the employee master", () => {
  const record = defaultMonthlyRecordForEmployee(employees[0]);
  assert.equal(record.basicSalary, 4000);
  assert.equal(record.housingAllowance, 1000);
  assert.equal(record.status, "DRAFT");
  assert.equal(record.grossEarnings, 5500);
  assert.equal(record.netPay, 5500);
  assert.equal(record.workingDays, 0);
});

test("record input rejects negative and non-numeric amounts; partial keeps only given keys", () => {
  const bad = normalizeMonthlyRecordInput({ basicSalary: "-1", bonusAmount: "abc" });
  assert.equal(bad.errors.length, 2);

  const partial = normalizeMonthlyRecordInput({ presentDays: "20", notes: " ok " }, { partial: true });
  assert.deepEqual(partial.errors, []);
  assert.deepEqual(partial.value, { presentDays: 20, notes: "ok" });

  const noNotes = normalizeMonthlyRecordInput({ presentDays: 1 }, { partial: true });
  assert.equal("notes" in noNotes.value, false);
});

test("merge recomputes totals and keeps untouched fields", () => {
  const base = defaultMonthlyRecordForEmployee(employees[0]);
  const merged = mergeMonthlyRecord(base, { loanDeduction: 500, presentDays: 25 });
  assert.equal(merged.basicSalary, 4000);
  assert.equal(merged.presentDays, 25);
  assert.equal(merged.totalDeductions, 500);
  assert.equal(merged.netPay, 5000);
});

test("FINAL rows are protected from overwrite until reopened", () => {
  assert.equal(canOverwriteMonthlyRecord(null).ok, true);
  assert.equal(canOverwriteMonthlyRecord({ status: "DRAFT" }).ok, true);
  const final = canOverwriteMonthlyRecord({ status: "FINAL" });
  assert.equal(final.ok, false);
  assert.match(final.reason, /Reopen/);
});

test("monthly row mapping round-trips and stores computed totals", () => {
  const record = mergeMonthlyRecord(defaultMonthlyRecordForEmployee(employees[1]), { advanceDeduction: 750, source: "IMPORT" });
  const row = monthlyRecordToRow("e2", "2026-11", record);
  assert.equal(row.employee_id, "e2");
  assert.equal(row.month, "2026-11");
  assert.equal(row.status, "DRAFT");
  assert.equal(row.source, "IMPORT");
  assert.equal(row.advance_deduction, 750);
  assert.equal(row.gross_earnings, 7750);
  assert.equal(row.net_pay, 7000);
  const back = rowToMonthlyRecord({ ...row, id: "r1" });
  assert.equal(back.netPay, 7000);
  assert.equal(back.advanceDeduction, 750);
  assert.equal(back.employeeId, "e2");
});

test("month validation and month-back listing", () => {
  assert.equal(isValidHrMonth("2026-11"), true);
  assert.equal(isValidHrMonth("2026-13"), false);
  assert.equal(isValidHrMonth("2026-1"), false);
  assert.deepEqual(listHrMonthsBack("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("import headers accept template labels, camelCase, snake_case and aliases", () => {
  assert.equal(resolveHrImportHeader("Employee Code"), "employeeCode");
  assert.equal(resolveHrImportHeader("emp code"), "employeeCode");
  assert.equal(resolveHrImportHeader("Basic salary"), "basicSalary");
  assert.equal(resolveHrImportHeader("loan_deduction"), "loanDeduction");
  assert.equal(resolveHrImportHeader("overtimeHours"), "overtimeHours");
  assert.equal(resolveHrImportHeader("Holidays (Fri)"), "holidayDays");
  assert.equal(resolveHrImportHeader("الراتب الأساسي"), "basicSalary");
  assert.equal(resolveHrImportHeader("Favourite colour"), null);
  for (const header of HR_MONTHLY_TEMPLATE_HEADERS) {
    assert.ok(resolveHrImportHeader(header), `template header ${header} must be importable`);
  }
});

test("template rows are pre-filled from the staff list and re-import cleanly", () => {
  const rows = buildHrMonthlyTemplateRows(employees);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Employee Code"], "E001");
  assert.equal(rows[0]["Basic salary"], 4000);
  const { items, errors } = parseHrMonthlyImportRows(rows, { employees });
  assert.deepEqual(errors, []);
  assert.equal(items.length, 2);
});

test("import maps rows to employees, skips blanks, and reports row errors", () => {
  const { items, errors } = parseHrMonthlyImportRows([
    { "Employee Code": "e001", "Bonus": "250", "Loan deduction": "100", "Present days": 24, Remarks: "Eid bonus" },
    { "Employee Code": "", Bonus: "" }, // spacer row
    { "Employee Code": "E999", Bonus: "5" },
    { "Employee Code": "E002", Bonus: "-5" },
    { "Employee Code": "E001", Bonus: "1" }, // duplicate
    { Bonus: "10" }, // no code but data
  ], { employees });

  assert.equal(items.length, 1);
  assert.equal(items[0].employeeId, "e1");
  assert.deepEqual(items[0].patch, { bonusAmount: 250, loanDeduction: 100, presentDays: 24, notes: "Eid bonus" });
  assert.equal(items[0].rowNumber, 2);

  assert.equal(errors.length, 4);
  assert.ok(errors.some((error) => /E999/.test(error.message)));
  assert.ok(errors.some((error) => error.employeeCode === "E002" && /non-negative/.test(error.message)));
  assert.ok(errors.some((error) => /more than once/.test(error.message)));
  assert.ok(errors.some((error) => /missing/i.test(error.message)));
});

test("imported patch only changes provided columns when merged onto a draft", () => {
  const { items } = parseHrMonthlyImportRows([{ "Employee Code": "E001", "Bonus": "300" }], { employees });
  const existing = mergeMonthlyRecord(defaultMonthlyRecordForEmployee(employees[0]), { loanDeduction: 200, presentDays: 20 });
  const merged = mergeMonthlyRecord(existing, items[0].patch);
  assert.equal(merged.loanDeduction, 200);
  assert.equal(merged.presentDays, 20);
  assert.equal(merged.bonusAmount, 300);
  assert.equal(merged.netPay, 5500 + 300 - 200);
});

test("Fridays are holidays in the attendance ledger (Nov 2026 has 4 Fridays)", () => {
  const dates = listKsaMonthDates("2026-11");
  const reportRows = dates.map((date) => ({ date, attended: false }));
  const attendance = buildAttendanceFromLedger({ month: "2026-11", reportRows });
  assert.equal(attendance.holidayDays, 4);
  assert.equal(attendance.workingDays, 26);
  assert.equal(attendance.presentDays, 0);
  assert.equal(attendance.absentDays, 26);
  assert.equal(attendance.leaveDays, 0);
});

test("attendance ledger: present days, approved leave and absence; Friday logins do not count", () => {
  const reportRows = [
    { date: "2026-11-15", attended: true },
    { date: "2026-11-16", attended: true },
    { date: "2026-11-17", attended: false }, // leave
    { date: "2026-11-18", attended: false }, // absent
    { date: "2026-11-19", attended: true },
    { date: "2026-11-20", attended: true }, // Friday login ignored
  ];
  const attendance = buildAttendanceFromLedger({
    month: "2026-11",
    reportRows,
    leaveDates: new Set(["2026-11-17", "2026-11-24"]), // 24th is a future leave day
  });
  assert.equal(attendance.presentDays, 3);
  assert.equal(attendance.absentDays, 1);
  assert.equal(attendance.leaveDays, 2);
  assert.equal(attendance.holidayDays, 4);
  assert.equal(attendance.workingDays, 26);
  assert.throws(() => buildAttendanceFromLedger({ month: "bad" }), /Invalid month/);
});

test("payroll summary groups by month and department with FINAL/DRAFT counts", () => {
  const records = [
    { employeeId: "e1", month: "2026-10", status: "FINAL", grossEarnings: 5500, totalDeductions: 100, netPay: 5400 },
    { employeeId: "e2", month: "2026-10", status: "FINAL", grossEarnings: 7750, totalDeductions: 0, netPay: 7750 },
    { employeeId: "e1", month: "2026-11", status: "DRAFT", grossEarnings: 5500, totalDeductions: 500.5, netPay: 4999.5 },
    { employeeId: "e2", month: "2026-11", status: "FINAL", grossEarnings: 7750, totalDeductions: 0, netPay: 7750 },
  ];
  const months = summarizePayrollByMonth(records);
  assert.deepEqual(months.map((row) => row.month), ["2026-10", "2026-11"]);
  assert.equal(months[0].netPay, 13150);
  assert.equal(months[1].totalDeductions, 500.5);
  assert.equal(months[1].finalCount, 1);
  assert.equal(months[1].draftCount, 1);

  const byDept = summarizePayrollByDepartment(records, new Map(employees.map((employee) => [employee.id, employee])), "2026-11");
  assert.deepEqual(byDept.map((row) => [row.department, row.netPay]), [["Finance", 7750], ["Sales", 4999.5]]);
});
