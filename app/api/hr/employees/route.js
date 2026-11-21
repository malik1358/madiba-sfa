import { canWriteHr } from "../../../lib/hr/hrAccess.js";
import {
  employeeToRow,
  findProfileLinkConflict,
  normalizeEmployeeInput,
  planHierarchyStaffSync,
  rowToEmployee,
  summarizeEmployees,
} from "../../../lib/hr/hrEmployees.js";
import {
  HrHttpError,
  authenticateHr,
  hrErrorResponse,
  loadHrEmployees,
  loadLinkableProfiles,
  readJsonBody,
} from "../../../lib/hr/hrServer.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { admin, profile } = await authenticateHr(request, "read");
    const employees = await loadHrEmployees(admin);
    const profiles = await loadLinkableProfiles(admin);
    return Response.json({
      success: true,
      employees,
      profiles,
      summary: summarizeEmployees(employees),
      canWrite: canWriteHr(profile.role),
    });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

async function upsertEmployee(admin, user, body, { update }) {
  const { value, errors } = normalizeEmployeeInput(body);
  if (errors.length) throw new HrHttpError(400, errors.join(" "));

  const id = String(body.id || "").trim();
  if (update && !id) throw new HrHttpError(400, "Employee id is required.");

  const employees = await loadHrEmployees(admin);
  const codeClash = employees.find(
    (employee) => employee.employeeCode === value.employeeCode && employee.id !== id,
  );
  if (codeClash) throw new HrHttpError(409, `Employee code ${value.employeeCode} already exists.`);
  const profileClash = findProfileLinkConflict(employees, { profileId: value.profileId, excludeId: id });
  if (profileClash) {
    throw new HrHttpError(409, `That profile is already linked to ${profileClash.employeeCode}.`);
  }

  const row = employeeToRow(value);
  const query = update
    ? admin.from("hr_employees").update(row).eq("id", id)
    : admin.from("hr_employees").insert({ ...row, created_by: user.id });
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HrHttpError(404, "Employee not found.");
  return Response.json({ success: true, employee: rowToEmployee(data) });
}

async function syncFromHierarchy(admin, user) {
  const profiles = await loadLinkableProfiles(admin);
  const employees = await loadHrEmployees(admin);
  const plan = planHierarchyStaffSync(profiles, employees);

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const draft of plan.creates) {
    const { value, errors: validationErrors } = normalizeEmployeeInput(draft);
    if (validationErrors.length) {
      errors.push({ employeeCode: draft.employeeCode, error: validationErrors.join(" ") });
      continue;
    }
    const { error } = await admin
      .from("hr_employees")
      .insert({ ...employeeToRow(value), created_by: user.id });
    if (error) {
      errors.push({ employeeCode: draft.employeeCode, error: error.message || "Insert failed" });
      continue;
    }
    created += 1;
  }

  for (const draft of plan.updates) {
    const { value, errors: validationErrors } = normalizeEmployeeInput(draft);
    if (validationErrors.length) {
      errors.push({ employeeCode: draft.employeeCode, error: validationErrors.join(" ") });
      continue;
    }
    const { error } = await admin
      .from("hr_employees")
      .update(employeeToRow(value))
      .eq("id", draft.id);
    if (error) {
      errors.push({ employeeCode: draft.employeeCode, error: error.message || "Update failed" });
      continue;
    }
    updated += 1;
  }

  const nextEmployees = await loadHrEmployees(admin);
  return Response.json({
    success: true,
    created,
    updated,
    skipped: plan.summary.skipped,
    considered: plan.summary.considered,
    errors,
    employees: nextEmployees,
    profiles,
    summary: summarizeEmployees(nextEmployees),
  });
}

export async function POST(request) {
  try {
    const { admin, user } = await authenticateHr(request, "write");
    const body = await readJsonBody(request);
    const action = String(body?.action || "").trim().toLowerCase();
    if (action === "sync-from-hierarchy" || action === "pull-salesman-hierarchy") {
      return await syncFromHierarchy(admin, user);
    }
    return await upsertEmployee(admin, user, body, { update: false });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

export async function PUT(request) {
  try {
    const { admin, user } = await authenticateHr(request, "write");
    const body = await readJsonBody(request);
    return await upsertEmployee(admin, user, body, { update: true });
  } catch (error) {
    return hrErrorResponse(error);
  }
}
