import {
  buildCollectionDaySummary,
  COLLECTION_DAY_SUMMARY_LABELS,
  COLLECTION_DAY_SUMMARY_LABELS_AR,
} from "./collectionDaySummary.js";
import {
  extractAreaFromActivityNote,
  extractStreetFromActivityNote,
  parseGpsFromActivityNote,
} from "./geo.js";
import { filterLogsByKsaEventDate, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const WORKDAY_ENTRY_TYPES = [
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
];

export const WORKDAY_EVENT_LABELS = {
  MORNING_ATTENDANCE: "Login",
  END_OF_DAY: "Logout",
  LUNCH_BREAK_OUT: "Lunch out",
  LUNCH_BREAK_IN: "Lunch in",
  UNLOGGED_IDLE: "Unlogged idle",
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function parseActivityNote(note) {
  if (!note) return null;
  try {
    return typeof note === "string" ? JSON.parse(note) : note;
  } catch {
    return null;
  }
}

export function mapWorkdayLogToTimelineRow(row) {
  const parsed = parseActivityNote(row.note) || {};
  const gps = parseGpsFromActivityNote(row.note) || {};
  const savedAt = parsed.captured_at || parsed.capturedAt || row.created_at;
  const entryType = row.entry_type;
  const isLunch = entryType === "LUNCH_BREAK_OUT" || entryType === "LUNCH_BREAK_IN";

  return {
    id: `workday-${row.id}`,
    rowType: isLunch ? "lunch" : "attendance",
    entryType,
    saved_at: savedAt,
    created_by: row.user_id,
    latitude: gps.latitude,
    longitude: gps.longitude,
    gps_accuracy_meters: gps.accuracy,
    area: extractAreaFromActivityNote(row.note),
    street: extractStreetFromActivityNote(row.note),
  };
}

export function extractWorkdayTimesFromTimelineRows(workdayRows) {
  let loginAt = null;
  let logoutAt = null;
  let lunchOutAt = null;
  let lunchInAt = null;

  (workdayRows || []).forEach((row) => {
    if (row.entryType === "MORNING_ATTENDANCE" && !loginAt) {
      loginAt = row.saved_at;
    }
    if (row.entryType === "END_OF_DAY") {
      logoutAt = row.saved_at;
    }
    if (row.entryType === "LUNCH_BREAK_OUT" && !lunchOutAt) {
      lunchOutAt = row.saved_at;
    }
    if (row.entryType === "LUNCH_BREAK_IN" && lunchOutAt && !lunchInAt) {
      lunchInAt = row.saved_at;
    }
  });

  return { loginAt, logoutAt, lunchOutAt, lunchInAt };
}

export async function loadWorkdayEventsByUser(admin, userIds, startIso, endIso, reportDate) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .in("entry_type", WORKDAY_ENTRY_TYPES)
    .in("user_id", ids)
    .gte("created_at", widenedStart.toISOString())
    .lte("created_at", widenedEnd.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }

  const grouped = new Map();
  filterLogsByKsaEventDate(data || [], reportDate).forEach((row) => {
    const event = mapWorkdayLogToTimelineRow(row);
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
    grouped.get(row.user_id).push(event);
  });

  return grouped;
}

async function loadWorkdayEventsForUser(admin, userId, startIso, endIso, reportDate) {
  const grouped = await loadWorkdayEventsByUser(admin, [userId], startIso, endIso, reportDate);
  return grouped.get(userId) || [];
}

async function loadCustomerLocationMap(admin, customerCodes) {
  if (!customerCodes.length) return new Map();

  let selectFields = "customer_code,city,area,street";
  let { data, error } = await admin
    .from("customers")
    .select(selectFields)
    .in("customer_code", customerCodes);

  if (error && String(error?.message || "").toLowerCase().includes("street")) {
    selectFields = "customer_code,city,area";
    ({ data, error } = await admin
      .from("customers")
      .select(selectFields)
      .in("customer_code", customerCodes));
  }

  if (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }

  return new Map((data || []).map((row) => [normalizeCode(row.customer_code), row]));
}

export async function loadCollectionDaySummaryForUser(admin, userId, date = getKsaDateString()) {
  const { startIso, endIso } = ksaDayBounds(date);

  const { data: visits, error } = await admin
    .from("collection_visits")
    .select("customer_code,visit_outcome,amount_received,saved_at")
    .eq("created_by", userId)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso)
    .order("saved_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      const emptyEn = buildCollectionDaySummary([], new Map(), {}, COLLECTION_DAY_SUMMARY_LABELS);
      const emptyAr = buildCollectionDaySummary([], new Map(), {}, COLLECTION_DAY_SUMMARY_LABELS_AR);
      return {
        date,
        hasVisits: false,
        daySummary: {
          lines: emptyEn.lines,
          linesAr: emptyAr.lines,
          stats: emptyEn.stats,
        },
        summaryTextEn: emptyEn.lines.join("\n"),
        summaryTextAr: emptyAr.lines.join("\n"),
      };
    }
    throw error;
  }

  const visitRows = Array.isArray(visits) ? visits : [];
  const customerCodes = [...new Set(visitRows.map((row) => normalizeCode(row.customer_code)).filter(Boolean))];
  const [customerLocationByCode, workdayRows] = await Promise.all([
    loadCustomerLocationMap(admin, customerCodes),
    loadWorkdayEventsForUser(admin, userId, startIso, endIso, date),
  ]);
  const workdayEvents = extractWorkdayTimesFromTimelineRows(workdayRows);

  const daySummaryEn = buildCollectionDaySummary(
    visitRows,
    customerLocationByCode,
    workdayEvents,
    COLLECTION_DAY_SUMMARY_LABELS,
  );
  const daySummaryAr = buildCollectionDaySummary(
    visitRows,
    customerLocationByCode,
    workdayEvents,
    COLLECTION_DAY_SUMMARY_LABELS_AR,
  );

  return {
    date,
    hasVisits: visitRows.length > 0,
    daySummary: {
      lines: daySummaryEn.lines,
      linesAr: daySummaryAr.lines,
      stats: daySummaryEn.stats,
    },
    summaryTextEn: daySummaryEn.lines.join("\n"),
    summaryTextAr: daySummaryAr.lines.join("\n"),
  };
}
