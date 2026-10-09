import { isFarFromCustomer } from "./customerLocation.js";
import { parseGpsFromActivityNote } from "./geo.js";
import { getKsaDateString } from "./workdayActivity.js";

const VISIT_LOG_TYPES = ["VISIT_REPORT", "PROSPECT_FOLLOW_UP", "NOTE"];
const FIELD_VISIT_LOG_TYPES = new Set(["VISIT_REPORT", "PROSPECT_FOLLOW_UP"]);
const VISIT_LOG_ROW_LIMIT = 5000;
const VISIT_QUERY_BATCH_SIZE = 80;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function parseNote(value) {
  try {
    return JSON.parse(String(value || "null")) || {};
  } catch {
    return {};
  }
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAcceptedGpsUpdate(note) {
  return note?.customer_gps_update_accepted === true
    || note?.gps_location_update_accepted === true
    || note?.action === "CUSTOMER_GPS_UPDATE_ACCEPTED";
}

export function buildLatestNearVisitDatesByCustomer(
  customers = [],
  { collectionVisits = [], activityLogs = [] } = {},
) {
  const customerByCode = new Map();
  (customers || []).forEach((customer) => {
    const code = normalizeCode(customer?.customer_code);
    if (code) customerByCode.set(code, customer);
  });

  const acceptedCollectionIds = new Set();
  (activityLogs || []).forEach((row) => {
    const note = parseNote(row?.note);
    const collectionId = String(note?.collection_visit_id || "").trim();
    if (collectionId && isAcceptedGpsUpdate(note)) acceptedCollectionIds.add(collectionId);
  });

  const latestAtByCode = new Map();
  function consider(codeValue, atValue, location, accepted = false) {
    const code = normalizeCode(codeValue);
    const customer = customerByCode.get(code);
    const at = String(atValue || "").trim();
    const ms = timestampMs(at);
    if (!customer || !ms || (!accepted && isFarFromCustomer(location, customer))) return;
    if (ms > timestampMs(latestAtByCode.get(code))) latestAtByCode.set(code, at);
  }

  (collectionVisits || []).forEach((visit) => {
    consider(
      visit?.customer_code,
      visit?.saved_at,
      { latitude: visit?.latitude, longitude: visit?.longitude },
      acceptedCollectionIds.has(String(visit?.id || "")),
    );
  });

  (activityLogs || []).forEach((row) => {
    const note = parseNote(row?.note);
    const entryType = String(row?.entry_type || "").trim().toUpperCase();
    if (!FIELD_VISIT_LOG_TYPES.has(entryType)) return;
    consider(
      note?.customer_code || note?.customerCode,
      note?.captured_at || note?.capturedAt || row?.created_at,
      parseGpsFromActivityNote(row?.note),
      isAcceptedGpsUpdate(note),
    );
  });

  return new Map([...latestAtByCode].map(([code, at]) => [code, getKsaDateString(new Date(at))]));
}

export function daysSinceKsaDate(value, todayKey = getKsaDateString()) {
  const date = String(value || "").trim().slice(0, 10);
  const today = String(todayKey || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
}

function missingTable(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function missingColumn(error) {
  return error?.code === "42703"
    || /column .* does not exist/i.test(String(error?.message || ""));
}

export async function loadLatestNearVisitDatesByCustomer(admin, customers = [], { now = new Date() } = {}) {
  const codes = [...new Set((customers || []).map((row) => normalizeCode(row?.customer_code)).filter(Boolean))];
  if (!codes.length) return new Map();

  const sinceIso = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const collectionVisits = [];
  let collectionTableMissing = false;
  for (let start = 0; start < codes.length; start += VISIT_QUERY_BATCH_SIZE) {
    const batch = codes.slice(start, start + VISIT_QUERY_BATCH_SIZE);
    for (let from = 0; from < 5000; from += 1000) {
      let result = await admin
        .from("collection_visits")
        .select("id,customer_code,saved_at,latitude,longitude")
        .in("customer_code", batch)
        .gte("saved_at", sinceIso)
        .order("saved_at", { ascending: false })
        .range(from, from + 999);
      if (result.error && missingColumn(result.error)) {
        result = await admin
          .from("collection_visits")
          .select("id,customer_code,saved_at")
          .in("customer_code", batch)
          .gte("saved_at", sinceIso)
          .order("saved_at", { ascending: false })
          .range(from, from + 999);
      }
      if (result.error && missingTable(result.error)) {
        collectionTableMissing = true;
        break;
      }
      if (result.error) throw result.error;
      const rows = result.data || [];
      collectionVisits.push(...rows);
      if (rows.length < 1000) break;
    }
    if (collectionTableMissing) break;
  }

  const activityLogs = [];
  for (let from = 0; from < VISIT_LOG_ROW_LIMIT; from += 1000) {
    const end = Math.min(from + 1000, VISIT_LOG_ROW_LIMIT) - 1;
    const { data, error } = await admin
      .from("daily_activity_logs")
      .select("entry_type,note,created_at")
      .in("entry_type", VISIT_LOG_TYPES)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, end);
    if (error) {
      if (missingTable(error)) break;
      throw error;
    }
    activityLogs.push(...(data || []));
    if ((data || []).length < 1000) break;
  }

  return buildLatestNearVisitDatesByCustomer(customers, { collectionVisits, activityLogs });
}