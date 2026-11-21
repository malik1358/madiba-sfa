import test from "node:test";
import assert from "node:assert/strict";

import {
  canReadHr,
  canReadHrPayrollSummary,
  canWriteHr,
  checkHrAccess,
} from "../app/lib/hr/hrAccess.js";
import {
  employeeMonthlyPackage,
  employeeToRow,
  findProfileLinkConflict,
  normalizeEmployeeInput,
  rowToEmployee,
  summarizeEmployees,
} from "../app/lib/hr/hrEmployees.js";
import {
  approvedLeaveDatesInMonth,
  countLeaveDays,
  findLeaveOverlap,
  leaveDaysInMonth,
  normalizeLeaveInput,
} from "../app/lib/hr/hrLeave.js";

test("only admin and manager can write HR; report-user is read-only", () => {
  for (const role of ["admin", "manager", "Manager"]) assert.equal(canWriteHr(role), true, role);
  for (const role of ["report-user", "report_user", "invoice-maker", "salesman", "collector", "", null]) {
    assert.equal(canWriteHr(role), false, String(role));
  }
  assert.equal(canReadHr("report-user"), true);
  assert.equal(canReadHr("report_user"), true);
  assert.equal(canReadHr("invoice-maker"), false);
  assert.equal(canReadHr("salesman"), false);
});

test("payroll summary also opens for invoice-maker and management report viewers", () => {
  for (const role of ["admin", "report-user", "manager", "invoice-maker", "invoice_maker"]) {
    assert.equal(canReadHrPayrollSummary(role), true, role);
  }
  for (const role of ["salesman", "collector", "product-promoter"]) {
    assert.equal(canReadHrPayrollSummary(role), false, role);
  }
  assert.equal(checkHrAccess("report-user", "write").ok, false);
  assert.equal(checkHrAccess("report-user", "write").status, 403);
  assert.equal(checkHrAccess("invoice-maker", "payroll").ok, true);
  assert.equal(checkHrAccess("invoice-maker", "read").ok, false);
  assert.equal(checkHrAccess("manager", "write").ok, true);
});

test("employee input is trimmed, code uppercased, and validated", () => {
  const { value, errors } = normalizeEmployeeInput({
    employeeCode: " e001 ",
    fullName: "  Ahmed Ali ",
    basicSalary: "3,500.505",
    housingAllowance: "875",
    status: "active",
    joinDate: "2024-03-01",
  });
  assert.deepEqual(errors, []);
  assert.equal(value.employeeCode, "E001");
  assert.equal(value.fullName, "Ahmed Ali");
  assert.equal(value.basicSalary, 3500.51);
  assert.equal(value.status, "ACTIVE");
  assert.equal(value.profileId, null);
  assert.equal(employeeMonthlyPackage(value), 4375.51);
});

test("employee validation rejects missing code/name, bad money, status and dates", () => {
  const { errors } = normalizeEmployeeInput({
    employeeCode: "",
    fullName: "",
    basicSalary: "-5",
    housingAllowance: "abc",
    status: "GONE",
    joinDate: "01/03/2024",
    profileId: "not-a-uuid",
  });
  assert.ok(errors.some((message) => /code is required/i.test(message)));
  assert.ok(errors.some((message) => /name is required/i.test(message)));
  assert.ok(errors.some((message) => message.startsWith("basicSalary")));
  assert.ok(errors.some((message) => message.startsWith("housingAllowance")));
  assert.ok(errors.some((message) => /ACTIVE or INACTIVE/.test(message)));
  assert.ok(errors.some((message) => /Join date/.test(message)));
  assert.ok(errors.some((message) => /profile/i.test(message)));
});

test("employee row mapping round-trips", () => {
  const { value } = normalizeEmployeeInput({
    employeeCode: "e002",
    fullName: "Sara",
    fullNameAr: "سارة",
    profileId: "11111111-1111-1111-1111-111111111111",
    department: "Finance",
    basicSalary: 5000,
    transportAllowance: 300,
  });
  const row = employeeToRow(value);
  assert.equal(row.employee_code, "E002");
  assert.equal(row.profile_id, "11111111-1111-1111-1111-111111111111");
  const employee = rowToEmployee({ ...row, id: "abc" });
  assert.equal(employee.id, "abc");
  assert.equal(employee.fullNameAr, "سارة");
  assert.equal(employee.transportAllowance, 300);
  assert.equal(employee.profileId, "11111111-1111-1111-1111-111111111111");
});

test("a profile can only be linked to one staff row", () => {
  const employees = [
    { id: "a", employeeCode: "E1", profileId: "p1" },
    { id: "b", employeeCode: "E2", profileId: null },
  ];
  assert.equal(findProfileLinkConflict(employees, { profileId: "p1" })?.employeeCode, "E1");
  assert.equal(findProfileLinkConflict(employees, { profileId: "p1", excludeId: "a" }), null);
  assert.equal(findProfileLinkConflict(employees, { profileId: null }), null);
});

test("employee summary counts active, linked and monthly package", () => {
  const summary = summarizeEmployees([
    { status: "ACTIVE", profileId: "p", basicSalary: 1000, housingAllowance: 250 },
    { status: "ACTIVE", profileId: null, basicSalary: 2000 },
    { status: "INACTIVE", profileId: null, basicSalary: 9999 },
  ]);
  assert.deepEqual(summary, { total: 3, active: 2, inactive: 1, linked: 1, monthlyPackage: 3250 });
});

test("leave days skip Fridays (2026-11-20 is a Friday)", () => {
  // Thu 19, Fri 20, Sat 21
  assert.equal(countLeaveDays("2026-11-19", "2026-11-21"), 2);
  // A lone Friday has no working days.
  assert.equal(countLeaveDays("2026-11-20", "2026-11-20"), 0);
  assert.equal(countLeaveDays("2026-11-22", "2026-11-21"), 0);
});

test("leave input validates ranges and computes days", () => {
  const ok = normalizeLeaveInput({
    employeeId: "e1",
    leaveType: "sick",
    startDate: "2026-11-15",
    endDate: "2026-11-21",
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.leaveType, "SICK");
  assert.equal(ok.value.days, 6); // 7 calendar days minus Friday 20th

  assert.ok(normalizeLeaveInput({ employeeId: "e1", startDate: "2026-11-21", endDate: "2026-11-15" }).errors.length);
  assert.ok(normalizeLeaveInput({ employeeId: "e1", startDate: "2026-11-20", endDate: "2026-11-20" }).errors.length);
  assert.ok(normalizeLeaveInput({ employeeId: "", startDate: "2026-11-15", endDate: "2026-11-16" }).errors.length);
  assert.ok(normalizeLeaveInput({ employeeId: "e", leaveType: "WAT", startDate: "2026-11-15", endDate: "2026-11-16" }).errors.length);
});

test("overlapping leave is detected except rejected entries and self", () => {
  const entries = [
    { id: "1", employeeId: "e1", status: "APPROVED", startDate: "2026-11-10", endDate: "2026-11-12" },
    { id: "2", employeeId: "e1", status: "REJECTED", startDate: "2026-11-20", endDate: "2026-11-25" },
    { id: "3", employeeId: "e2", status: "APPROVED", startDate: "2026-11-15", endDate: "2026-11-18" },
  ];
  assert.equal(findLeaveOverlap(entries, { employeeId: "e1", status: "APPROVED", startDate: "2026-11-12", endDate: "2026-11-14" })?.id, "1");
  assert.equal(findLeaveOverlap(entries, { employeeId: "e1", status: "APPROVED", startDate: "2026-11-21", endDate: "2026-11-22" }), null);
  assert.equal(findLeaveOverlap(entries, { id: "1", employeeId: "e1", status: "APPROVED", startDate: "2026-11-10", endDate: "2026-11-12" }), null);
  assert.equal(findLeaveOverlap(entries, { employeeId: "e1", status: "APPROVED", startDate: "2026-11-16", endDate: "2026-11-17" }), null);
});

test("approved leave dates in a month exclude Fridays, other months and non-approved", () => {
  const entries = [
    { status: "APPROVED", startDate: "2026-10-30", endDate: "2026-11-02" }, // Oct 30 (Fri), Oct 31, Nov 1, Nov 2
    { status: "PENDING", startDate: "2026-11-10", endDate: "2026-11-12" },
    { status: "APPROVED", startDate: "2026-11-19", endDate: "2026-11-21" }, // Fri 20 excluded
  ];
  const dates = approvedLeaveDatesInMonth(entries, "2026-11");
  assert.deepEqual([...dates].sort(), ["2026-11-01", "2026-11-02", "2026-11-19", "2026-11-21"]);
  assert.equal(leaveDaysInMonth(entries, "2026-11"), 4);
});
