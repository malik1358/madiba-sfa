import { hasGpsCoordinates } from "./geo.js";
import { formatIdleDuration, formatNarrativeTime } from "./collectionDaySummary.js";

const KIND_COLORS = {
  stop: "#2563eb",
  idle: "#f59e0b",
  unlogged: "#dc2626",
};

function entryTimestamp(entry) {
  const ts = Date.parse(String(entry?.savedAt || entry?.saved_at || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function entryType(entry) {
  return String(entry?.transactionType || entry?.transaction_type || "").trim().toUpperCase();
}

export function isLoggedWorkEntry(entry) {
  const type = entryType(entry);
  return Boolean(type) && type !== "GPS_PING";
}

export function isTimestampInIdleGaps(ts, idleGaps = []) {
  if (!ts) return false;
  return (idleGaps || []).some((gap) => {
    const start = Date.parse(gap.fromAt);
    const end = Date.parse(gap.toAt);
    return Number.isFinite(start) && Number.isFinite(end) && ts >= start && ts <= end;
  });
}

export function buildDayRoutePoints(entries = [], idleGaps = []) {
  return (entries || [])
    .filter((entry) => hasGpsCoordinates({
      latitude: entry.entryLatitude ?? entry.latitude,
      longitude: entry.entryLongitude ?? entry.longitude,
    }))
    .map((entry, index) => {
      const latitude = Number(entry.entryLatitude ?? entry.latitude);
      const longitude = Number(entry.entryLongitude ?? entry.longitude);
      const ts = entryTimestamp(entry);
      const type = entryType(entry);
      const inUnlogged = isTimestampInIdleGaps(ts, idleGaps);
      let kind = "stop";
      if (type === "GPS_PING") {
        kind = inUnlogged ? "unlogged" : "idle";
      }

      return {
        index,
        latitude,
        longitude,
        ts,
        kind,
        type,
        label: entry.transactionLabel || type || "Stop",
        savedAt: entry.savedAt || entry.saved_at,
      };
    });
}

export function buildGoogleRouteUrl(points = []) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const capped = points.slice(0, 25);
  const origin = `${capped[0].latitude},${capped[0].longitude}`;
  const destination = `${capped[capped.length - 1].latitude},${capped[capped.length - 1].longitude}`;
  const waypoints = capped.slice(1, -1).map((point) => `${point.latitude},${point.longitude}`).join("|");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function projectPoints(points, width, height, padding = 24) {
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, 0.002);
  const lngSpan = Math.max(maxLng - minLng, 0.002);

  return points.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLng) / lngSpan) * (width - padding * 2),
    y: padding + ((maxLat - point.latitude) / latSpan) * (height - padding * 2),
  }));
}

export function buildDayRouteSvg(points = [], { width = 800, height = 360 } = {}) {
  if (!points.length) return "";
  const projected = projectPoints(points, width, height);

  const segments = [];
  for (let index = 1; index < projected.length; index += 1) {
    const from = projected[index - 1];
    const to = projected[index];
    const unlogged = from.kind === "unlogged" && to.kind === "unlogged";
    segments.push({
      d: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
      color: unlogged ? KIND_COLORS.unlogged : "#64748b",
      width: unlogged ? 4 : 2.5,
    });
  }

  const pathMarkup = segments.map((segment) => (
    `<path d="${segment.d}" fill="none" stroke="${segment.color}" stroke-width="${segment.width}" stroke-linecap="round" />`
  )).join("");

  const markerMarkup = projected.map((point) => (
    `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.kind === "unlogged" ? 6 : 4.5}" fill="${KIND_COLORS[point.kind]}" stroke="#ffffff" stroke-width="1.5" />`
  )).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="width:100%;max-width:${width}px;height:auto;background:#f8fafc;border:1px solid #d5e1e4;border-radius:8px;" role="img" aria-label="Day route map">
    <rect width="${width}" height="${height}" fill="#f8fafc" />
    ${pathMarkup}
    ${markerMarkup}
  </svg>`;
}

export function formatIdleGapLabel(gap) {
  return `Unlogged idle ${formatNarrativeTime(gap?.fromAt)} – ${formatNarrativeTime(gap?.toAt)} (${formatIdleDuration(gap?.minutes)})`;
}
