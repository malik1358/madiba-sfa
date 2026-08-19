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

export function hasGpsCoordinates(record) {
  const latitudeRaw = record?.latitude;
  const longitudeRaw = record?.longitude;
  if (latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === "") return false;
  if (longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === "") return false;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

export const GPS_REQUIRED_ERROR = "GPS is required. Allow location access in the browser and try again.";

export function captureGpsLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("Geolocation is not supported on this device."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracy: Number(position.coords.accuracy.toFixed(1)),
        });
      },
      () => reject(new Error(GPS_REQUIRED_ERROR)),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export function requireGpsLocation() {
  return captureGpsLocation();
}

export function buildGpsActivityNote(action, location, extra = {}) {
  return JSON.stringify({
    action,
    captured_at: new Date().toISOString(),
    location,
    ...extra,
  });
}

export async function insertGpsActivityLog(supabase, userId, entryType, location, extra = {}) {
  const { error } = await supabase.from("daily_activity_logs").insert({
    user_id: userId,
    entry_type: entryType,
    note: buildGpsActivityNote(entryType, location, extra),
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
