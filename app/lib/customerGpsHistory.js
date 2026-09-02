import { coordinateCacheKey } from "./geo.js";

export const CUSTOMER_GPS_SOURCE = {
  customerMaster: "customer_master",
  visit: "visit",
  excelImport: "excel_import",
};

export const CUSTOMER_GPS_AUDIT_SELECT = "gps_updated_at,gps_updated_by,gps_updated_by_name,gps_update_source";
export const CUSTOMER_LOCATION_SELECT = `customer_code,customer_name,latitude,longitude,city,area,${CUSTOMER_GPS_AUDIT_SELECT}`;
export const CUSTOMER_MASTER_GPS_SELECT = `customer_code,customer_name,current_salesman_code,previous_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date,${CUSTOMER_GPS_AUDIT_SELECT}`;
export const CUSTOMER_MASTER_GPS_SELECT_FALLBACK = "customer_code,customer_name,current_salesman_code,previous_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date";

export function isMissingGpsAuditError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "42703"
    || code === "42P01"
    || (message.includes("column") && message.includes("does not exist"))
    || (message.includes("relation") && message.includes("does not exist"))
    || message.includes("could not find the table");
}

export function gpsCoordinatesEqual(leftLat, leftLng, rightLat, rightLng, precision = 6) {
  const leftKey = coordinateCacheKey(leftLat, leftLng, precision);
  const rightKey = coordinateCacheKey(rightLat, rightLng, precision);
  if (!leftKey && !rightKey) return true;
  return Boolean(leftKey) && leftKey === rightKey;
}

export function formatGpsActorName(profile = {}) {
  const salesmanName = String(profile.salesman_name || profile.name || "").trim();
  const salesmanCode = String(profile.salesman_code || "").trim();
  const email = String(profile.email || "").trim();
  const role = String(profile.role || "").trim();
  if (salesmanName && salesmanCode) return `${salesmanName} (${salesmanCode})`;
  if (salesmanName) return salesmanName;
  if (email) return email;
  if (salesmanCode) return salesmanCode;
  return role || "Unknown user";
}

export function formatGpsUpdatedAt(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString("en-GB");
}

export function gpsSourceLabel(source) {
  const value = String(source || "").trim().toLowerCase();
  if (value === CUSTOMER_GPS_SOURCE.customerMaster) return "Customer Master";
  if (value === CUSTOMER_GPS_SOURCE.visit) return "Visit GPS";
  if (value === CUSTOMER_GPS_SOURCE.excelImport) return "Excel import";
  return value || "Unknown";
}

function actorUserId(actor = {}) {
  return actor.id || actor.userId || null;
}

export function buildCustomerGpsAuditPayload({ latitude, longitude, actor, source }) {
  const now = new Date().toISOString();
  return {
    latitude,
    longitude,
    gps_updated_at: now,
    gps_updated_by: actorUserId(actor),
    gps_updated_by_name: formatGpsActorName(actor),
    gps_update_source: source || "unknown",
    updated_at: now,
  };
}

export async function recordCustomerGpsHistory(admin, entry) {
  const { error } = await admin.from("customer_gps_history").insert({
    customer_code: String(entry.customerCode || "").trim(),
    latitude: entry.latitude ?? null,
    longitude: entry.longitude ?? null,
    previous_latitude: entry.previousLatitude ?? null,
    previous_longitude: entry.previousLongitude ?? null,
    source: entry.source || "unknown",
    updated_by: actorUserId(entry.actor),
    updated_by_name: formatGpsActorName(entry.actor),
  });

  if (error && !isMissingGpsAuditError(error)) throw error;
}

export async function applyCustomerGpsUpdate(admin, {
  customerCode,
  latitude,
  longitude,
  previousLatitude,
  previousLongitude,
  actor = {},
  source = "unknown",
  extraUpdate = {},
  selectColumns = CUSTOMER_MASTER_GPS_SELECT,
} = {}) {
  const code = String(customerCode || "").trim();
  if (!code) throw new Error("Customer code is required");

  let previousLat = previousLatitude;
  let previousLng = previousLongitude;
  if (previousLat === undefined || previousLng === undefined) {
    const { data: existing, error: existingError } = await admin
      .from("customers")
      .select("latitude,longitude")
      .eq("customer_code", code)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error("Customer not found.");
    previousLat = existing.latitude;
    previousLng = existing.longitude;
  }

  const clearing = latitude === null && longitude === null;
  const changed = clearing
    ? previousLat != null || previousLng != null
    : !gpsCoordinatesEqual(previousLat, previousLng, latitude, longitude);

  const baseUpdate = {
    ...extraUpdate,
    latitude: clearing ? null : latitude,
    longitude: clearing ? null : longitude,
    updated_at: extraUpdate.updated_at || new Date().toISOString(),
  };

  if (!changed) {
    const extraKeys = Object.keys(extraUpdate || {}).filter((key) => extraUpdate[key] !== undefined);
    if (extraKeys.length) {
      const { data, error } = await admin
        .from("customers")
        .update({ ...extraUpdate, updated_at: extraUpdate.updated_at || new Date().toISOString() })
        .eq("customer_code", code)
        .select(selectColumns)
        .maybeSingle();
      if (error && isMissingGpsAuditError(error)) {
        const fallback = await admin
          .from("customers")
          .update({ ...extraUpdate, updated_at: extraUpdate.updated_at || new Date().toISOString() })
          .eq("customer_code", code)
          .select(CUSTOMER_MASTER_GPS_SELECT_FALLBACK)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        return fallback.data;
      }
      if (error) throw error;
      return data;
    }

    const { data, error } = await admin
      .from("customers")
      .select(selectColumns)
      .eq("customer_code", code)
      .maybeSingle();
    if (error && isMissingGpsAuditError(error)) {
      const fallback = await admin
        .from("customers")
        .select(CUSTOMER_MASTER_GPS_SELECT_FALLBACK)
        .eq("customer_code", code)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return fallback.data;
    }
    if (error) throw error;
    return data;
  }

  const auditUpdate = {
    ...baseUpdate,
    ...buildCustomerGpsAuditPayload({
      latitude: clearing ? null : latitude,
      longitude: clearing ? null : longitude,
      actor,
      source,
    }),
  };

  let { data, error } = await admin
    .from("customers")
    .update(auditUpdate)
    .eq("customer_code", code)
    .select(selectColumns)
    .maybeSingle();

  if (error && isMissingGpsAuditError(error)) {
    const fallback = await admin
      .from("customers")
      .update(baseUpdate)
      .eq("customer_code", code)
      .select(CUSTOMER_MASTER_GPS_SELECT_FALLBACK)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  if (!data) throw new Error("Customer not found.");

  await recordCustomerGpsHistory(admin, {
    customerCode: code,
    latitude: clearing ? null : latitude,
    longitude: clearing ? null : longitude,
    previousLatitude: previousLat,
    previousLongitude: previousLng,
    actor,
    source,
  });

  return data;
}
