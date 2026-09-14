import { activeScheduledVisitDate } from "./nextVisitDate.js";

export const MY_DAY_VISIT_LOOKBACK_DAYS = 120;
export const MY_DAY_VISIT_REPORT_LIMIT = 400;
export const MY_DAY_ATTENDANCE_ENTRY_TYPES = [
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
  "NOTE",
];

export function visitReportsSinceIso(now = new Date(), days = MY_DAY_VISIT_LOOKBACK_DAYS) {
  const lookbackDays = Number(days) > 0 ? Number(days) : MY_DAY_VISIT_LOOKBACK_DAYS;
  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}

export function applyLatestVisitFromLogRow(
  latestVisitByCustomer,
  nextVisitByCustomer,
  row,
  getSortTimestamp,
  scheduleMetaByCustomer = null,
) {
  if (!row?.note) return;

  try {
    const parsed = JSON.parse(row.note);
    const customerCode = String(parsed?.customer_code || "").trim().toUpperCase();
    if (!customerCode) return;

    const visitAt = parsed?.captured_at || row.created_at;
    const current = latestVisitByCustomer.get(customerCode);
    if (!current || getSortTimestamp(visitAt) > getSortTimestamp(current)) {
      latestVisitByCustomer.set(customerCode, visitAt);
      const nextVisitAt = activeScheduledVisitDate(parsed?.next_visit_at, visitAt) || null;
      nextVisitByCustomer.set(customerCode, nextVisitAt);
      if (scheduleMetaByCustomer) {
        const scheduledByUserId = String(
          row.user_id || parsed?.saved_by_user_id || parsed?.created_by || "",
        ).trim();
        scheduleMetaByCustomer.set(customerCode, {
          scheduled_by_user_id: scheduledByUserId || null,
          scheduled_at: visitAt || row.created_at || null,
          next_visit_at: nextVisitAt,
        });
      }
    }
  } catch {
    // Ignore malformed notes.
  }
}
