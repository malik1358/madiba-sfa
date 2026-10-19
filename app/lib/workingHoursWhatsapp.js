import { customerHasSavedLocation, isFarFromCustomer } from "./customerLocation.js";
import { findUnloggedIdleGaps } from "./collectionDaySummary.js";
import {
  extractWorkdayTimesFromRoute,
  formatDayRouteWorkingHoursLabel,
  resolveDayRouteWorkingHours,
} from "./dayRouteMap.js";
import { isAtMadibaStore } from "./madibaStoreLocation.js";
import { todayAttendanceBounds } from "./morningAttendance.js";
import {
  timelineRowFromActivityLog,
  timelineRowFromCollectionVisit,
} from "./visitDistanceWhatsapp.js";

export const WORKING_HOURS_WHATSAPP_LABELS = {
  workingHours: "Working hours",
};

/** Soft deadline for offline-first WhatsApp builds; still falls back to attendance punches already loaded. */
export const WORKING_HOURS_WHATSAPP_TIMEOUT_MS = 8000;

export const WORKING_HOURS_ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "PROSPECT_FOLLOW_UP",
  "ORDER_DRAFT",
  "ORDER_EDITED",
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
 * Always pads with a blank line before and after so the value stands out.
 * Unknown (not loaded) shows "-"; computed zero shows "0h".
 */
export function formatWorkingHoursWhatsappLines(hours = null, labels = {}) {
  const resolvedLabels = { ...WORKING_HOURS_WHATSAPP_LABELS, ...labels };
  const value = (!hours || hours.known === false)
    ? "-"
    : (String(hours.value || "0h").trim() || "0h");
  return ["", `${resolvedLabels.workingHours}: ${value}`, ""];
}

export function formatWorkingHoursWhatsappLine(hours = null, labels = {}) {
  const lines = formatWorkingHoursWhatsappLines(hours, labels);
  return lines.find((line) => String(line || "").trim()) || "";
}

const PUNCH_TYPES = new Set([
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
]);

function idleGapsForDayRouteEntries(entries = []) {
  const times = extractWorkdayTimesFromRoute(entries);
  const activities = (entries || [])
    .filter((entry) => {
      const type = entryType(entry);
      if (!type || type === "GPS_PING" || PUNCH_TYPES.has(type)) return false;
      return Boolean(entry?.savedAt || entry?.saved_at);
    })
    .map((entry) => ({ savedAt: entry.savedAt || entry.saved_at }));
  return findUnloggedIdleGaps({
    visits: [],
    activities,
    loginAt: times.loginAt,
    logoutAt: times.logoutAt,
    lunchOutAt: times.lunchOutAt,
    lunchInAt: times.lunchInAt,
  });
}

/**
 * Working hours till the WhatsApp message = the Daily Visit Report total
 * (`resolveDayRouteWorkingHours`) using only punches and near customer stops
 * at or before that time. Login-to-now attendance is not used.
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

  const hours = resolveDayRouteWorkingHours(prior, idleGapsForDayRouteEntries(prior));
  return {
    known: true,
    minutes: Number(hours.minutes) > 0 ? Number(hours.minutes) : 0,
    value: formatDayRouteWorkingHoursLabel(hours),
    ranges: hours.ranges || [],
  };
}

export function applyCustomerFarFlags(entries = [], customers = []) {
  const byCode = new Map(
    (customers || []).map((row) => [String(row?.customer_code || "").trim().toUpperCase(), row]),
  );
  return (entries || []).map((entry) => {
    const type = entryType(entry);
    if (!NEAR_CUSTOMER_TRANSACTION_TYPES.has(type)) {
      return { ...entry, isFarFromCustomer: false };
    }
    const location = { latitude: entry.latitude, longitude: entry.longitude };
    if (isAtMadibaStore(location)) {
      return { ...entry, isFarFromCustomer: true };
    }
    if (entry.customerGpsUpdateAccepted === true) {
      return { ...entry, isFarFromCustomer: false };
    }
    const customer = byCode.get(String(entry.customerCode || "").trim().toUpperCase());
    if (!customer || !customerHasSavedLocation(customer)) return entry;
    return {
      ...entry,
      isFarFromCustomer: isFarFromCustomer(location, customer),
    };
  });
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
    customerGpsUpdateAccepted: row?.customerGpsUpdateAccepted === true,
  };
}

export function buildCurrentWorkingHoursEntry({
  transactionType = "VISIT_REPORT",
  savedAt = "",
  location = null,
  customer = {},
  customerCode = "",
  customerGpsUpdateAccepted = false,
} = {}) {
  const type = String(transactionType || "VISIT_REPORT").trim().toUpperCase();
  const accepted = customerGpsUpdateAccepted === true;
  const far = NEAR_CUSTOMER_TRANSACTION_TYPES.has(type)
    ? (isAtMadibaStore(location) || (!accepted && isFarFromCustomer(location, customer)))
    : false;
  return {
    savedAt: savedAt || new Date().toISOString(),
    transactionType: type,
    customerCode: customerCode || customer?.customer_code || "",
    latitude: location?.latitude,
    longitude: location?.longitude,
    isFarFromCustomer: far,
    customerGpsUpdateAccepted: accepted,
  };
}

function timelineRowFromActivityLogForHours(row) {
  const base = timelineRowFromActivityLog(row);
  const parsed = parseActivityNote(row?.note) || {};
  return {
    ...base,
    customerCode: parsed.customer_code || parsed.customerCode || "",
    customerGpsUpdateAccepted: parsed.customer_gps_update_accepted === true
      || parsed.customerGpsUpdateAccepted === true,
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

  const sorted = rows.sort((left, right) => rowTimestamp(left) - rowTimestamp(right));
  return applyCustomerFarFlags(sorted, await loadCustomerPins(supabase, sorted));
}

async function loadCustomerPins(supabase, entries = []) {
  const codes = [...new Set(
    (entries || [])
      .map((entry) => String(entry?.customerCode || "").trim().toUpperCase())
      .filter(Boolean),
  )];
  if (!codes.length) return [];
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("customer_code,latitude,longitude")
      .in("customer_code", codes);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * Load the Daily Visit Report working-hours total up to the WhatsApp message.
 * On timeout/offline, still compute from whatever entries are available
 * (including currentEntry) so queueFirst WhatsApp shows "0h" instead of "-".
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
        // Prefer a completed fetch; on timeout keep any prefetched stops so
        // queueFirst WhatsApp still shows the near-stop total instead of "-".
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
  const spacedBlock = `\n\n${line}\n\n`;

  const labelVariants = [
    labels.workingHours,
    WORKING_HOURS_WHATSAPP_LABELS.workingHours,
    "ساعات العمل",
  ].filter(Boolean);

  for (const label of labelVariants) {
    const pattern = new RegExp(`(?:\\n\\n|\\n)?^${escapeRegExp(label)}:\\s*.+(?:\\n\\n|\\n)?`, "m");
    if (pattern.test(text)) {
      return text.replace(pattern, spacedBlock).replace(/\n{3,}/g, "\n\n");
    }
  }

  const visitDatePatterns = [
    /^(Visit date\/time:\s*.+)$/m,
    /^(تاريخ ووقت الزيارة:\s*.+)$/m,
  ];
  for (const pattern of visitDatePatterns) {
    if (pattern.test(text)) {
      return text.replace(pattern, `$1${spacedBlock}`).replace(/\n{3,}/g, "\n\n");
    }
  }

  const gpsPattern = /\nGPS:/;
  if (gpsPattern.test(text)) {
    return text.replace(gpsPattern, `${spacedBlock}GPS:`).replace(/\n{3,}/g, "\n\n");
  }

  return `${text.trimEnd()}${spacedBlock}`.replace(/\n{3,}/g, "\n\n").trimEnd();
}
