import { canWriteHr } from "../../../lib/hr/hrAccess.js";
import {
  employeeToRow,
  findProfileLinkConflict,
  normalizeEmployeeInput,
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

export const maxDuration = 30;
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

async function saveEmployee(request, { update }) {
  const { admin, user } = await authenticateHr(request, "write");
  const body = await readJsonBody(request);
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

export async function POST(request) {
  try {
    return await saveEmployee(request, { update: false });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

export async function PUT(request) {
  try {
    return await saveEmployee(request, { update: true });
  } catch (error) {
    return hrErrorResponse(error);
  }
}
