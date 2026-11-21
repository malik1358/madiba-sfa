import { createClient } from "@supabase/supabase-js";
import { isMissingRelationError } from "../schemaGuards.js";
import { buildMonthlyAttendanceReportForUser } from "../monthlyAttendanceReportServer.js";
import { getKsaDateString } from "../workdayActivity.js";
import { checkHrAccess } from "./hrAccess.js";
import { rowToEmployee } from "./hrEmployees.js";
import { approvedLeaveDatesInMonth, rowToLeave } from "./hrLeave.js";
import { buildAttendanceFromLedger, rowToMonthlyRecord } from "./hrMonthlyFeed.js";

export class HrHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const HR_MIGRATION_MESSAGE =
  "HR tables are not migrated yet. Apply supabase/migrations/20261120120000_hr_management.sql.";

export function createHrAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HrHttpError(500, "Server configuration is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verify the caller's bearer token, load the profile, and enforce the HR gate. */
export async function authenticateHr(request, need = "read") {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new HrHttpError(401, "No authorization header provided");

  const admin = createHrAdminClient();
  const { data: { user }, error: userError } = await admin.auth.getUser(header.slice(7));
  if (userError || !user) throw new HrHttpError(401, "Unable to verify user session");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new HrHttpError(403, "No profile found for this user");

  const gate = checkHrAccess(profile.role, need);
  if (!gate.ok) throw new HrHttpError(gate.status, gate.error);
  return { admin, user, profile };
}

export function hrErrorResponse(error) {
  if (error instanceof HrHttpError) {
    return Response.json({ success: false, error: error.message }, { status: error.status });
  }
  if (isMissingRelationError(error)) {
    return Response.json({ success: false, error: HR_MIGRATION_MESSAGE, migrationRequired: true }, { status: 503 });
  }
  return Response.json(
    { success: false, error: error?.message || "HR request failed" },
    { status: 400 },
  );
}

export async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new HrHttpError(400, "Invalid JSON body");
  }
}

export async function loadHrEmployees(admin, { includeInactive = true } = {}) {
  let query = admin.from("hr_employees").select("*").order("employee_code", { ascending: true });
  if (!includeInactive) query = query.eq("status", "ACTIVE");
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToEmployee);
}

export async function loadHrMonthlyRecords(admin, { month = "", fromMonth = "", toMonth = "" } = {}) {
  let query = admin.from("hr_monthly_records").select("*").order("month", { ascending: true });
  if (month) query = query.eq("month", month);
  if (fromMonth) query = query.gte("month", fromMonth);
  if (toMonth) query = query.lte("month", toMonth);
  const { data, error } = await query.limit(20000);
  if (error) throw error;
  return (data || []).map(rowToMonthlyRecord);
}

export async function loadHrLeaveEntries(admin, { employeeId = "", fromDate = "", toDate = "" } = {}) {
  let query = admin.from("hr_leave_entries").select("*").order("start_date", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  // Overlap with [fromDate, toDate].
  if (fromDate) query = query.gte("end_date", fromDate);
  if (toDate) query = query.lte("start_date", toDate);
  const { data, error } = await query.limit(5000);
  if (error) throw error;
  return (data || []).map(rowToLeave);
}

/** Linked profiles that could be attached to a staff row (management picks from this). */
export async function loadLinkableProfiles(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,is_active")
    .order("salesman_name", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data || []).map((profile) => ({
    id: profile.id,
    role: profile.role || "",
    salesmanCode: profile.salesman_code || "",
    name: profile.salesman_name || profile.email || profile.id,
    email: profile.email || "",
    isActive: profile.is_active !== false,
  }));
}

/**
 * Attendance numbers for a linked employee from My Day's monthly attendance report.
 * Returns { ok: true, attendance } or { ok: false, reason } (not linked, not a field user,
 * or a future month) so one employee never blocks a bulk prefill.
 */
export async function buildHrAttendancePrefill(admin, employee, month, leaveEntries = []) {
  if (!employee?.profileId) return { ok: false, reason: "No linked profile." };
  try {
    const report = await buildMonthlyAttendanceReportForUser(admin, {
      userId: employee.profileId,
      month,
      today: getKsaDateString(),
    });
    const attendance = buildAttendanceFromLedger({
      month,
      reportRows: report.rows,
      leaveDates: approvedLeaveDatesInMonth(leaveEntries, month),
    });
    return { ok: true, attendance };
  } catch (error) {
    return { ok: false, reason: error?.message || "Attendance is not available." };
  }
}
