import { normalizeAccessRole, shouldRequireTransactionGps } from "./moduleAccess.js";
import { getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const MORNING_ATTENDANCE_COMPLETE_EVENT = "madiba-morning-attendance-complete";
export const WORKDAY_TIMES_UPDATED_EVENT = "madiba-workday-times-updated";

export function isMorningAttendanceRequiredForRole(role) {
  return normalizeAccessRole(role) !== "admin" && shouldRequireTransactionGps(role);
}

export function isMorningAttendanceRoute(pathname) {
  return String(pathname || "").trim() === "/management/my-day";
}

export function canAccessWithoutMorningAttendance(pathname) {
  const path = String(pathname || "").trim();
  return path === "/"
    || path === "/management/my-day"
    || path === "/management/visit-without-order";
}

export function todayAttendanceBounds(referenceDate = new Date()) {
  return ksaDayBounds(getKsaDateString(referenceDate));
}

const GATE_READY_STORAGE_PREFIX = "madiba-sfa:gate-ready:";

export function todayDateKey(referenceDate = new Date()) {
  return getKsaDateString(referenceDate);
}

function gateReadyStorageKey(userId) {
  return `${GATE_READY_STORAGE_PREFIX}${userId}`;
}

function readStorageRaw(storage, key) {
  try {
    return storage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeStorageRaw(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

export function readGateReadyState(userId, referenceDate = new Date()) {
  if (typeof window === "undefined" || !userId) return null;

  const key = gateReadyStorageKey(userId);
  const raw = readStorageRaw(window.localStorage, key) || readStorageRaw(window.sessionStorage, key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.day !== todayDateKey(referenceDate)) return null;

    return {
      attendanceComplete: Boolean(parsed.attendanceComplete),
    };
  } catch {
    return null;
  }
}

export function writeGateReadyState(userId, attendanceComplete, referenceDate = new Date()) {
  if (typeof window === "undefined" || !userId) return;

  const payload = JSON.stringify({
    day: todayDateKey(referenceDate),
    attendanceComplete: Boolean(attendanceComplete),
  });
  const key = gateReadyStorageKey(userId);
  writeStorageRaw(window.localStorage, key, payload);
  writeStorageRaw(window.sessionStorage, key, payload);
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
    .limit(1);

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("does not exist") || error.code === "42P01") {
      return false;
    }
    throw error;
  }

  return Boolean(data?.[0]?.id);
}

export function notifyMorningAttendanceComplete() {
  notifyWorkdayTimesUpdated();
}

export function notifyWorkdayTimesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKDAY_TIMES_UPDATED_EVENT));
  window.dispatchEvent(new CustomEvent(MORNING_ATTENDANCE_COMPLETE_EVENT));
}
