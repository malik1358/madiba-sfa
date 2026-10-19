function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

export function haversineDistanceKm(fromLat, fromLng, toLat, toLng) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function formatDistanceKm(distanceKm) {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return "-";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function findNearestCustomers(customers, latitude, longitude, limit = 3) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const ranked = (customers || [])
    .map((customer) => {
      const customerLat = customer.latitude ?? customer.customer_latitude;
      const customerLng = customer.longitude ?? customer.customer_longitude;
      if (!hasGpsCoordinates({ latitude: customerLat, longitude: customerLng })) return null;

      return {
        ...customer,
        distanceKm: haversineDistanceKm(lat, lng, Number(customerLat), Number(customerLng)),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceKm - right.distanceKm);

  const seen = new Set();
  const nearest = [];

  for (const customer of ranked) {
    const code = String(customer.customer_code || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    nearest.push(customer);
    if (nearest.length >= limit) break;
  }

  return nearest;
}

export function hasGpsCoordinates(record) {
  const latitudeRaw = record?.latitude;
  const longitudeRaw = record?.longitude;
  if (latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === "") return false;
  if (longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === "") return false;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

import { shouldRequireTransactionGps } from "./moduleAccess.js";

export const GPS_REQUIRED_ERROR = "GPS is required. Allow location access in the browser and try again.";
export const GPS_UNSUPPORTED_ERROR = "UNSUPPORTED";
export const GPS_PERMISSION_DENIED_ERROR = "PERMISSION_DENIED";
export const GPS_POSITION_UNAVAILABLE_ERROR = "POSITION_UNAVAILABLE";
export const GPS_LOCATION_FAILED_ERROR = "LOCATION_FAILED";
export const GPS_PROBE_DEFAULT_ATTEMPTS = 3;
export const GPS_PROBE_RETRY_DELAY_MS = 1500;

function delayMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function probeGpsLocation(options = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error(GPS_UNSUPPORTED_ERROR));
  }

  const timeoutMs = Number(options.timeoutMs || 10000);
  const maximumAge = Number.isFinite(Number(options.maximumAge)) ? Number(options.maximumAge) : 0;

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracy: Number(position.coords.accuracy.toFixed(1)),
        });
      },
      (error) => {
        if (error?.code === 1) {
          reject(new Error(GPS_PERMISSION_DENIED_ERROR));
          return;
        }
        if (error?.code === 2) {
          reject(new Error(GPS_POSITION_UNAVAILABLE_ERROR));
          return;
        }
        reject(new Error(GPS_LOCATION_FAILED_ERROR));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge },
    );
  });
}

export async function probeGpsLocationWithRetries(options = {}) {
  const attempts = Math.max(1, Number(options.attempts || GPS_PROBE_DEFAULT_ATTEMPTS));
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs))
    ? Number(options.retryDelayMs)
    : GPS_PROBE_RETRY_DELAY_MS;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await probeGpsLocation(options);
    } catch (error) {
      lastError = error;
      if (error?.message === GPS_UNSUPPORTED_ERROR || attempt >= attempts) {
        throw error;
      }
      if (retryDelayMs > 0) {
        await delayMs(retryDelayMs);
      }
    }
  }

  throw lastError || new Error(GPS_LOCATION_FAILED_ERROR);
}

export function captureGpsLocation() {
  return probeGpsLocationWithRetries().catch((error) => {
    if (error?.message === GPS_PERMISSION_DENIED_ERROR
      || error?.message === GPS_POSITION_UNAVAILABLE_ERROR
      || error?.message === GPS_LOCATION_FAILED_ERROR
      || error?.message === GPS_UNSUPPORTED_ERROR) {
      throw new Error(GPS_REQUIRED_ERROR);
    }
    throw error;
  });
}

export function requireGpsLocation(options = {}) {
  if (!shouldRequireTransactionGps(options.role)) {
    return Promise.resolve(null);
  }
  return captureGpsLocation();
}

export function normalizeGpsCapturePlatform(value, source = "") {
  const text = String(value || "").trim().toLowerCase();
  if (text === "android" || text === "ios" || text === "web") return text;

  const sourceText = String(source || "").trim().toLowerCase();
  if (
    sourceText.includes("native")
    || sourceText.includes("foreground")
    || sourceText.includes("android")
  ) {
    return "android";
  }

  return "web";
}

export function inferGpsCapturePlatformFromNote(note) {
  const parsed = parseActivityNoteObject(note);
  if (!parsed) return null;
  return normalizeGpsCapturePlatform(parsed.platform, parsed.source);
}

export function formatGpsCapturePlatformLabel(platform) {
  const normalized = normalizeGpsCapturePlatform(platform);
  if (normalized === "android") return "Android App";
  if (normalized === "ios") return "iOS App";
  return "Web";
}

export async function resolveGpsCapturePlatform() {
  if (typeof window === "undefined") return "web";

  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform();
    if (platform === "android" || platform === "ios") return platform;
  } catch {
    // Capacitor is unavailable in plain browser builds.
  }

  return "web";
}

export function buildGpsActivityNote(action, location, extra = {}) {
  const platform = normalizeGpsCapturePlatform(extra.platform, extra.source);
  const { platform: _platform, ...rest } = extra;

  return JSON.stringify({
    action,
    captured_at: new Date().toISOString(),
    location,
    platform,
    ...rest,
  });
}

export async function insertGpsActivityLog(supabase, userId, entryType, location, extra = {}) {
  const platform = extra.platform || await resolveGpsCapturePlatform();
  const { error } = await supabase.from("daily_activity_logs").insert({
    user_id: userId,
    entry_type: entryType,
    note: buildGpsActivityNote(entryType, location, { ...extra, platform }),
  });
  if (error) throw error;
}

export function enrichVisitsWithDistances(visits) {
  const sorted = [...visits].sort(
    (left, right) => new Date(left.saved_at).getTime() - new Date(right.saved_at).getTime(),
  );

  let previousWithGps = null;

  return sorted.map((visit, index) => {
    let distanceFromPreviousKm = null;

    if (
      previousWithGps
      && hasGpsCoordinates(previousWithGps)
      && hasGpsCoordinates(visit)
    ) {
      distanceFromPreviousKm = haversineDistanceKm(
        Number(previousWithGps.latitude),
        Number(previousWithGps.longitude),
        Number(visit.latitude),
        Number(visit.longitude),
      );
    }

    if (hasGpsCoordinates(visit)) {
      previousWithGps = visit;
    }

    return {
      ...visit,
      visitSequence: index + 1,
      distanceFromPreviousKm,
      hasGps: hasGpsCoordinates(visit),
    };
  });
}

export function summarizeRouteDistanceKm(visits) {
  return enrichVisitsWithDistances(visits).reduce(
    (total, visit) => total + Number(visit.distanceFromPreviousKm || 0),
    0,
  );
}

export function buildGoogleMapsPointUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

export function parseGpsFromActivityNote(note) {
  if (!note) return null;

  let parsed = note;
  if (typeof note === "string") {
    try {
      parsed = JSON.parse(note);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const location = parsed.location || parsed;
  const latitudeRaw = location.latitude ?? location.lat ?? parsed.latitude ?? parsed.lat;
  const longitudeRaw = location.longitude ?? location.lng ?? parsed.longitude ?? parsed.lng;
  if (latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === "") return null;
  if (longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === "") return null;

  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const capturedAt = parsed.captured_at || parsed.capturedAt || null;
  const capturedTs = capturedAt ? new Date(capturedAt).getTime() : NaN;

  return {
    latitude,
    longitude,
    accuracy: Number(location.accuracy ?? parsed.accuracy) || null,
    capturedAt: Number.isFinite(capturedTs) ? capturedAt : null,
    capturedTs: Number.isFinite(capturedTs) ? capturedTs : 0,
    platform: normalizeGpsCapturePlatform(parsed.platform, parsed.source),
  };
}

function parseActivityNoteObject(note) {
  if (!note) return null;
  if (typeof note === "object") return note;
  try {
    return JSON.parse(note);
  } catch {
    return null;
  }
}

export function extractStreetFromActivityNote(note) {
  const parsed = parseActivityNoteObject(note);
  if (!parsed) return "";

  const location = parsed?.location || {};
  const locationAddress = location?.address;
  const payloadAddress = parsed?.address;

  const candidates = [
    location?.street_name,
    parsed?.street_name,
    location?.street,
    parsed?.street,
    typeof locationAddress === "object" ? locationAddress?.road : "",
    typeof locationAddress === "object" ? locationAddress?.pedestrian : "",
    typeof locationAddress === "object" ? locationAddress?.residential : "",
    typeof payloadAddress === "object" ? payloadAddress?.road : "",
    typeof payloadAddress === "object" ? payloadAddress?.pedestrian : "",
    typeof payloadAddress === "object" ? payloadAddress?.residential : "",
    typeof locationAddress === "string" ? locationAddress : "",
    typeof payloadAddress === "string" ? payloadAddress : "",
  ];

  return String(candidates.find((value) => String(value || "").trim()) || "").trim();
}

export function extractAreaFromActivityNote(note) {
  const parsed = parseActivityNoteObject(note);
  if (!parsed) return "";

  const location = parsed?.location || {};
  const locationAddress = location?.address;
  const payloadAddress = parsed?.address;

  const candidates = [
    location?.area,
    parsed?.area,
    typeof locationAddress === "object" ? locationAddress?.suburb : "",
    typeof locationAddress === "object" ? locationAddress?.neighbourhood : "",
    typeof locationAddress === "object" ? locationAddress?.city_district : "",
    typeof locationAddress === "object" ? locationAddress?.county : "",
    typeof locationAddress === "object" ? locationAddress?.quarter : "",
    typeof payloadAddress === "object" ? payloadAddress?.suburb : "",
    typeof payloadAddress === "object" ? payloadAddress?.neighbourhood : "",
    typeof payloadAddress === "object" ? payloadAddress?.city_district : "",
    typeof payloadAddress === "object" ? payloadAddress?.county : "",
    typeof payloadAddress === "object" ? payloadAddress?.quarter : "",
  ];

  return String(candidates.find((value) => String(value || "").trim()) || "").trim();
}

export function computeSpeedKmh(distanceKm, fromSavedAt, toSavedAt) {
  const fromTs = new Date(fromSavedAt).getTime();
  const toTs = new Date(toSavedAt).getTime();
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) return null;
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) return null;

  const hours = (toTs - fromTs) / (3600 * 1000);
  if (hours <= 0) return null;
  return distanceKm / hours;
}

export const DEFAULT_TRANSIT_SPEED_KMH = 50;

export function computeElapsedHours(fromSavedAt, toSavedAt) {
  const fromTs = new Date(fromSavedAt).getTime();
  const toTs = new Date(toSavedAt).getTime();
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) return null;
  return (toTs - fromTs) / (3600 * 1000);
}

export function computeEstimatedTransitHours(
  distanceKm,
  assumedSpeedKmh = DEFAULT_TRANSIT_SPEED_KMH,
) {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }

  const speed = Number(assumedSpeedKmh);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return distanceKm / speed;
}

export function computeWaitingMinutes(
  distanceKm,
  fromSavedAt,
  toSavedAt,
  assumedSpeedKmh = DEFAULT_TRANSIT_SPEED_KMH,
) {
  const elapsedHours = computeElapsedHours(fromSavedAt, toSavedAt);
  const transitHours = computeEstimatedTransitHours(distanceKm, assumedSpeedKmh);
  if (elapsedHours === null || transitHours === null) return null;

  return Math.max(0, Math.round((elapsedHours - transitHours) * 60));
}

export function resolveWaitingMinutesFromPrevious(
  row,
  previousRow,
  assumedSpeedKmh = DEFAULT_TRANSIT_SPEED_KMH,
) {
  if (!previousRow || row?.distanceFromPreviousKm === null || row?.distanceFromPreviousKm === undefined) {
    return null;
  }

  const fromSavedAt = previousRow.savedAt ?? previousRow.saved_at;
  const toSavedAt = row.savedAt ?? row.saved_at;
  return computeWaitingMinutes(row.distanceFromPreviousKm, fromSavedAt, toSavedAt, assumedSpeedKmh);
}

export function isIdleGpsPingTimelineRow(row) {
  const transactionType = String(row?.transactionType || row?.transaction_type || "").trim().toUpperCase();
  if (transactionType === "GPS_PING") return true;
  const rowType = String(row?.rowType || "").trim().toLowerCase();
  if (rowType === "lunch" || rowType === "attendance" || rowType === "idle") return true;
  const entryType = String(row?.entryType || row?.entry_type || "").trim().toUpperCase();
  if (
    entryType === "MORNING_ATTENDANCE"
    || entryType === "END_OF_DAY"
    || entryType === "LUNCH_BREAK_OUT"
    || entryType === "LUNCH_BREAK_IN"
    || entryType === "UNLOGGED_IDLE"
  ) {
    return true;
  }
  return false;
}

function resolveTimelineRowGps(row) {
  if (!row) return null;

  const latitude = row.entryLatitude ?? row.latitude;
  const longitude = row.entryLongitude ?? row.longitude;
  if (!hasGpsCoordinates({ latitude, longitude })) return null;

  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
}

export function findPreviousWaitingAnchorRow(rows, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (!isIdleGpsPingTimelineRow(candidate)) return candidate;
  }
  return null;
}

export function resolveWaitingMinutesFromPreviousVisit(
  rows,
  index,
  assumedSpeedKmh = DEFAULT_TRANSIT_SPEED_KMH,
) {
  const row = rows?.[index];
  if (!row || isIdleGpsPingTimelineRow(row)) return null;

  const previous = findPreviousWaitingAnchorRow(rows, index);
  if (!previous) return null;

  const fromSavedAt = previous.savedAt ?? previous.saved_at;
  const toSavedAt = row.savedAt ?? row.saved_at;
  const fromGps = resolveTimelineRowGps(previous);
  const toGps = resolveTimelineRowGps(row);
  if (!fromGps || !toGps) return null;

  const distanceKm = haversineDistanceKm(
    fromGps.latitude,
    fromGps.longitude,
    toGps.latitude,
    toGps.longitude,
  );

  return computeWaitingMinutes(distanceKm, fromSavedAt, toSavedAt, assumedSpeedKmh);
}

export function sumWaitingMinutesFromTimeline(
  rows,
  assumedSpeedKmh = DEFAULT_TRANSIT_SPEED_KMH,
) {
  let total = 0;

  for (let index = 0; index < (rows || []).length; index += 1) {
    const waiting = resolveWaitingMinutesFromPreviousVisit(rows, index, assumedSpeedKmh);
    if (waiting !== null) total += waiting;
  }

  return total;
}

export function formatDurationMinutes(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return "-";
  if (minutes === 0) return "0 min";

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours <= 0) return `${remainder} min`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function coordinateCacheKey(latitude, longitude, precision = 5) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

export function countUniqueGpsLocations(records, precision = 5) {
  const keys = new Set();
  (records || []).forEach((record) => {
    const latitude = record?.latitude ?? record?.entryLatitude;
    const longitude = record?.longitude ?? record?.entryLongitude;
    if (!hasGpsCoordinates({ latitude, longitude })) return;
    const key = coordinateCacheKey(latitude, longitude, precision);
    if (key) keys.add(key);
  });
  return keys.size;
}

export function parseReverseGeocodeAddress(payload) {
  const address = payload?.address || {};
  const street = String(
    address.road
    || address.pedestrian
    || address.residential
    || payload?.name
    || "",
  ).trim();
  const area = String(
    address.suburb
    || address.neighbourhood
    || address.city_district
    || address.county
    || address.quarter
    || "",
  ).trim();
  const city = String(
    address.city
    || address.town
    || address.village
    || address.state
    || "",
  ).trim();

  return { area, street, city };
}

export async function reverseGeocodeCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { area: "", street: "", city: "" };
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MadibaSFA/1.0 (daily-visit-report)",
      },
      signal: controller.signal,
    });
    if (!response.ok) return { area: "", street: "", city: "" };

    const payload = await response.json().catch(() => ({}));
    return parseReverseGeocodeAddress(payload);
  } catch {
    return { area: "", street: "", city: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildReverseGeocodeCache(coordinateKeys, options = {}) {
  const maxLookups = Number(options.maxLookups) > 0 ? Number(options.maxLookups) : 25;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 1100;
  const cache = new Map();
  const uniqueKeys = [...new Set((coordinateKeys || []).filter(Boolean))].slice(0, maxLookups);

  for (const key of uniqueKeys) {
    if (cache.has(key)) continue;
    const [lat, lng] = key.split(",").map(Number);
    cache.set(key, await reverseGeocodeCoordinates(lat, lng));
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return cache;
}

export function applyReverseGeocoding(entry, cache) {
  if (!entry?.hasEntryGps || !cache?.size) return entry;

  const key = coordinateCacheKey(entry.entryLatitude, entry.entryLongitude);
  const geocoded = cache.get(key);
  if (!geocoded) return entry;

  return {
    ...entry,
    area: entry.area || geocoded.area || "",
    street: entry.street || geocoded.street || "",
  };
}

export function nearestActivityGps(activityPoints, savedAt, windowMs = 10 * 60 * 1000) {
  const savedTs = new Date(savedAt).getTime();
  if (!Number.isFinite(savedTs) || !Array.isArray(activityPoints) || activityPoints.length === 0) {
    return null;
  }

  let best = null;
  let bestDelta = Infinity;

  activityPoints.forEach((point) => {
    if (!Number.isFinite(point.capturedTs)) return;
    const delta = Math.abs(point.capturedTs - savedTs);
    if (delta <= windowMs && delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  });

  return best;
}

export function formatCollectorDisplayName(profile) {
  const email = String(profile?.email || "").trim();
  const salesmanName = String(profile?.salesman_name || "").trim();
  const salesmanCode = String(profile?.salesman_code || "").trim();
  const role = String(profile?.role || "").trim();

  if (email) return email;
  if (salesmanName && salesmanCode) return `${salesmanName} (${salesmanCode})`;
  if (salesmanName && salesmanName.toLowerCase() !== role.toLowerCase()) return salesmanName;
  if (salesmanCode) return salesmanCode;
  return role || "Unknown user";
}

export function formatCollectionUserRoleLabel(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "salesman") return "Salesman";
  if (normalized === "collector") return "Collector";
  if (normalized === "manager") return "Manager";
  if (normalized === "admin") return "Admin";
  return normalized ? normalized.replace(/\b\w/g, (char) => char.toUpperCase()) : "User";
}

export function isCollectionReportSalesman(profile) {
  return String(profile?.role || "").trim().toLowerCase().replace(/_/g, "-") === "salesman";
}

export function isCollectionReportCollector(profile) {
  const role = String(profile?.role || "").trim().toLowerCase().replace(/_/g, "-");
  return role === "collector" || /^CL\d+$/i.test(String(profile?.salesman_code || "").trim());
}

export function formatCollectionUserDisplayName(profile, { includeRole = false } = {}) {
  const baseName = formatCollectorDisplayName(profile);
  if (!includeRole) return baseName;
  return `${baseName} · ${formatCollectionUserRoleLabel(profile?.role)}`;
}
