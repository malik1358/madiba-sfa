export const KSA_TIMEZONE = "Asia/Riyadh";
export const INACTIVITY_MS = 45 * 60 * 1000;
export const INACTIVITY_EMAIL_MS = 40 * 60 * 1000;
export const INACTIVITY_ALERT_REPEAT_MS = 15 * 60 * 1000;
export const LUNCH_BREAK_REMINDER_MS = 3 * 60 * 60 * 1000;

export function getInactivityAlertMessage(language = "en") {
  if (String(language || "").trim().toLowerCase() === "ar") {
    return {
      title: "لا يوجد نشاط مسجل",
      body: "لم تسجل زيارة أو طلب أو تحصيل خلال آخر 45 دقيقة.",
    };
  }

  return {
    title: "No activity recorded",
    body: "You have not logged a visit, order, or collection in the last 45 minutes.",
  };
}

export function getLunchBreakReminderMessage(language = "en") {
  if (String(language || "").trim().toLowerCase() === "ar") {
    return {
      title: "تذكير استراحة الغداء",
      body: "استراحة الغداء تجاوزت 3 ساعات. يرجى تسجيل العودة من الغداء عند عودتك.",
    };
  }

  return {
    title: "Lunch break reminder",
    body: "Your lunch break has been over 3 hours. Please tap Lunch break in when you return.",
  };
}

export function getLunchInSuggestionMessage(language = "en") {
  if (String(language || "").trim().toLowerCase() === "ar") {
    return {
      title: "لم يتم تسجيل العودة من الغداء",
      body: "سجلت خروج الغداء ولم تسجل العودة. إذا انتهيت من الغداء، سجّل دخول الغداء من يومي. يمكنك المتابعة بدون ذلك.",
    };
  }

  return {
    title: "Lunch in not recorded",
    body: "You punched Lunch out and have not punched Lunch in. If you are back at work, record Lunch in on My Day. You can continue without it.",
  };
}
export const INACTIVITY_PROMPT_SHOWN_SNOOZE_MS = 5 * 60 * 1000;
export const INACTIVITY_PROMPT_DISMISS_SNOOZE_MS = 15 * 60 * 1000;
export const INACTIVITY_PROMPT_SNOOZE_STORAGE_KEY = "madiba_inactivity_prompt_snooze_until";
export const LUNCH_IN_SUGGESTION_STORAGE_KEY = "madiba_lunch_in_suggestion_dismissed";

export const LUNCH_IN_SUGGESTION_PATHS = [
  "/management/new-order",
  "/management/new-customer",
  "/management/payment-collections",
  "/management/my-collections",
  "/management/my-day",
  "/management/customer-audit",
];
export const BACKGROUND_GPS_IDLE_MS = 15 * 60 * 1000;
export const WORKDAY_START_HOUR = 6;
export const WORKDAY_END_HOUR = 22;
export const LOGIN_REMINDER_HOUR = 11;
export const LOGIN_REMINDER_REPEAT_MS = 30 * 60 * 1000;

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

export function isWithinActiveWorkSession({
  loginAt,
  logoutAt,
  userLogs = [],
  now = new Date(),
} = {}) {
  if (!loginAt || logoutAt) return false;

  const nowTs = now.getTime();
  const loginTs = parseEventTimestamp(loginAt);
  if (!loginTs || nowTs < loginTs) return false;

  if (isOnLunchBreak(userLogs, nowTs)) return false;

  const { lunchOutAt, lunchInAt } = extractLunchTimes(userLogs);
  const lunchOutTs = parseEventTimestamp(lunchOutAt);
  const lunchInTs = parseEventTimestamp(lunchInAt);

  // Morning session: login until lunch break out (or all day if lunch not taken yet).
  if (!lunchOutTs || nowTs <= lunchOutTs) {
    return true;
  }

  // Afternoon session: lunch break in until logout.
  if (lunchInTs && nowTs >= lunchInTs) {
    return true;
  }

  return false;
}

export function getPreviousKsaDateString(now = new Date()) {
  const today = getKsaDateString(now);
  const { startIso } = ksaDayBounds(today);
  return getKsaDateString(new Date(Date.parse(startIso) - 1));
}

const KSA_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getKsaWeekdayIndex(date = new Date()) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: KSA_TIMEZONE,
    weekday: "short",
  }).format(date);
  return KSA_WEEKDAY_INDEX[label] ?? 0;
}

export function getKsaWeekdayIndexForDateString(dateString) {
  const { startIso } = ksaDayBounds(dateString);
  return getKsaWeekdayIndex(new Date(Date.parse(startIso) + 12 * 60 * 60 * 1000));
}

export function isKsaOrderDay(dateString) {
  return getKsaWeekdayIndexForDateString(dateString) !== 5;
}

export function ksaClockTimestamp(dateString, hour = 0, minute = 0) {
  const { startIso } = ksaDayBounds(dateString);
  return Date.parse(startIso) + (Number(hour) * 60 + Number(minute || 0)) * 60 * 1000;
}

export function lateLoginReminderSlot(now = new Date()) {
  const date = getKsaDateString(now);
  const elapsed = now.getTime() - ksaClockTimestamp(date, LOGIN_REMINDER_HOUR);
  if (elapsed < 0) return -1;
  return Math.floor(elapsed / LOGIN_REMINDER_REPEAT_MS);
}

export function inactivityEmailReminderSlot(idleSinceTs, now = new Date()) {
  const start = Number(idleSinceTs || 0);
  if (!start) return -1;
  const elapsed = now.getTime() - start;
  if (elapsed < INACTIVITY_EMAIL_MS) return -1;
  return Math.floor(elapsed / INACTIVITY_EMAIL_MS);
}

export function shouldSendLateLoginReminder({
  loginAt,
  now = new Date(),
} = {}) {
  if (loginAt) return false;
  const date = getKsaDateString(now);
  if (!isKsaOrderDay(date)) return false;
  if (!isWithinKsaWorkingHours(now)) return false;
  return lateLoginReminderSlot(now) >= 0;
}

export function addKsaCalendarDays(dateString, days) {
  const { startIso } = ksaDayBounds(dateString);
  return getKsaDateString(new Date(Date.parse(startIso) + Number(days || 0) * 24 * 60 * 60 * 1000));
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

export function formatKsaTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    timeZone: KSA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatKsaDateOnly(value, empty = "-") {
  const input = String(value || "").trim();
  if (!input) return empty;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return empty;
  const { year, month, day } = getKsaDateTimeParts(date);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
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

export function getOpenLunchBreakOutTimestamp(userLogs, now = Date.now()) {
  let lunchOutTs = 0;
  let lunchInTs = 0;

  for (const row of userLogs || []) {
    const ts = logEventTimestamp(row);
    if (!ts) continue;
    if (row.entry_type === "LUNCH_BREAK_OUT") lunchOutTs = Math.max(lunchOutTs, ts);
    if (row.entry_type === "LUNCH_BREAK_IN" && ts >= lunchOutTs) lunchInTs = Math.max(lunchInTs, ts);
  }

  if (!lunchOutTs || (lunchInTs > 0 && lunchInTs >= lunchOutTs)) return 0;
  if (now < lunchOutTs) return 0;
  return lunchOutTs;
}

export function shouldSendLunchBreakReminder(userLogs, now = new Date()) {
  const lunchOutTs = getOpenLunchBreakOutTimestamp(userLogs, now.getTime());
  if (!lunchOutTs) return false;
  return now.getTime() - lunchOutTs >= LUNCH_BREAK_REMINDER_MS;
}

export function isLunchInSuggestionPath(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "") || "/";
  return LUNCH_IN_SUGGESTION_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function readLunchInSuggestionDismissedTs(storage = null) {
  if (typeof window === "undefined" && !storage) return 0;
  try {
    const value = Number((storage || window.sessionStorage).getItem(LUNCH_IN_SUGGESTION_STORAGE_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function dismissLunchInSuggestion(lunchOutTs, storage = null) {
  const value = Number(lunchOutTs || 0);
  if (!value) return;
  if (typeof window === "undefined" && !storage) return;
  try {
    (storage || window.sessionStorage).setItem(LUNCH_IN_SUGGESTION_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures.
  }
}

export function shouldSuggestLunchIn({
  userLogs,
  pathname,
  now = Date.now(),
  dismissedLunchOutTs = 0,
} = {}) {
  if (!isLunchInSuggestionPath(pathname)) return false;
  if (!isOnLunchBreak(userLogs, now)) return false;
  const lunchOutTs = getOpenLunchBreakOutTimestamp(userLogs, now);
  if (!lunchOutTs) return false;
  return Number(dismissedLunchOutTs || 0) !== lunchOutTs;
}

function orderSubmissionTimestamp(row) {
  const ts = Date.parse(String(row?.submitted_at || ""));
  return Number.isFinite(ts) ? ts : 0;
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
    latest = Math.max(latest, orderSubmissionTimestamp(row));
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

  if (isOnLunchBreak(userLogs, now.getTime())) {
    return "on_lunch";
  }

  if (!isWithinActiveWorkSession({
    loginAt,
    logoutAt,
    userLogs,
    now,
  })) {
    return "logged_in";
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

export function buildAutoCloseEndOfDayPayload(userId, day) {
  const capturedAt = ksaMidnightEndIso(day);
  if (!userId || !capturedAt) return null;

  return {
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
}

export function collectWorkdaysNeedingAutoClose(logs, now = new Date(), userIdFilter = "") {
  const morningKeys = new Map();
  const closedKeys = new Set();
  const filterUserId = String(userIdFilter || "").trim();

  for (const row of logs || []) {
    const userId = String(row?.user_id || "").trim();
    if (!userId || (filterUserId && userId !== filterUserId)) continue;

    const day = getKsaDateString(new Date(logEventTimestamp(row) || row.created_at));
    if (!day) continue;

    const key = `${userId}|${day}`;
    if (row.entry_type === "MORNING_ATTENDANCE") {
      morningKeys.set(key, { userId, day });
    }
    if (row.entry_type === "END_OF_DAY") {
      closedKeys.add(key);
    }
  }

  const todayKsa = getKsaDateString(now);
  const { hour, minute } = getKsaDateTimeParts(now);
  const pending = [];

  for (const [key, entry] of morningKeys) {
    if (closedKeys.has(key)) continue;
    if (entry.day > todayKsa) continue;

    const isPastDay = entry.day < todayKsa;
    const isTodayAfterCutoff = entry.day === todayKsa && hour === 23 && minute >= 59;
    if (!isPastDay && !isTodayAfterCutoff) continue;

    pending.push(entry);
  }

  return pending.sort((left, right) => {
    if (left.day !== right.day) return left.day.localeCompare(right.day);
    return left.userId.localeCompare(right.userId);
  });
}

export async function autoCloseForgottenWorkdays(supabase, userId) {
  if (!supabase || !userId) return [];

  const lookbackStart = new Date();
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 14);

  const { data, error } = await supabase
    .from("daily_activity_logs")
    .select("user_id,entry_type,note,created_at")
    .eq("user_id", userId)
    .in("entry_type", ["MORNING_ATTENDANCE", "END_OF_DAY"])
    .gte("created_at", lookbackStart.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;

  const pending = collectWorkdaysNeedingAutoClose(data || [], new Date(), userId);
  const closed = [];

  for (const { day } of pending) {
    const payload = buildAutoCloseEndOfDayPayload(userId, day);
    if (!payload) continue;

    const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;
    closed.push(day);
  }

  return closed;
}

export function inactivityReferenceTimestamp({
  loginAt,
  userLogs = [],
  collections = [],
  orders = [],
} = {}) {
  const lastTransactionTs = lastTransactionTimestamp(userLogs, collections, orders);
  const loginTs = Date.parse(String(loginAt || ""));
  const { lunchInAt } = extractLunchTimes(userLogs);
  const lunchInTs = parseEventTimestamp(lunchInAt);
  return Math.max(
    lastTransactionTs,
    Number.isFinite(loginTs) ? loginTs : 0,
    lunchInTs || 0,
  );
}

export function shouldFlagInactivity({
  loginAt,
  logoutAt,
  userLogs = [],
  collections = [],
  orders = [],
  now = new Date(),
  thresholdMs = INACTIVITY_MS,
} = {}) {
  if (!loginAt || logoutAt) return false;
  if (isOnLunchBreak(userLogs, now.getTime())) return false;
  if (!isWithinActiveWorkSession({
    loginAt,
    logoutAt,
    userLogs,
    now,
  })) return false;

  const referenceTs = inactivityReferenceTimestamp({
    loginAt,
    userLogs,
    collections,
    orders,
  });
  if (!referenceTs) return false;

  return now.getTime() - referenceTs >= thresholdMs;
}

export function areActivityRemindersEnabled(profileOrFlag) {
  if (profileOrFlag && typeof profileOrFlag === "object") {
    return profileOrFlag.activity_reminders_enabled !== false;
  }
  return profileOrFlag !== false;
}

export function shouldWarnInactivity(args = {}) {
  return shouldFlagInactivity({
    ...args,
    thresholdMs: INACTIVITY_MS,
  });
}

export function shouldEmailInactivity(args = {}) {
  if (!isWithinKsaWorkingHours(args.now || new Date())) return false;
  return shouldFlagInactivity({
    ...args,
    thresholdMs: INACTIVITY_EMAIL_MS,
  });
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
