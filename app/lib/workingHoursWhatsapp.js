import { isFarFromCustomer } from "./customerLocation.js";
import { resolveDayRouteWorkingHours } from "./dayRouteMap.js";
import { todayAttendanceBounds } from "./morningAttendance.js";
import {
  timelineRowFromActivityLog,
  timelineRowFromCollectionVisit,
} from "./visitDistanceWhatsapp.js";

export const WORKING_HOURS_WHATSAPP_LABELS = {
  workingHours: "Working hours",
};

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

/**
 * Compute day-route working hours from entries at or before untilAt.
 * Optionally append the current stop (this WhatsApp message's visit/order).
 */
export function resolveWorkingHoursTillMessage({
  entries = [],
  untilAt = "",
  idleGaps = [],
  currentEntry = null,
} = {}) {
  const cutoffTs = Date.parse(String(untilAt || ""));
  const cutoff = Number.isFinite(cutoffTs) ? cutoffTs : Date.now();

  const prior = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const at = entry?.savedAt || entry?.saved_at || null;
      const ts = Date.parse(String(at || ""));
      if (!at || !Number.isFinite(ts) || ts > cutoff) return null;
      return {
        ...entry,
        savedAt: at,
        transactionType: entryType(entry),
        isFarFromCustomer: Boolean(entry?.isFarFromCustomer),
      };
    })
    .filter(Boolean);

  if (currentEntry) {
    const at = currentEntry.savedAt || currentEntry.saved_at || untilAt || new Date(cutoff).toISOString();
    const type = entryType(currentEntry) || "VISIT_REPORT";
    const currentTs = Date.parse(String(at || ""));
    if (at && Number.isFinite(currentTs) && currentTs <= cutoff + 1000) {
      const alreadyPresent = prior.some((entry) => (
        entryType(entry) === type
        && Math.abs(rowTimestamp(entry) - currentTs) < 2000
        && String(entry.customerCode || entry.customer_code || "")
          === String(currentEntry.customerCode || currentEntry.customer_code || "")
      ));
      if (!alreadyPresent) {
        prior.push({
          ...currentEntry,
          savedAt: at,
          transactionType: type,
          isFarFromCustomer: Boolean(currentEntry.isFarFromCustomer),
        });
      }
    }
  }

  const gaps = (idleGaps || []).filter((gap) => {
    const start = Date.parse(gap?.fromAt);
    return Number.isFinite(start) && start <= cutoff;
  });

  const resolved = resolveDayRouteWorkingHours(prior, gaps);
  return {
    known: true,
    minutes: Number(resolved.minutes || 0),
    value: resolved.value || "0h",
    ranges: resolved.ranges || [],
  };
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

  try {
    const { data, error } = await supabase
      .from("daily_activity_logs")
      .select("id,user_id,entry_type,note,created_at")
      .eq("user_id", userId)
      .in("entry_type", WORKING_HOURS_ACTIVITY_ENTRY_TYPES)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(400);
    if (!error) {
      (data || []).forEach((row) => {
        const entry = workingHoursEntryFromTimelineRow(timelineRowFromActivityLogForHours(row));
        if (entry) rows.push(entry);
      });
    }
  } catch {
    // Ignore missing tables or RLS errors; WhatsApp still includes Working hours as "-".
  }

  try {
    const { data, error } = await supabase
      .from("collection_visits")
      .select("id,saved_at,latitude,longitude,created_by,customer_code")
      .eq("created_by", userId)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true })
      .limit(200);
    if (!error) {
      (data || []).forEach((row) => {
        const entry = workingHoursEntryFromTimelineRow({
          ...timelineRowFromCollectionVisit(row),
          customerCode: row.customer_code,
        });
        if (entry) rows.push(entry);
      });
    }
  } catch {
    // Ignore missing tables or RLS errors.
  }

  return rows.sort((left, right) => rowTimestamp(left) - rowTimestamp(right));
}

/**
 * Load cumulative working hours until the WhatsApp message time.
 * When skipTimeline is true (offline-first saves), returns unknown "-" unless
 * localEntries are provided. A short timelineTimeoutMs can still attempt a fetch.
 */
export async function loadWorkingHoursTillMessage({
  supabase,
  userId,
  savedAt = "",
  currentEntry = null,
  skipTimeline = false,
  timelineTimeoutMs = 0,
  localEntries = null,
  idleGaps = [],
} = {}) {
  const capturedAt = savedAt || new Date().toISOString();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  let entries = Array.isArray(localEntries) ? localEntries : null;

  if (!entries && !offline && (!skipTimeline || timelineTimeoutMs > 0)) {
    try {
      const timelinePromise = loadTodayWorkingHoursEntries(supabase, userId);
      entries = timelineTimeoutMs > 0
        ? await Promise.race([
          timelinePromise,
          new Promise((resolve) => {
            setTimeout(() => resolve(null), timelineTimeoutMs);
          }),
        ])
        : await timelinePromise;
    } catch {
      entries = null;
    }
  }

  if (!entries) {
    return { known: false, minutes: null, value: "-", ranges: [] };
  }

  return resolveWorkingHoursTillMessage({
    entries,
    untilAt: capturedAt,
    idleGaps,
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
