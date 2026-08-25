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

const LUNCH_ENTRY_TYPES = ["LUNCH_BREAK_OUT", "LUNCH_BREAK_IN"];

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

function extractLunchTimesFromTimelineRows(lunchRows) {
  let lunchOutAt = null;
  let lunchInAt = null;

  (lunchRows || []).forEach((row) => {
    if (row.entryType === "LUNCH_BREAK_OUT" && !lunchOutAt) {
      lunchOutAt = row.saved_at;
    }
    if (row.entryType === "LUNCH_BREAK_IN" && lunchOutAt && !lunchInAt) {
      lunchInAt = row.saved_at;
    }
  });

  return { lunchOutAt, lunchInAt };
}

async function loadLunchEventsForUser(admin, userId, startIso, endIso, reportDate) {
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .in("entry_type", LUNCH_ENTRY_TYPES)
    .eq("user_id", userId)
    .gte("created_at", widenedStart.toISOString())
    .lte("created_at", widenedEnd.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return filterLogsByKsaEventDate(data || [], reportDate).map((row) => {
    const parsed = parseActivityNote(row.note) || {};
    const gps = parseGpsFromActivityNote(row.note) || {};
    const savedAt = parsed.captured_at || parsed.capturedAt || row.created_at;

    return {
      id: `lunch-${row.id}`,
      rowType: "lunch",
      entryType: row.entry_type,
      saved_at: savedAt,
      area: extractAreaFromActivityNote(row.note),
      street: extractStreetFromActivityNote(row.note),
      latitude: gps.latitude,
      longitude: gps.longitude,
    };
  });
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
      const emptyEn = buildCollectionDaySummary([], new Map(), null, COLLECTION_DAY_SUMMARY_LABELS);
      const emptyAr = buildCollectionDaySummary([], new Map(), null, COLLECTION_DAY_SUMMARY_LABELS_AR);
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
  const [customerLocationByCode, lunchRows] = await Promise.all([
    loadCustomerLocationMap(admin, customerCodes),
    loadLunchEventsForUser(admin, userId, startIso, endIso, date),
  ]);
  const lunchEvents = extractLunchTimesFromTimelineRows(lunchRows);

  const daySummaryEn = buildCollectionDaySummary(
    visitRows,
    customerLocationByCode,
    lunchEvents,
    COLLECTION_DAY_SUMMARY_LABELS,
  );
  const daySummaryAr = buildCollectionDaySummary(
    visitRows,
    customerLocationByCode,
    lunchEvents,
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
