export const KSA_TIMEZONE = "Asia/Riyadh";
export const INACTIVITY_MS = 45 * 60 * 1000;
export const INACTIVITY_PROMPT_SHOWN_SNOOZE_MS = 5 * 60 * 1000;
export const INACTIVITY_PROMPT_DISMISS_SNOOZE_MS = 15 * 60 * 1000;
export const INACTIVITY_PROMPT_SNOOZE_STORAGE_KEY = "madiba_inactivity_prompt_snooze_until";
export const BACKGROUND_GPS_IDLE_MS = 15 * 60 * 1000;
export const WORKDAY_START_HOUR = 6;
export const WORKDAY_END_HOUR = 22;

export const TRANSACTION_ENTRY_TYPES = new Set([
  "VISIT_REPORT",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "ORDER_SUBMITTED",
  "PROSPECT_FOLLOW_UP",
  "NOTE",
]);

export const IDLE_GPS_ACTIVITY_ENTRY_TYPES = [
  ...TRANSACTION_ENTRY_TYPES,
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
];

export const GPS_ONLY_ENTRY_TYPES = new Set([
  "GPS_PING",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
]);

function parseNote(value) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

export function getKsaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KSA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getKsaDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: KSA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function isWithinKsaWorkingHours(date = new Date()) {
  const { hour } = getKsaDateTimeParts(date);
  return hour >= WORKDAY_START_HOUR && hour < WORKDAY_END_HOUR;
}

export function ksaDayBounds(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Invalid KSA date string.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const startUtc = new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
  const endUtc = new Date(Date.UTC(year, month - 1, day, 20, 59, 59, 999));

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

export function ksaMidnightEndIso(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 23:59:59.999 KSA = 20:59:59.999 UTC on the same calendar date.
  return new Date(Date.UTC(year, month - 1, day, 20, 59, 59, 999)).toISOString();
}

export function ksaEventDate(row) {
  const ts = logEventTimestamp(row) || Date.parse(String(row?.created_at || ""));
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return getKsaDateString(new Date(ts));
}

export function filterLogsByKsaEventDate(logs, reportDate) {
  const target = String(reportDate || "").trim();
  if (!target) return logs || [];
  return (logs || []).filter((row) => ksaEventDate(row) === target);
}

export function formatKsaDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    timeZone: KSA_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseEventTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

export function calculateWorkingHoursMinutes({
  loginAt,
  lunchOutAt,
  lunchInAt,
  logoutAt,
  openEndedAt = null,
}) {
  const loginTs = parseEventTimestamp(loginAt);
  const lunchOutTs = parseEventTimestamp(lunchOutAt);
  const lunchInTs = parseEventTimestamp(lunchInAt);
  const logoutTs = parseEventTimestamp(logoutAt);
  const endTs = logoutTs ?? parseEventTimestamp(openEndedAt);

  let totalMs = 0;

  if (loginTs && lunchOutTs && lunchOutTs > loginTs) {
    totalMs += lunchOutTs - loginTs;
  }

  if (lunchInTs && endTs && endTs > lunchInTs) {
    totalMs += endTs - lunchInTs;
  }

  if (totalMs === 0 && loginTs && endTs && endTs > loginTs) {
    totalMs = endTs - loginTs;
  }

  return totalMs > 0 ? Math.round(totalMs / (60 * 1000)) : null;
}

export function formatWorkingHours(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return "-";
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function logEventTimestamp(row) {
  const parsed = parseNote(row?.note);
  const raw = parsed?.captured_at || parsed?.capturedAt || row?.created_at || row?.saved_at || null;
  const ts = Date.parse(String(raw || ""));
  return Number.isFinite(ts) ? ts : 0;
}

export function logEventIso(row) {
  const ts = logEventTimestamp(row);
  return ts ? new Date(ts).toISOString() : row?.created_at || null;
}

export function extractLunchTimes(userLogs) {
  let lunchOutAt = null;
  let lunchInAt = null;
  let morningTs = 0;
  let lunchOutTs = 0;

  for (const row of userLogs || []) {
    const ts = logEventTimestamp(row);
    if (!ts) continue;

    if (row.entry_type === "MORNING_ATTENDANCE" && !morningTs) {
      morningTs = ts;
    }

    if (row.entry_type === "LUNCH_BREAK_OUT" && morningTs && ts >= morningTs && !lunchOutAt) {
      lunchOutAt = logEventIso(row);
      lunchOutTs = ts;
    }

    if (row.entry_type === "LUNCH_BREAK_IN" && lunchOutTs && ts >= lunchOutTs && !lunchInAt) {
      lunchInAt = logEventIso(row);
    }
  }

  return { lunchOutAt, lunchInAt };
}

export function isOnLunchBreak(userLogs, now = Date.now()) {
  let lunchOutTs = 0;
  let lunchInTs = 0;

  for (const row of userLogs || []) {
    const ts = logEventTimestamp(row);
    if (!ts) continue;
    if (row.entry_type === "LUNCH_BREAK_OUT") lunchOutTs = ts;
    if (row.entry_type === "LUNCH_BREAK_IN" && ts >= lunchOutTs) lunchInTs = ts;
  }

  return lunchOutTs > 0 && (lunchInTs === 0 || lunchInTs < lunchOutTs) && now >= lunchOutTs;
}

export function lastTransactionTimestamp(userLogs, collections = [], orders = []) {
  let latest = 0;

  for (const row of userLogs || []) {
    if (!TRANSACTION_ENTRY_TYPES.has(String(row.entry_type || "").toUpperCase())) continue;
    latest = Math.max(latest, logEventTimestamp(row));
  }

  for (const row of collections || []) {
    const ts = Date.parse(String(row?.saved_at || ""));
    if (Number.isFinite(ts)) latest = Math.max(latest, ts);
  }

  for (const row of orders || []) {
    const ts = Date.parse(String(row?.submitted_at || row?.updated_at || row?.created_at || ""));
    if (Number.isFinite(ts)) latest = Math.max(latest, ts);
  }

  return latest || 0;
}

export function deriveActivityStatus({
  loginAt,
  logoutAt,
  userLogs = [],
  collections = [],
  orders = [],
  reportDate,
  now = new Date(),
}) {
  if (!loginAt) {
    return "not_logged_in";
  }

  if (logoutAt) {
    return "ended";
  }

  const todayKsa = getKsaDateString(now);
  if (reportDate && reportDate !== todayKsa) {
    return "logged_in";
  }

  if (!isWithinKsaWorkingHours(now)) {
    return "logged_in";
  }

  if (isOnLunchBreak(userLogs, now.getTime())) {
    return "on_lunch";
  }

  const lastTransactionTs = lastTransactionTimestamp(userLogs, collections, orders);
  if (lastTransactionTs && now.getTime() - lastTransactionTs <= INACTIVITY_MS) {
    return "active";
  }

  const loginTs = Date.parse(String(loginAt || ""));
  if (Number.isFinite(loginTs) && now.getTime() - loginTs <= INACTIVITY_MS) {
    return "active";
  }

  return "idle";
}

export async function autoCloseForgottenWorkdays(supabase, userId) {
  if (!supabase || !userId) return [];

  const lookbackStart = new Date();
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 14);

  const { data, error } = await supabase
    .from("daily_activity_logs")
    .select("entry_type,note,created_at")
    .eq("user_id", userId)
    .in("entry_type", ["MORNING_ATTENDANCE", "END_OF_DAY"])
    .gte("created_at", lookbackStart.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;

  const morningDays = new Set();
  const closedDays = new Set();

  for (const row of data || []) {
    const day = getKsaDateString(new Date(logEventTimestamp(row) || row.created_at));
    if (row.entry_type === "MORNING_ATTENDANCE") morningDays.add(day);
    if (row.entry_type === "END_OF_DAY") closedDays.add(day);
  }

  const todayKsa = getKsaDateString();
  const closed = [];

  for (const day of morningDays) {
    if (closedDays.has(day)) continue;
    if (day > todayKsa) continue;

    const { hour, minute } = getKsaDateTimeParts();
    const isPastDay = day < todayKsa;
    const isTodayAfterCutoff = day === todayKsa && hour === 23 && minute >= 59;
    if (!isPastDay && !isTodayAfterCutoff) continue;

    const capturedAt = ksaMidnightEndIso(day);
    if (!capturedAt) continue;

    const payload = {
      user_id: userId,
      entry_type: "END_OF_DAY",
      created_at: capturedAt,
      note: JSON.stringify({
        action: "END_OF_DAY",
        autoClosed: true,
        reason: "Forgotten end of day auto-closed at 11:59 PM KSA",
        captured_at: capturedAt,
      }),
    };

    const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;
    closed.push(day);
  }

  return closed;
}

export function shouldWarnInactivity({
  loginAt,
  logoutAt,
  userLogs = [],
  collections = [],
  orders = [],
  now = new Date(),
}) {
  if (!loginAt || logoutAt) return false;
  if (!isWithinKsaWorkingHours(now)) return false;
  if (isOnLunchBreak(userLogs, now.getTime())) return false;

  const lastTransactionTs = lastTransactionTimestamp(userLogs, collections, orders);
  const loginTs = Date.parse(String(loginAt || ""));
  const referenceTs = Math.max(lastTransactionTs, Number.isFinite(loginTs) ? loginTs : 0);
  if (!referenceTs) return false;

  return now.getTime() - referenceTs >= INACTIVITY_MS;
}

export function readInactivityPromptSnoozeUntil(storage = null) {
  if (typeof window === "undefined" && !storage) return 0;

  try {
    const raw = (storage || window.sessionStorage).getItem(INACTIVITY_PROMPT_SNOOZE_STORAGE_KEY);
    const value = Number(raw || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeInactivityPromptSnoozeUntil(untilMs, storage = null) {
  if (typeof window === "undefined" && !storage) return;

  try {
    (storage || window.sessionStorage).setItem(INACTIVITY_PROMPT_SNOOZE_STORAGE_KEY, String(untilMs));
  } catch {
    // Ignore storage failures.
  }
}

export function isInactivityPromptSnoozed(now = Date.now(), storage = null) {
  return now < readInactivityPromptSnoozeUntil(storage);
}

export function snoozeInactivityPrompt(durationMs, now = Date.now(), storage = null) {
  writeInactivityPromptSnoozeUntil(now + durationMs, storage);
}

export function shouldCaptureIdleGpsPing({
  now = Date.now(),
  lastActivityTs = 0,
  lastGpsPingTs = 0,
  idleMs = BACKGROUND_GPS_IDLE_MS,
} = {}) {
  if (!lastActivityTs) return false;
  if (now - lastActivityTs < idleMs) return false;
  if (lastGpsPingTs && now - lastGpsPingTs < idleMs) return false;
  return true;
}
