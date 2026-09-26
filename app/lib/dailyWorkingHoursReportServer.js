import { runAutoCloseWorkdaysCycle } from "./autoCloseWorkdaysServer.js";
import { buildDailyVisitReport } from "./dailyVisitReportServer.js";
import {
  buildDailyWorkingHoursRows,
  summarizeDailyWorkingHours,
} from "./dailyWorkingHoursReport.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";

async function loadProfilesById(admin, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const full = "id,role,salesman_code,salesman_name,email";
  let result = await admin.from("profiles").select(full).in("id", ids);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select("id,role,salesman_code,salesman_name,email").in("id", ids);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

/**
 * Attendance-style daily working hours for field users on a KSA date.
 * Reuses daily visit enrichment (far/near flags) and resolveDayRouteWorkingHours.
 */
export async function buildDailyWorkingHoursReport(admin, { date, userIdFilter = "" } = {}) {
  try {
    await runAutoCloseWorkdaysCycle(admin, {
      lookbackDays: 2,
      closeCurrentDay: true,
      now: new Date(),
    });
  } catch {
    // Auto-close is best-effort so missing logout rows do not block the report.
  }

  const visitReport = await buildDailyVisitReport(admin, { date, userIdFilter });
  const profiles = await loadProfilesById(
    admin,
    (visitReport.users || []).map((user) => user.userId),
  );
  const profileMap = new Map((profiles || []).map((row) => [row.id, row]));

  const usersWithProfile = (visitReport.users || []).map((user) => {
    const profile = profileMap.get(user.userId) || {};
    return {
      ...user,
      role: profile.role || user.role || "",
      salesmanCode: profile.salesman_code || user.salesmanCode || "",
      email: user.email || profile.email || "",
    };
  });

  const rows = buildDailyWorkingHoursRows(usersWithProfile);
  return {
    date,
    users: rows,
    availableUsers: visitReport.availableUsers || [],
    totals: summarizeDailyWorkingHours(rows),
  };
}
