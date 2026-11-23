import { canWriteHr } from "../../../lib/hr/hrAccess.js";
import {
  findLeaveOverlap,
  leaveToRow,
  normalizeLeaveInput,
  parseHrLeaveImportRows,
  rowToLeave,
} from "../../../lib/hr/hrLeave.js";
import { isValidHrMonth } from "../../../lib/hr/hrMonthlyFeed.js";
import {
  HrHttpError,
  authenticateHr,
  hrErrorResponse,
  loadHrEmployees,
  loadHrLeaveEntries,
  readJsonBody,
} from "../../../lib/hr/hrServer.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function monthBounds(month) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, "0")}` };
}

export async function GET(request) {
  try {
    const { admin, profile } = await authenticateHr(request, "read");
    const url = new URL(request.url);
    const month = String(url.searchParams.get("month") || "").trim();
    const employeeId = String(url.searchParams.get("employeeId") || "").trim();
    if (month && !isValidHrMonth(month)) throw new HrHttpError(400, "Invalid month. Use YYYY-MM.");

    const [employees, entries] = await Promise.all([
      loadHrEmployees(admin),
      loadHrLeaveEntries(admin, { employeeId, ...(month ? monthBounds(month) : {}) }),
    ]);
    return Response.json({ success: true, employees, entries, canWrite: canWriteHr(profile.role) });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

async function saveLeave(request, { update }) {
  const { admin, user } = await authenticateHr(request, "write");
  const body = await readJsonBody(request);
  const { value, errors } = normalizeLeaveInput(body);
  if (errors.length) throw new HrHttpError(400, errors.join(" "));

  const id = String(body.id || "").trim();
  if (update && !id) throw new HrHttpError(400, "Leave id is required.");

  const existing = await loadHrLeaveEntries(admin, {
    employeeId: value.employeeId,
    fromDate: value.startDate,
    toDate: value.endDate,
  });
  const clash = findLeaveOverlap(existing, { ...value, id });
  if (clash) {
    throw new HrHttpError(409, `Overlaps leave ${clash.startDate} to ${clash.endDate} for this employee.`);
  }

  const row = leaveToRow(value);
  const query = update
    ? admin.from("hr_leave_entries").update(row).eq("id", id)
    : admin.from("hr_leave_entries").insert({ ...row, created_by: user.id });
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new HrHttpError(404, "Leave entry not found.");
  return Response.json({ success: true, entry: rowToLeave(data) });
}

async function importHistoricLeave(admin, user, rows) {
  if (!rows.length) throw new HrHttpError(400, "The file has no rows.");
  if (rows.length > 5000) throw new HrHttpError(400, "Too many rows (max 5000).");

  const employees = await loadHrEmployees(admin);
  const { items, errors } = parseHrLeaveImportRows(rows, { employees });
  let saved = 0;
  const skipped = [];

  for (const item of items) {
    const existing = await loadHrLeaveEntries(admin, {
      employeeId: item.value.employeeId,
      fromDate: item.value.startDate,
      toDate: item.value.endDate,
    });
    const clash = findLeaveOverlap(existing, item.value);
    if (clash) {
      skipped.push({
        rowNumber: item.rowNumber,
        employeeCode: item.employeeCode,
        reason: `Overlaps leave ${clash.startDate} to ${clash.endDate}`,
      });
      continue;
    }
    const { error } = await admin
      .from("hr_leave_entries")
      .insert({ ...leaveToRow(item.value), created_by: user.id });
    if (error) {
      skipped.push({
        rowNumber: item.rowNumber,
        employeeCode: item.employeeCode,
        reason: error.message || "Insert failed",
      });
      continue;
    }
    saved += 1;
  }

  return { saved, skipped, errors };
}

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const { admin, user } = await authenticateHr(request, "write");

    if (body?.action === "import") {
      const result = await importHistoricLeave(admin, user, Array.isArray(body.rows) ? body.rows : []);
      return Response.json({ success: true, ...result });
    }

    const { value, errors } = normalizeLeaveInput(body);
    if (errors.length) throw new HrHttpError(400, errors.join(" "));

    const existing = await loadHrLeaveEntries(admin, {
      employeeId: value.employeeId,
      fromDate: value.startDate,
      toDate: value.endDate,
    });
    const clash = findLeaveOverlap(existing, value);
    if (clash) {
      throw new HrHttpError(409, `Overlaps leave ${clash.startDate} to ${clash.endDate} for this employee.`);
    }
    const { data, error } = await admin
      .from("hr_leave_entries")
      .insert({ ...leaveToRow(value), created_by: user.id })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HrHttpError(404, "Leave entry not found.");
    return Response.json({ success: true, entry: rowToLeave(data) });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

export async function PUT(request) {
  try {
    return await saveLeave(request, { update: true });
  } catch (error) {
    return hrErrorResponse(error);
  }
}

export async function DELETE(request) {
  try {
    const { admin } = await authenticateHr(request, "write");
    const id = String(new URL(request.url).searchParams.get("id") || "").trim();
    if (!id) throw new HrHttpError(400, "Leave id is required.");
    const { error } = await admin.from("hr_leave_entries").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    return hrErrorResponse(error);
  }
}
