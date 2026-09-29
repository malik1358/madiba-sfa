import { parseGpsFromActivityNote } from "./geo.js";

export const HOME_LOCATION_BLOCK_RADIUS_METERS = 500;
export const HOME_LOCATION_CANDIDATE_MIN_DAYS = 6;

export function haversineDistanceMeters(left, right) {
  const leftLatitude = Number(left?.latitude);
  const leftLongitude = Number(left?.longitude);
  const rightLatitude = Number(right?.latitude);
  const rightLongitude = Number(right?.longitude);
  if (![leftLatitude, leftLongitude, rightLatitude, rightLongitude].every(Number.isFinite)) return null;

  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(leftLatitude))
      * Math.cos(radians(rightLatitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

export function isAtHomeLocation(location, homeLocation, radiusMeters = HOME_LOCATION_BLOCK_RADIUS_METERS) {
  const distance = haversineDistanceMeters(location, homeLocation);
  return distance !== null && distance <= Number(radiusMeters);
}

function ksaDateFrom(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function attendanceCoordinates(row) {
  const type = String(row?.entry_type || "").trim().toUpperCase();
  if (type !== "MORNING_ATTENDANCE" && type !== "END_OF_DAY") return null;
  const gps = parseGpsFromActivityNote(row?.note);
  if (!gps) return null;
  const date = ksaDateFrom(gps.capturedAt || row?.created_at);
  if (!date) return null;
  return {
    userId: String(row?.user_id || "").trim(),
    entryType: type,
    date,
    latitude: Number(gps.latitude),
    longitude: Number(gps.longitude),
  };
}

export function findRepeatedAttendanceLocations(rows = [], minimumDays = HOME_LOCATION_CANDIDATE_MIN_DAYS) {
  const byUser = new Map();

  (rows || []).forEach((row) => {
    const point = attendanceCoordinates(row);
    if (!point?.userId || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
    const clusters = byUser.get(point.userId) || [];
    let cluster = clusters.find((candidate) => (
      isAtHomeLocation(point, candidate, HOME_LOCATION_BLOCK_RADIUS_METERS)
    ));

    if (!cluster) {
      cluster = {
        latitude: point.latitude,
        longitude: point.longitude,
        pointCount: 0,
        dates: new Set(),
        loginCount: 0,
        logoutCount: 0,
        firstDate: point.date,
        lastDate: point.date,
      };
      clusters.push(cluster);
      byUser.set(point.userId, clusters);
    }

    cluster.pointCount += 1;
    cluster.latitude += (point.latitude - cluster.latitude) / cluster.pointCount;
    cluster.longitude += (point.longitude - cluster.longitude) / cluster.pointCount;
    cluster.dates.add(point.date);
    cluster.loginCount += point.entryType === "MORNING_ATTENDANCE" ? 1 : 0;
    cluster.logoutCount += point.entryType === "END_OF_DAY" ? 1 : 0;
    cluster.firstDate = point.date < cluster.firstDate ? point.date : cluster.firstDate;
    cluster.lastDate = point.date > cluster.lastDate ? point.date : cluster.lastDate;
  });

  return [...byUser.entries()].flatMap(([userId, clusters]) => clusters
    .filter((cluster) => cluster.dates.size >= Number(minimumDays))
    .map((cluster) => ({
      userId,
      latitude: Number(cluster.latitude.toFixed(6)),
      longitude: Number(cluster.longitude.toFixed(6)),
      distinctDays: cluster.dates.size,
      loginCount: cluster.loginCount,
      logoutCount: cluster.logoutCount,
      firstDate: cluster.firstDate,
      lastDate: cluster.lastDate,
    })))
    .sort((left, right) => right.distinctDays - left.distinctDays || left.userId.localeCompare(right.userId));
}