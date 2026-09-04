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

export const LOGGED_WORK_ACTIVITY_TYPES = [
  "VISIT_REPORT",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "ORDER_SUBMITTED",
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

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703"
    || (message.includes("column") && message.includes("does not exist"));
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
    autoClosed: Boolean(parsed.autoClosed),
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
  let logoutAutoClosed = false;
  let lunchOutAt = null;
  let lunchInAt = null;

  (workdayRows || []).forEach((row) => {
    if (row.entryType === "MORNING_ATTENDANCE" && !loginAt) {
      loginAt = row.saved_at;
    }
    if (row.entryType === "END_OF_DAY") {
      logoutAt = row.saved_at;
      logoutAutoClosed = Boolean(row.autoClosed);
    }
    if (row.entryType === "LUNCH_BREAK_OUT" && !lunchOutAt) {
      lunchOutAt = row.saved_at;
    }
    if (row.entryType === "LUNCH_BREAK_IN" && lunchOutAt && !lunchInAt) {
      lunchInAt = row.saved_at;
    }
  });

  return { loginAt, logoutAt, logoutAutoClosed, lunchOutAt, lunchInAt };
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

export async function loadLoggedActivityTimesByUser(admin, userIds, startIso, endIso, reportDate) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .in("entry_type", LOGGED_WORK_ACTIVITY_TYPES)
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
    const parsed = parseActivityNote(row.note) || {};
    const savedAt = parsed.captured_at || parsed.capturedAt || row.created_at;
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
    grouped.get(row.user_id).push({ savedAt, saved_at: savedAt, entryType: row.entry_type });
  });

  return grouped;
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

async function loadSubmittedOrderStats(admin, userId, startIso, endIso) {
  if (!userId) return { orderCount: 0, orderValue: 0 };

  let query = admin
    .from("sales_orders")
    .select("id,total_value,status,submitted_at,created_at")
    .eq("created_by", userId)
    .eq("status", "SUBMITTED")
    .gte("submitted_at", startIso)
    .lte("submitted_at", endIso);

  let { data, error } = await query;
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await admin
      .from("sales_orders")
      .select("id,total_value,status,created_at")
      .eq("created_by", userId)
      .eq("status", "SUBMITTED")
      .gte("created_at", startIso)
      .lte("created_at", endIso));
  }

  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) {
      return { orderCount: 0, orderValue: 0 };
    }
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    orderCount: rows.length,
    orderValue: rows.reduce((sum, row) => sum + Number(row?.total_value || 0), 0),
  };
}

export async function loadCollectionDaySummaryForUser(admin, userId, date = getKsaDateString(), { activities } = {}) {
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
          items: emptyEn.items,
          itemsAr: emptyAr.items,
          stats: emptyEn.stats,
          idleGaps: emptyEn.idleGaps,
        },
        summaryTextEn: emptyEn.lines.join("\n"),
        summaryTextAr: emptyAr.lines.join("\n"),
      };
    }
    throw error;
  }

  const visitRows = Array.isArray(visits) ? visits : [];
  const customerCodes = [...new Set(visitRows.map((row) => normalizeCode(row.customer_code)).filter(Boolean))];
  const [customerLocationByCode, workdayRows, loggedActivities, orderStats] = await Promise.all([
    loadCustomerLocationMap(admin, customerCodes),
    loadWorkdayEventsForUser(admin, userId, startIso, endIso, date),
    activities
      ? Promise.resolve(null)
      : loadLoggedActivityTimesByUser(admin, [userId], startIso, endIso, date),
    loadSubmittedOrderStats(admin, userId, startIso, endIso),
  ]);
  const workdayEvents = {
    ...extractWorkdayTimesFromTimelineRows(workdayRows),
    activities: activities || loggedActivities?.get(userId) || [],
    orderStats,
  };

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
      items: daySummaryEn.items,
      itemsAr: daySummaryAr.items,
      stats: daySummaryEn.stats,
      idleGaps: daySummaryEn.idleGaps,
    },
    summaryTextEn: daySummaryEn.lines.join("\n"),
    summaryTextAr: daySummaryAr.lines.join("\n"),
  };
}
