import { normalizeAccessRole, shouldRequireTransactionGps } from "./moduleAccess.js";

export const MORNING_ATTENDANCE_COMPLETE_EVENT = "madiba-morning-attendance-complete";

export function isMorningAttendanceRequiredForRole(role) {
  return normalizeAccessRole(role) !== "admin" && shouldRequireTransactionGps(role);
}

export function isMorningAttendanceRoute(pathname) {
  return String(pathname || "").trim() === "/management/my-day";
}

export function canAccessWithoutMorningAttendance(pathname) {
  const path = String(pathname || "").trim();
  return path === "/" || path === "/management/my-day";
}

export function todayAttendanceBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function hasMorningAttendanceToday(supabase, userId) {
  if (!supabase || !userId) return false;

  const { startIso, endIso } = todayAttendanceBounds();
  const { data, error } = await supabase
    .from("daily_activity_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("entry_type", "MORNING_ATTENDANCE")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .limit(1)
    .maybeSingle();

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("does not exist") || error.code === "42P01") {
      return false;
    }
    throw error;
  }

  return Boolean(data?.id);
}

export function notifyMorningAttendanceComplete() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MORNING_ATTENDANCE_COMPLETE_EVENT));
}
