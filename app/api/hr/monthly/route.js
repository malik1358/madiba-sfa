import { canWriteHr } from "../../../lib/hr/hrAccess.js";
import {
  applyMasterPayAndAbsence,
  canOverwriteMonthlyRecord,
  canPrefillHrPayrollMonth,
  defaultMonthlyRecordForEmployee,
  hrPayrollPeriodForMonth,
  isValidHrMonth,
  mergeMonthlyRecord,
  monthlyRecordToRow,
  normalizeMonthlyRecordInput,
  parseHrMonthlyImportRows,
} from "../../../lib/hr/hrMonthlyFeed.js";
import {
  HrHttpError,
  authenticateHr,
  buildHrAttendancePrefill,
  hrErrorResponse,
  loadHrEmployees,
  loadHrLeaveEntries,
  loadHrMonthlyRecords,
  readJsonBody,
} from "../../../lib/hr/hrServer.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function requireMonth(value) {
  const month = String(value || "").trim();
  if (!isValidHrMonth(month)) throw new HrHttpError(400, "Invalid month. Use YYYY-MM.");
  return month;
}

function payrollLeaveBounds(month) {
  const period = hrPayrollPeriodForMonth(month);
  return { fromDate: period.fromDate, toDate: period.toDate };
}

export async function GET(request) {
  try {
    const { admin, profile } = await authenticateHr(request, "read");
    const month = requireMonth(new URL(request.url).searchParams.get("month"));
    const [employees, records] = await Promise.all([
      loadHrEmployees(admin),
      loadHrMonthlyRecords(admin, { month }),
    ]);
    return Response.json({ success: true, month, employees, records, canWrite: canWriteHr(profile.role) });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

/** Insert new rows and update existing DRAFT rows. FINAL rows are never touched here. */
async function persistRows(admin, { month, existingByEmployee, entries, actorId }) {
  const inserts = [];
  let saved = 0;
  for (const entry of entries) {
    const existing = existingByEmployee.get(entry.employee.id);
    const base = existing || defaultMonthlyRecordForEmployee(entry.employee);
    const merged = mergeMonthlyRecord(base, { ...entry.patch, source: entry.source || base.source });
    const row = monthlyRecordToRow(entry.employee.id, month, { ...merged, status: "DRAFT" });
    if (existing) {
      const { data, error } = await admin
        .from("hr_monthly_records")
        .update(row)
        .eq("id", existing.id)
        .eq("status", "DRAFT")
        .select("id");
      if (error) throw error;
      if (data?.length) saved += 1;
    } else {
      inserts.push({ ...row, created_by: actorId });
    }
  }
  if (inserts.length) {
    const { error } = await admin.from("hr_monthly_records").insert(inserts);
    if (error) throw error;
    saved += inserts.length;
  }
  return saved;
}

function existingMap(records) {
  return new Map(records.map((record) => [record.employeeId, record]));
}

async function actionSave(ctx, body) {
  const { admin, user } = ctx;
  const month = requireMonth(body.month);
  const employeeId = String(body.employeeId || "").trim();
  if (!employeeId) throw new HrHttpError(400, "Employee is required.");

  const employees = await loadHrEmployees(admin);
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) throw new HrHttpError(404, "Employee not found.");

  const records = await loadHrMonthlyRecords(admin, { month });
  const map = existingMap(records);
  const guard = canOverwriteMonthlyRecord(map.get(employeeId));
  if (!guard.ok) throw new HrHttpError(409, guard.reason);

  const { value, errors } = normalizeMonthlyRecordInput(body.record || {});
  if (errors.length) throw new HrHttpError(400, errors.join(" "));

  // Pin basic + transport from master; recompute absence from absent/half days.
  const patch = applyMasterPayAndAbsence(employee, value);

  const saved = await persistRows(admin, {
    month,
    existingByEmployee: map,
    entries: [{ employee, patch, source: "MANUAL" }],
    actorId: user.id,
  });
  if (!saved) throw new HrHttpError(409, "Record changed to FINAL. Reload and reopen it first.");
  const [record] = (await loadHrMonthlyRecords(admin, { month })).filter((item) => item.employeeId === employeeId);
  return { record };
}

async function actionImport(ctx, body) {
  const { admin, user } = ctx;
  const month = requireMonth(body.month);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new HrHttpError(400, "The file has no rows.");
  if (rows.length > 5000) throw new HrHttpError(400, "Too many rows (max 5000).");

  const employees = await loadHrEmployees(admin);
  const { items, errors } = parseHrMonthlyImportRows(rows, { employees });
  const map = existingMap(await loadHrMonthlyRecords(admin, { month }));
  const byId = new Map(employees.map((employee) => [employee.id, employee]));

  const skipped = [];
  const entries = [];
  for (const item of items) {
    const guard = canOverwriteMonthlyRecord(map.get(item.employeeId));
    if (!guard.ok) {
      skipped.push({ rowNumber: item.rowNumber, employeeCode: item.employeeCode, reason: guard.reason });
      continue;
    }
    entries.push({ employee: byId.get(item.employeeId), patch: item.patch, source: "IMPORT" });
  }
  const saved = await persistRows(admin, { month, existingByEmployee: map, entries, actorId: user.id });
  return { saved, skipped, errors };
}

async function actionPrefill(ctx, body) {
  const { admin, user } = ctx;
  const month = requireMonth(body.month);
  const gate = canPrefillHrPayrollMonth(month);
  if (!gate.ok) throw new HrHttpError(400, gate.reason);

  const wanted = Array.isArray(body.employeeIds) ? new Set(body.employeeIds.map(String)) : null;

  const employees = (await loadHrEmployees(admin, { includeInactive: false }))
    .filter((employee) => !wanted || wanted.has(employee.id));
  const map = existingMap(await loadHrMonthlyRecords(admin, { month }));
  const leaveEntries = await loadHrLeaveEntries(admin, payrollLeaveBounds(month));

  const entries = [];
  const skipped = [];
  for (const employee of employees) {
    const guard = canOverwriteMonthlyRecord(map.get(employee.id));
    if (!guard.ok) {
      skipped.push({ employeeCode: employee.employeeCode, reason: guard.reason });
      continue;
    }
    const result = await buildHrAttendancePrefill(
      admin,
      employee,
      month,
      leaveEntries.filter((entry) => entry.employeeId === employee.id),
    );
    if (!result.ok) {
      skipped.push({ employeeCode: employee.employeeCode, reason: result.reason });
      continue;
    }
    entries.push({
      employee,
      patch: result.attendance,
      source: map.has(employee.id) ? undefined : "PREFILL",
    });
  }
  const saved = await persistRows(admin, { month, existingByEmployee: map, entries, actorId: user.id });
  return {
    saved,
    skipped,
    period: { fromDate: gate.fromDate, toDate: gate.toDate },
  };
}

async function actionSetStatus(ctx, body, status) {
  const { admin, user } = ctx;
  const month = requireMonth(body.month);
  const wanted = Array.isArray(body.employeeIds) && body.employeeIds.length
    ? body.employeeIds.map(String)
    : null;
  const from = status === "FINAL" ? "DRAFT" : "FINAL";

  let query = admin
    .from("hr_monthly_records")
    .update(status === "FINAL"
      ? { status, finalized_at: new Date().toISOString(), finalized_by: user.id }
      : { status, finalized_at: null, finalized_by: null })
    .eq("month", month)
    .eq("status", from);
  if (wanted) query = query.in("employee_id", wanted);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return { changed: data?.length || 0 };
}

export async function POST(request) {
  try {
    const ctx = await authenticateHr(request, "write");
    const body = await readJsonBody(request);
    const action = String(body.action || "save").trim();
    let result;
    if (action === "save") result = await actionSave(ctx, body);
    else if (action === "import") result = await actionImport(ctx, body);
    else if (action === "prefill") result = await actionPrefill(ctx, body);
    else if (action === "finalize") result = await actionSetStatus(ctx, body, "FINAL");
    else if (action === "reopen") result = await actionSetStatus(ctx, body, "DRAFT");
    else throw new HrHttpError(400, "Unknown action.");
    return Response.json({ success: true, ...result });
  } catch (error) {
    return hrErrorResponse(error);
  }
}
