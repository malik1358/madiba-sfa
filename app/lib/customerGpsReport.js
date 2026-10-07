import { haversineDistanceKm } from "./geo.js";
import { CUSTOMER_GPS_SOURCE } from "./customerGpsHistory.js";
import { addKsaCalendarDays, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const GPS_HISTORY_SELECT = "id,customer_code,latitude,longitude,previous_latitude,previous_longitude,source,updated_by,updated_by_name,created_at";

export function parseGpsReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getKsaDateString(new Date(ksaDayBounds(date).startIso)) !== date) {
    throw new Error("Invalid GPS report date. Use a real YYYY-MM-DD date.");
  }
  return date;
}

export function gpsReportRange(from, to) {
  const start = parseGpsReportDate(from);
  const end = parseGpsReportDate(to);
  if (start > end) throw new Error("From date must not be after To date.");
  return { startIso: ksaDayBounds(start).startIso, endExclusive: ksaDayBounds(addKsaCalendarDays(end, 1)).startIso };
}

function validPoint(latitude, longitude) {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function gpsReportRow(row, customerName = "") {
  const oldValid = validPoint(row.previous_latitude, row.previous_longitude);
  const newValid = validPoint(row.latitude, row.longitude);
  const distance = oldValid && newValid
    ? haversineDistanceKm(Number(row.previous_latitude), Number(row.previous_longitude), Number(row.latitude), Number(row.longitude)) * 1000
    : null;
  const acceptance = distance > 0 && row.source === CUSTOMER_GPS_SOURCE.salesmanAccepted
    ? "confirmed_salesman"
    : distance > 0 && row.source === CUSTOMER_GPS_SOURCE.visitAccepted ? "confirmed_other" : "not_recorded";
  return {
    ...row,
    customer_name: customerName,
    distance_meters: distance,
    acceptance,
    old_map_url: oldValid ? `https://www.google.com/maps?q=${row.previous_latitude},${row.previous_longitude}` : "",
    new_map_url: newValid ? `https://www.google.com/maps?q=${row.latitude},${row.longitude}` : "",
  };
}

export function gpsHistoryQuery(admin, { from, to, customerCode = "", acceptedOnly = false, count = false }) {
  const range = gpsReportRange(from, to);
  let query = admin.from("customer_gps_history")
    .select(GPS_HISTORY_SELECT, count ? { count: "exact" } : undefined)
    .gte("created_at", range.startIso)
    .lt("created_at", range.endExclusive);
  if (customerCode) query = query.eq("customer_code", customerCode);
  if (acceptedOnly) query = query.eq("source", CUSTOMER_GPS_SOURCE.salesmanAccepted);
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
}

export async function hydrateGpsHistory(admin, history) {
  const names = new Map();
  const codes = [...new Set(history.map((row) => row.customer_code).filter(Boolean))];
  for (let offset = 0; offset < codes.length; offset += 200) {
    const { data, error } = await admin.from("customers").select("customer_code,customer_name").in("customer_code", codes.slice(offset, offset + 200));
    if (error) throw error;
    for (const row of data || []) names.set(row.customer_code, row.customer_name);
  }
  return history.map((row) => gpsReportRow(row, names.get(row.customer_code) || ""));
}

export async function loadAcceptedGpsChanges(admin, date) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await gpsHistoryQuery(admin, { from: date, to: date, acceptedOnly: true }).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return (await hydrateGpsHistory(admin, rows)).filter((row) => row.acceptance === "confirmed_salesman");
}