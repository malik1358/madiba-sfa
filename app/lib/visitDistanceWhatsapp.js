import { distanceFromCustomerKm } from "./customerLocation.js";
import {
  computeWaitingMinutes,
  formatDurationMinutes,
  haversineDistanceKm,
  hasGpsCoordinates,
  isIdleGpsPingTimelineRow,
  parseGpsFromActivityNote,
} from "./geo.js";
import { todayAttendanceBounds } from "./morningAttendance.js";

export const VISIT_DISTANCE_ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "ORDER_SUBMITTED",
  "GPS_PING",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
  "NOTE",
  "PROSPECT_FOLLOW_UP",
  "PROSPECT_REGISTERED",
];

export const VISIT_DISTANCE_WHATSAPP_LABELS = {
  distanceFromCustomer: "Distance from customer",
  distanceFromPrevious: "Distance from previous",
  estWaiting: "Est. waiting",
};

function parseActivityNote(note) {
  if (!note) return null;
  if (typeof note === "object") return note;
  try {
    return JSON.parse(note);
  } catch {
    return null;
  }
}

export function formatVisitDistanceKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "-";
  return `${number.toFixed(2)} km`;
}

export function formatVisitDistanceWhatsappLines(metrics = {}, labels = VISIT_DISTANCE_WHATSAPP_LABELS) {
  const waiting = metrics.waitingMinutes == null
    ? "-"
    : formatDurationMinutes(metrics.waitingMinutes);
  return [
    "",
    `${labels.distanceFromCustomer}: ${formatVisitDistanceKm(metrics.distanceFromCustomerKm)}`,
    `${labels.distanceFromPrevious}: ${formatVisitDistanceKm(metrics.distanceFromPreviousKm)}`,
    `${labels.estWaiting}: ${waiting}`,
  ];
}

export function resolveVisitDistanceMetrics({
  location = null,
  customer = {},
  previousGpsRow = null,
  previousVisitRow = null,
  savedAt = "",
} = {}) {
  const distanceFromCustomer = distanceFromCustomerKm(location, customer);
  let distanceFromPreviousKm = null;
  if (hasGpsCoordinates(location) && hasGpsCoordinates(previousGpsRow)) {
    distanceFromPreviousKm = haversineDistanceKm(
      Number(previousGpsRow.latitude),
      Number(previousGpsRow.longitude),
      Number(location.latitude),
      Number(location.longitude),
    );
  }

  let waitingMinutes = null;
  if (
    previousVisitRow
    && hasGpsCoordinates(location)
    && hasGpsCoordinates(previousVisitRow)
  ) {
    const waitingDistanceKm = haversineDistanceKm(
      Number(previousVisitRow.latitude),
      Number(previousVisitRow.longitude),
      Number(location.latitude),
      Number(location.longitude),
    );
    waitingMinutes = computeWaitingMinutes(
      waitingDistanceKm,
      previousVisitRow.savedAt || previousVisitRow.saved_at,
      savedAt,
    );
  }

  return {
    distanceFromCustomerKm: distanceFromCustomer,
    distanceFromPreviousKm,
    waitingMinutes,
  };
}

export function timelineRowFromActivityLog(row) {
  const parsed = parseActivityNote(row?.note) || {};
  const gps = parseGpsFromActivityNote(row?.note) || {};
  return {
    savedAt: parsed.captured_at || parsed.capturedAt || row?.created_at,
    transactionType: String(row?.entry_type || parsed.action || "").trim().toUpperCase(),
    latitude: gps.latitude,
    longitude: gps.longitude,
  };
}

export function timelineRowFromCollectionVisit(row) {
  return {
    savedAt: row?.saved_at || row?.savedAt,
    transactionType: "COLLECTION_VISIT",
    latitude: row?.latitude,
    longitude: row?.longitude,
  };
}

function rowTimestamp(row) {
  const ts = Date.parse(row?.savedAt || row?.saved_at || "");
  return Number.isFinite(ts) ? ts : 0;
}

export function findPreviousVisitDistanceAnchors(rows = [], savedAt = "") {
  const currentTs = Date.parse(savedAt);
  const cutoff = Number.isFinite(currentTs) ? currentTs : Date.now();
  const previousRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => rowTimestamp(row) > 0 && rowTimestamp(row) < cutoff)
    .sort((left, right) => rowTimestamp(left) - rowTimestamp(right));

  let previousGpsRow = null;
  let previousVisitRow = null;
  previousRows.forEach((row) => {
    if (hasGpsCoordinates(row)) previousGpsRow = row;
    if (!isIdleGpsPingTimelineRow(row)) previousVisitRow = row;
  });

  return { previousGpsRow, previousVisitRow };
}

export async function loadTodayVisitTimelineRows(supabase, userId) {
  if (!supabase || !userId) return [];

  const { startIso, endIso } = todayAttendanceBounds();
  const rows = [];

  try {
    const { data, error } = await supabase
      .from("daily_activity_logs")
      .select("id,user_id,entry_type,note,created_at")
      .eq("user_id", userId)
      .in("entry_type", VISIT_DISTANCE_ACTIVITY_ENTRY_TYPES)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!error) {
      (data || []).forEach((row) => rows.push(timelineRowFromActivityLog(row)));
    }
  } catch {
    // Ignore missing tables or RLS errors; WhatsApp still includes the fields as "-".
  }

  try {
    const { data, error } = await supabase
      .from("collection_visits")
      .select("id,saved_at,latitude,longitude,created_by")
      .eq("created_by", userId)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true })
      .limit(200);
    if (!error) {
      (data || []).forEach((row) => rows.push(timelineRowFromCollectionVisit(row)));
    }
  } catch {
    // Ignore missing tables or RLS errors.
  }

  return rows.sort((left, right) => rowTimestamp(left) - rowTimestamp(right));
}

export async function loadVisitDistanceMetrics({
  supabase,
  userId,
  location = null,
  customer = {},
  savedAt = "",
} = {}) {
  const capturedAt = savedAt || new Date().toISOString();
  let previousGpsRow = null;
  let previousVisitRow = null;
  try {
    const timeline = await loadTodayVisitTimelineRows(supabase, userId);
    ({ previousGpsRow, previousVisitRow } = findPreviousVisitDistanceAnchors(timeline, capturedAt));
  } catch {
    previousGpsRow = null;
    previousVisitRow = null;
  }

  return resolveVisitDistanceMetrics({
    location,
    customer,
    previousGpsRow,
    previousVisitRow,
    savedAt: capturedAt,
  });
}
