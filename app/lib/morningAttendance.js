import { isAdminRole } from "./moduleAccess.js";
import { getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const MORNING_ATTENDANCE_COMPLETE_EVENT = "madiba-morning-attendance-complete";
export const WORKDAY_TIMES_UPDATED_EVENT = "madiba-workday-times-updated";
export const WORKDAY_GATE_READY_EVENT = WORKDAY_TIMES_UPDATED_EVENT;

export function isMorningAttendanceRequiredForRole(role) {
  return !isAdminRole(role);
}

export function isMorningAttendanceRoute(pathname) {
  return String(pathname || "").trim() === "/management/my-day";
}

const INLINE_MORNING_ATTENDANCE_PATHS = new Set([
  "/management/payment-collections",
  "/management/payment-collections/legal",
  "/management/my-collections",
]);

// Collectors land on Collections as home, so attendance is punched there instead of redirecting to My Day.
export function isInlineMorningAttendancePath(pathname) {
  const path = String(pathname || "").trim().split("?")[0];
  return INLINE_MORNING_ATTENDANCE_PATHS.has(path);
}

export function canAccessWithoutMorningAttendance(pathname) {
  const path = String(pathname || "").trim().split("?")[0];
  return path === "/"
    || path === "/management/my-day"
    || isInlineMorningAttendancePath(path);
}

/**
 * When attendance is missing, bounce field modules to My Day / Collections.
 * Preserve visit deep-link query so the customer form can open after punch-in.
 */
export function resolveMorningAttendanceRedirectPath(pathname, search = "", attendanceHome = "/management/my-day") {
  const home = String(attendanceHome || "/management/my-day").trim() || "/management/my-day";
  const path = String(pathname || "").trim().split("?")[0];
  const query = String(search || "").trim();
  const normalizedQuery = query && !query.startsWith("?") ? `?${query}` : query;

  if (
    home === "/management/my-day"
    && path === "/management/visit-without-order"
    && normalizedQuery.includes("customer_code=")
  ) {
    return `${home}${normalizedQuery}`;
  }

  return home;
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

export const MORNING_ATTENDANCE_ALREADY_LOGGED_MESSAGE = "Morning attendance is already logged for today.";

export function isMorningAttendanceUniqueViolation(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  return code === "23505"
    || message.includes("daily_activity_logs_one_morning_per_ksa_day")
    || details.includes("daily_activity_logs_one_morning_per_ksa_day");
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

/**
 * Insert morning attendance at most once per KSA calendar day.
 * Concurrent retries treat an existing row (or unique-index conflict) as success.
 */
export async function insertMorningAttendanceOnce(supabase, userId, note) {
  if (!supabase || !userId) {
    throw new Error("Missing supabase client or user.");
  }

  if (await hasMorningAttendanceToday(supabase, userId)) {
    return { alreadyExists: true };
  }

  const { error } = await supabase.from("daily_activity_logs").insert({
    user_id: userId,
    entry_type: "MORNING_ATTENDANCE",
    note,
  });

  if (!error) {
    return { alreadyExists: false };
  }

  if (isMorningAttendanceUniqueViolation(error) || await hasMorningAttendanceToday(supabase, userId)) {
    return { alreadyExists: true };
  }

  throw error;
}

export function notifyMorningAttendanceComplete() {
  notifyWorkdayTimesUpdated();
}

export function notifyWorkdayTimesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKDAY_TIMES_UPDATED_EVENT));
  window.dispatchEvent(new CustomEvent(MORNING_ATTENDANCE_COMPLETE_EVENT));
}
