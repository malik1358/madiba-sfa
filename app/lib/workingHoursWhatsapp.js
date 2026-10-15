import { isFarFromCustomer } from "./customerLocation.js";
import { extractWorkdayTimesFromRoute } from "./dayRouteMap.js";
import { todayAttendanceBounds } from "./morningAttendance.js";
import {
  timelineRowFromActivityLog,
  timelineRowFromCollectionVisit,
} from "./visitDistanceWhatsapp.js";
import {
  calculateWorkingHoursMinutes,
  formatWorkingHours,
} from "./workdayActivity.js";

export const WORKING_HOURS_WHATSAPP_LABELS = {
  workingHours: "Working hours",
};

/** Soft deadline for offline-first WhatsApp builds; still falls back to attendance punches already loaded. */
export const WORKING_HOURS_WHATSAPP_TIMEOUT_MS = 8000;

export const WORKING_HOURS_ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "ORDER_SUBMITTED",
  "COLLECTION_VISIT",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
];

const NEAR_CUSTOMER_TRANSACTION_TYPES = new Set([
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
]);

function parseActivityNote(note) {
  if (!note) return null;
  if (typeof note === "object") return note;
  try {
    return JSON.parse(note);
  } catch {
    return null;
  }
}

function rowTimestamp(row) {
  const ts = Date.parse(row?.savedAt || row?.saved_at || "");
  return Number.isFinite(ts) ? ts : 0;
}

function entryType(entry) {
  return String(
    entry?.transactionType
    || entry?.transaction_type
    || entry?.entryType
    || entry?.entry_type
    || entry?.type
    || "",
  ).trim().toUpperCase();
}

/**
 * Format WhatsApp lines for cumulative working hours until the message time.
 * Unknown (not loaded) shows "-"; computed zero shows "0h".
 */
export function formatWorkingHoursWhatsappLines(hours = null, labels = {}) {
  const resolvedLabels = { ...WORKING_HOURS_WHATSAPP_LABELS, ...labels };
  if (!hours || hours.known === false) {
    return ["", `${resolvedLabels.workingHours}: -`];
  }
  const value = String(hours.value || "0h").trim() || "0h";
  return ["", `${resolvedLabels.workingHours}: ${value}`];
}

export function formatWorkingHoursWhatsappLine(hours = null, labels = {}) {
  return formatWorkingHoursWhatsappLines(hours, labels).filter(Boolean).join("\n");
}

function formatKnownWorkingHours(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { known: true, minutes: 0, value: "0h", ranges: [] };
  }
  return {
    known: true,
    minutes,
    value: formatWorkingHours(minutes) || "0h",
    ranges: [],
  };
}

/**
 * Working hours till the WhatsApp message time = attendance clock
 * (login → lunch out + lunch in → message time / logout), matching User Activity /
 * My Day attendance hours with openEndedAt = the visit/order timestamp.
 * This is intentional for per-message WhatsApp; the Working Hours report still
 * uses day-route near-stop segments.
 */
export function resolveWorkingHoursTillMessage({
  entries = [],
  untilAt = "",
  currentEntry = null,
} = {}) {
  const cutoffTs = Date.parse(String(untilAt || ""));
  const cutoff = Number.isFinite(cutoffTs) ? cutoffTs : Date.now();
  const cutoffIso = new Date(cutoff).toISOString();

  const prior = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const at = entry?.savedAt || entry?.saved_at || null;
      const ts = Date.parse(String(at || ""));
      if (!at || !Number.isFinite(ts) || ts > cutoff) return null;
      return {
        ...entry,
        savedAt: at,
        transactionType: entryType(entry),
      };
    })
    .filter(Boolean);

  if (currentEntry) {
    const at = currentEntry.savedAt || currentEntry.saved_at || untilAt || cutoffIso;
    const type = entryType(currentEntry) || "VISIT_REPORT";
    const currentTs = Date.parse(String(at || ""));
    if (at && Number.isFinite(currentTs) && currentTs <= cutoff + 1000) {
      prior.push({
        ...currentEntry,
        savedAt: at,
        transactionType: type,
      });
    }
  }

  const times = extractWorkdayTimesFromRoute(prior);
  const logoutTs = Date.parse(String(times.logoutAt || ""));
  const logoutAt = Number.isFinite(logoutTs) && logoutTs <= cutoff
    ? times.logoutAt
    : null;

  const minutes = calculateWorkingHoursMinutes({
    loginAt: times.loginAt,
    lunchOutAt: times.lunchOutAt,
    lunchInAt: times.lunchInAt,
    logoutAt,
    openEndedAt: cutoffIso,
  });

  return formatKnownWorkingHours(minutes == null ? 0 : minutes);
}

export function workingHoursEntryFromTimelineRow(row) {
  const type = entryType(row);
  if (!type) return null;
  const at = row?.savedAt || row?.saved_at;
  if (!at) return null;
  return {
    savedAt: at,
    transactionType: type,
    customerCode: row?.customerCode || row?.customer_code || "",
    latitude: row?.latitude,
    longitude: row?.longitude,
    isFarFromCustomer: Boolean(row?.isFarFromCustomer),
  };
}

export function buildCurrentWorkingHoursEntry({
  transactionType = "VISIT_REPORT",
  savedAt = "",
  location = null,
  customer = {},
  customerCode = "",
} = {}) {
  const type = String(transactionType || "VISIT_REPORT").trim().toUpperCase();
  const far = NEAR_CUSTOMER_TRANSACTION_TYPES.has(type)
    ? isFarFromCustomer(location, customer)
    : false;
  return {
    savedAt: savedAt || new Date().toISOString(),
    transactionType: type,
    customerCode: customerCode || customer?.customer_code || "",
    latitude: location?.latitude,
    longitude: location?.longitude,
    isFarFromCustomer: far,
  };
}

function timelineRowFromActivityLogForHours(row) {
  const base = timelineRowFromActivityLog(row);
  const parsed = parseActivityNote(row?.note) || {};
  return {
    ...base,
    customerCode: parsed.customer_code || parsed.customerCode || "",
    transactionType: base.transactionType,
  };
}

export async function loadTodayWorkingHoursEntries(supabase, userId) {
  if (!supabase || !userId) return [];

  const { startIso, endIso } = todayAttendanceBounds();
  const rows = [];

  const [activityResult, collectionResult] = await Promise.all([
    (async () => {
      try {
        return await supabase
          .from("daily_activity_logs")
          .select("id,user_id,entry_type,note,created_at")
          .eq("user_id", userId)
          .in("entry_type", WORKING_HOURS_ACTIVITY_ENTRY_TYPES)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true })
          .limit(400);
      } catch {
        return { data: null, error: true };
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from("collection_visits")
          .select("id,saved_at,latitude,longitude,created_by,customer_code")
          .eq("created_by", userId)
          .gte("saved_at", startIso)
          .lte("saved_at", endIso)
          .order("saved_at", { ascending: true })
          .limit(200);
      } catch {
        return { data: null, error: true };
      }
    })(),
  ]);

  if (!activityResult?.error && activityResult?.data) {
    activityResult.data.forEach((row) => {
      const entry = workingHoursEntryFromTimelineRow(timelineRowFromActivityLogForHours(row));
      if (entry) rows.push(entry);
    });
  }

  if (!collectionResult?.error && collectionResult?.data) {
    collectionResult.data.forEach((row) => {
      const entry = workingHoursEntryFromTimelineRow({
        ...timelineRowFromCollectionVisit(row),
        customerCode: row.customer_code,
      });
      if (entry) rows.push(entry);
    });
  }

  return rows.sort((left, right) => rowTimestamp(left) - rowTimestamp(right));
}

/**
 * Load cumulative working hours until the WhatsApp message time.
 * Prefer today's attendance punches. On timeout/offline, still compute from
 * whatever entries are available (including currentEntry) so WhatsApp shows
 * "0h" / a real total instead of "-" on queueFirst saves.
 */
export async function loadWorkingHoursTillMessage({
  supabase,
  userId,
  savedAt = "",
  currentEntry = null,
  skipTimeline = false,
  timelineTimeoutMs = WORKING_HOURS_WHATSAPP_TIMEOUT_MS,
  localEntries = null,
} = {}) {
  const capturedAt = savedAt || new Date().toISOString();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const cachedEntries = Array.isArray(localEntries) ? localEntries : null;
  let entries = cachedEntries;

  if (!offline && (!skipTimeline || timelineTimeoutMs > 0)) {
    try {
      const timelinePromise = loadTodayWorkingHoursEntries(supabase, userId);
      if (timelineTimeoutMs > 0) {
        const loaded = await Promise.race([
          timelinePromise.then((rows) => ({ ok: true, rows })),
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, rows: null }), timelineTimeoutMs);
          }),
        ]);
        // Prefer a completed fetch; on timeout keep any prefetched punches so
        // queueFirst WhatsApp still shows login→now hours instead of "0h"/"-".
        entries = loaded.ok ? loaded.rows : (cachedEntries || []);
      } else {
        entries = await timelinePromise;
      }
    } catch {
      entries = cachedEntries || [];
    }
  }

  if (!entries) entries = [];

  return resolveWorkingHoursTillMessage({
    entries,
    untilAt: capturedAt,
    currentEntry,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function patchWhatsappSummaryWorkingHours(
  summary,
  hours = null,
  labels = WORKING_HOURS_WHATSAPP_LABELS,
) {
  const text = String(summary || "");
  if (!text) return text;

  const line = formatWorkingHoursWhatsappLine(hours, labels);
  if (!line) return text;

  const labelVariants = [
    labels.workingHours,
    WORKING_HOURS_WHATSAPP_LABELS.workingHours,
    "ساعات العمل",
  ].filter(Boolean);

  for (const label of labelVariants) {
    const pattern = new RegExp(`^${escapeRegExp(label)}:\\s*.+$`, "m");
    if (pattern.test(text)) {
      return text.replace(pattern, line);
    }
  }

  const visitDatePatterns = [
    /^(Visit date\/time:\s*.+)$/m,
    /^(تاريخ ووقت الزيارة:\s*.+)$/m,
  ];
  for (const pattern of visitDatePatterns) {
    if (pattern.test(text)) {
      return text.replace(pattern, `$1\n${line}`);
    }
  }

  const gpsPattern = /\nGPS:/;
  if (gpsPattern.test(text)) {
    return text.replace(gpsPattern, `\n${line}\n\nGPS:`);
  }

  return `${text.trimEnd()}\n${line}`;
}
