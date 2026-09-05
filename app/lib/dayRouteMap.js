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
        customerName: String(entry.customerName || "").trim(),
        customerCode: String(entry.customerCode || entry.customer_code || "").trim(),
        area: String(entry.area || "").trim(),
        street: String(entry.street || "").trim(),
      };
    });
}

function customerDisplayName(point) {
  const name = String(point?.customerName || "").trim();
  const code = String(point?.customerCode || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code;
}

function placeHint(point) {
  return [point?.street, point?.area].filter(Boolean).join(", ");
}

export function routePointLabel(point) {
  const customer = customerDisplayName(point);
  const place = placeHint(point);
  const time = formatNarrativeTime(point?.savedAt || point?.ts);
  const parts = [time, point?.label || "Stop"];
  if (customer) parts.push(customer);
  else if (place) parts.push(place);
  return parts.filter(Boolean).join(" · ");
}

export function buildGooglePlaceUrl(point = {}) {
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const coords = `${latitude},${longitude}`;
  const label = String(point.mapLabel || routePointLabel(point) || "").trim();
  if (label) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${coords} (${label})`)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`;
}

function pointInsideGap(point, gap) {
  const ts = Number(point?.ts || 0);
  const start = Date.parse(gap?.fromAt);
  const end = Date.parse(gap?.toAt);
  return ts && Number.isFinite(start) && Number.isFinite(end) && ts >= start && ts <= end;
}

function pinForIdleGap(points = [], gap) {
  const inside = (points || []).filter((point) => pointInsideGap(point, gap));
  const gps = [...inside].reverse().find((point) => point.kind === "unlogged" || point.kind === "idle");
  if (gps) return gps;
  if (inside.length) return inside[inside.length - 1];
  const gapStart = Date.parse(gap?.fromAt);
  const before = [...(points || [])].reverse().find((point) => point.ts && point.ts <= gapStart);
  const after = (points || []).find((point) => point.ts && point.ts >= Date.parse(gap?.toAt));
  return gps || before || after || null;
}

export function idlePlaceForGap(points = [], gap) {
  const pin = pinForIdleGap(points, gap);
  const nextStop = (points || []).find((point) => (
    point.kind === "stop" && point.customerName && point.ts >= Date.parse(gap?.toAt)
  ));
  const previousStop = [...(points || [])].reverse().find((point) => (
    point.kind === "stop" && point.customerName && point.ts <= Date.parse(gap?.fromAt)
  ));
  const nearCustomer = customerDisplayName(nextStop) || customerDisplayName(previousStop);
  const place = placeHint(pin) || placeHint(nextStop) || placeHint(previousStop);
  const labelParts = [
    formatIdleGapLabel(gap),
    place,
    nearCustomer ? `near ${nearCustomer}` : "",
  ].filter(Boolean);
  const mapLabel = labelParts.join(" · ");
  return {
    kind: "idle",
    ts: Date.parse(gap?.fromAt) || pin?.ts || 0,
    minutes: Number(gap?.minutes || 0),
    fromAt: gap?.fromAt,
    toAt: gap?.toAt,
    latitude: pin?.latitude,
    longitude: pin?.longitude,
    area: pin?.area || nextStop?.area || previousStop?.area || "",
    customerName: nextStop?.customerName || previousStop?.customerName || "",
    customerCode: nextStop?.customerCode || previousStop?.customerCode || "",
    label: mapLabel,
    mapLabel,
    mapsUrl: pin ? buildGooglePlaceUrl({ ...pin, mapLabel }) : "",
  };
}

export function longestIdlePlace(points = [], idleGaps = []) {
  const ranked = [...(idleGaps || [])].sort((left, right) => Number(right.minutes || 0) - Number(left.minutes || 0));
  if (!ranked.length) return null;
  return idlePlaceForGap(points, ranked[0]);
}

export function buildNamedRouteStops(points = [], idleGaps = []) {
  const stops = [];
  let lastCustomer = "";
  (points || []).forEach((point) => {
    if (point.kind !== "stop") return;
    const customerKey = String(point.customerCode || "").trim().toUpperCase();
    if (customerKey && customerKey === lastCustomer) return;
    lastCustomer = customerKey;
    const mapLabel = routePointLabel(point);
    stops.push({
      kind: "stop",
      ts: point.ts,
      label: mapLabel,
      mapsUrl: buildGooglePlaceUrl({ ...point, mapLabel }),
    });
  });
  (idleGaps || []).forEach((gap) => {
    stops.push(idlePlaceForGap(points, gap));
  });
  return stops.sort((left, right) => left.ts - right.ts);
}

export function idleBubbleRadius(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const t = Math.min(1, value / 240);
  return Math.round(16 + 34 * Math.sqrt(t));
}

export function buildIdleBubbles(points = [], idleGaps = []) {
  return (idleGaps || [])
    .map((gap) => idlePlaceForGap(points, gap))
    .filter((place) => (
      Number(place.minutes) > 0
      && Number.isFinite(Number(place.latitude))
      && Number.isFinite(Number(place.longitude))
    ))
    .sort((left, right) => Number(right.minutes) - Number(left.minutes));
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

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mapBounds(points) {
  const lats = points.map((point) => Number(point.latitude));
  const lngs = points.map((point) => Number(point.longitude));
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    latSpan: Math.max(maxLat - minLat, 0.002),
    lngSpan: Math.max(maxLng - minLng, 0.002),
  };
}

function projectWithBounds(points, bounds, width, height, padding) {
  return points.map((point) => ({
    ...point,
    x: padding + ((Number(point.longitude) - bounds.minLng) / bounds.lngSpan) * (width - padding * 2),
    y: padding + ((bounds.maxLat - Number(point.latitude)) / bounds.latSpan) * (height - padding * 2),
  }));
}

function spreadOverlapping(points) {
  const seen = new Map();
  return points.map((point) => {
    const key = `${Math.round(point.x / 8)}:${Math.round(point.y / 8)}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (!count) return point;
    return {
      ...point,
      x: point.x + count * 14,
      y: point.y - count * 10,
    };
  });
}

export function buildDayRouteSvg(points = [], { width = 800, height = 360, idleGaps = [] } = {}) {
  if (!points.length) return "";
  const padding = idleGaps.length ? 48 : 24;
  const bounds = mapBounds(points);
  const projected = projectWithBounds(points, bounds, width, height, padding);
  const bubbles = spreadOverlapping(
    projectWithBounds(buildIdleBubbles(points, idleGaps), bounds, width, height, padding),
  );

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

  const bubbleMarkup = bubbles.map((bubble) => {
    const radius = idleBubbleRadius(bubble.minutes);
    const label = formatIdleDuration(bubble.minutes);
    const title = escapeXml(bubble.label);
    return `<g>
      <title>${title}</title>
      <circle cx="${bubble.x.toFixed(1)}" cy="${bubble.y.toFixed(1)}" r="${radius}" fill="rgba(220,38,38,0.18)" stroke="#dc2626" stroke-width="2" />
      <text x="${bubble.x.toFixed(1)}" y="${bubble.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#7f1d1d" font-size="11" font-weight="700">${escapeXml(label)}</text>
    </g>`;
  }).join("");

  const markerMarkup = projected.map((point) => (
    `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.kind === "unlogged" ? 6 : 4.5}" fill="${KIND_COLORS[point.kind]}" stroke="#ffffff" stroke-width="1.5" />`
  )).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="width:100%;max-width:${width}px;height:auto;background:#f8fafc;border:1px solid #d5e1e4;border-radius:8px;" role="img" aria-label="Day route map">
    <rect width="${width}" height="${height}" fill="#f8fafc" />
    ${pathMarkup}
    ${bubbleMarkup}
    ${markerMarkup}
  </svg>`;
}

export function formatIdleGapLabel(gap) {
  return `Unlogged idle ${formatNarrativeTime(gap?.fromAt)} – ${formatNarrativeTime(gap?.toAt)} (${formatIdleDuration(gap?.minutes)})`;
}
