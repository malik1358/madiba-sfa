import test from "node:test";
import assert from "node:assert/strict";

import {
  applyReverseGeocoding,
  computeSpeedKmh,
  computeWaitingMinutes,
  computeEstimatedTransitHours,
  DEFAULT_TRANSIT_SPEED_KMH,
  formatDurationMinutes,
  resolveWaitingMinutesFromPrevious,
  sumWaitingMinutesFromTimeline,
  TRANSIT_SPEED_OPTIONS_KMH,
  coordinateCacheKey,
  enrichVisitsWithDistances,
  extractAreaFromActivityNote,
  extractStreetFromActivityNote,
  formatCollectorDisplayName,
  formatCollectionUserDisplayName,
  formatCollectionUserRoleLabel,
  formatGpsCapturePlatformLabel,
  inferGpsCapturePlatformFromNote,
  isCollectionReportCollector,
  isCollectionReportSalesman,
  GPS_REQUIRED_ERROR,
  haversineDistanceKm,
  nearestActivityGps,
  parseGpsFromActivityNote,
  parseReverseGeocodeAddress,
  normalizeGpsCapturePlatform,
  summarizeRouteDistanceKm,
} from "../app/lib/geo.js";

test("haversineDistanceKm returns zero for identical coordinates", () => {
  assert.equal(haversineDistanceKm(24.7136, 46.6753, 24.7136, 46.6753), 0);
});

test("enrichVisitsWithDistances computes distance between consecutive GPS visits", () => {
  const visits = enrichVisitsWithDistances([
    {
      id: 1,
      customer_code: "C1",
      saved_at: "2026-08-17T08:00:00.000Z",
      latitude: 24.7136,
      longitude: 46.6753,
    },
    {
      id: 2,
      customer_code: "C2",
      saved_at: "2026-08-17T09:00:00.000Z",
      latitude: 24.7236,
      longitude: 46.6853,
    },
  ]);

  assert.equal(visits[0].visitSequence, 1);
  assert.equal(visits[0].distanceFromPreviousKm, null);
  assert.ok(visits[1].distanceFromPreviousKm > 0);
  assert.equal(summarizeRouteDistanceKm(visits), visits[1].distanceFromPreviousKm);
});

test("enrichVisitsWithDistances skips distance when GPS is missing", () => {
  const visits = enrichVisitsWithDistances([
    {
      id: 1,
      customer_code: "C1",
      saved_at: "2026-08-17T08:00:00.000Z",
      latitude: null,
      longitude: null,
    },
    {
      id: 2,
      customer_code: "C2",
      saved_at: "2026-08-17T09:00:00.000Z",
      latitude: 24.7236,
      longitude: 46.6853,
    },
  ]);

  assert.equal(visits[1].distanceFromPreviousKm, null);
  assert.equal(visits[1].hasGps, true);
});

test("parseGpsFromActivityNote reads nested location payload", () => {
  const gps = parseGpsFromActivityNote(JSON.stringify({
    location: { latitude: 24.7136, longitude: 46.6753, accuracy: 12 },
    captured_at: "2026-08-17T08:05:00.000Z",
  }));

  assert.equal(gps.latitude, 24.7136);
  assert.equal(gps.longitude, 46.6753);
  assert.equal(gps.accuracy, 12);
  assert.equal(gps.platform, "web");
});

test("normalizeGpsCapturePlatform infers android from native source", () => {
  assert.equal(normalizeGpsCapturePlatform("", "native_foreground_service"), "android");
  assert.equal(normalizeGpsCapturePlatform("android"), "android");
  assert.equal(formatGpsCapturePlatformLabel("android"), "Android App");
});

test("inferGpsCapturePlatformFromNote reads stored platform", () => {
  const platform = inferGpsCapturePlatformFromNote(JSON.stringify({
    platform: "android",
    source: "native_idle",
    location: { latitude: 1, longitude: 2 },
  }));

  assert.equal(platform, "android");
});

test("nearestActivityGps picks the closest point within the window", () => {
  const savedAt = "2026-08-17T08:10:00.000Z";
  const points = [
    { latitude: 1, longitude: 1, capturedTs: new Date("2026-08-17T08:00:00.000Z").getTime() },
    { latitude: 2, longitude: 2, capturedTs: new Date("2026-08-17T08:09:30.000Z").getTime() },
    { latitude: 3, longitude: 3, capturedTs: new Date("2026-08-17T09:30:00.000Z").getTime() },
  ];

  const nearest = nearestActivityGps(points, savedAt);
  assert.equal(nearest.latitude, 2);
});

test("formatCollectorDisplayName prefers email over generic role name", () => {
  assert.equal(
    formatCollectorDisplayName({ email: "collector@example.com", salesman_name: "collector", role: "collector" }),
    "collector@example.com",
  );
});

test("formatCollectionUserDisplayName can include role label", () => {
  assert.equal(
    formatCollectionUserDisplayName({ salesman_name: "PARVEZ", salesman_code: "SM001", role: "salesman" }, { includeRole: true }),
    "PARVEZ (SM001) · Salesman",
  );
});

test("collection report role helpers distinguish salesmen and collectors", () => {
  assert.equal(isCollectionReportSalesman({ role: "salesman" }), true);
  assert.equal(isCollectionReportCollector({ role: "collector" }), true);
  assert.equal(isCollectionReportCollector({ role: "salesman", salesman_code: "CL001" }), true);
  assert.equal(formatCollectionUserRoleLabel("salesman"), "Salesman");
});

test("captureGpsLocation exposes a consistent required GPS error", async () => {
  assert.match(GPS_REQUIRED_ERROR, /GPS is required/i);
});

test("extractStreetFromActivityNote reads nested address fields", () => {
  const street = extractStreetFromActivityNote(JSON.stringify({
    location: {
      address: { road: "King Fahd Road" },
    },
  }));

  assert.equal(street, "King Fahd Road");
});

test("extractAreaFromActivityNote reads suburb and area fields", () => {
  const area = extractAreaFromActivityNote(JSON.stringify({
    location: {
      address: { suburb: "Al Olaya" },
    },
  }));

  assert.equal(area, "Al Olaya");
});

test("computeSpeedKmh converts distance and elapsed time", () => {
  const speed = computeSpeedKmh(
    10,
    "2026-08-17T08:00:00.000Z",
    "2026-08-17T09:00:00.000Z",
  );

  assert.equal(speed, 10);
});

test("computeWaitingMinutes subtracts estimated transit time at 40 km/h", () => {
  const waiting = computeWaitingMinutes(
    35.82,
    "2026-08-17T10:12:00.000Z",
    "2026-08-17T12:43:00.000Z",
    DEFAULT_TRANSIT_SPEED_KMH,
  );

  assert.equal(waiting, 97);
});

test("formatDurationMinutes renders hours and minutes", () => {
  assert.equal(formatDurationMinutes(97), "1h 37m");
  assert.equal(formatDurationMinutes(45), "45 min");
  assert.equal(formatDurationMinutes(0), "0 min");
});

test("sumWaitingMinutesFromTimeline totals waiting across consecutive visits", () => {
  const rows = [
    {
      savedAt: "2026-08-17T10:12:00.000Z",
      distanceFromPreviousKm: null,
    },
    {
      savedAt: "2026-08-17T12:43:00.000Z",
      distanceFromPreviousKm: 35.82,
    },
  ];

  assert.equal(sumWaitingMinutesFromTimeline(rows, DEFAULT_TRANSIT_SPEED_KMH), 97);
  assert.equal(sumWaitingMinutesFromTimeline(rows, 30), 79);
});

test("parseReverseGeocodeAddress maps OpenStreetMap fields", () => {
  const parsed = parseReverseGeocodeAddress({
    address: {
      road: "King Fahd Road",
      suburb: "Al Olaya",
    },
  });

  assert.equal(parsed.street, "King Fahd Road");
  assert.equal(parsed.area, "Al Olaya");
});

test("applyReverseGeocoding fills missing area and street from cache", () => {
  const cache = new Map([
    ["24.71360,46.67530", { area: "Al Olaya", street: "King Fahd Road" }],
  ]);

  const enriched = applyReverseGeocoding({
    hasEntryGps: true,
    entryLatitude: 24.7136,
    entryLongitude: 46.6753,
    area: "",
    street: "",
  }, cache);

  assert.equal(enriched.area, "Al Olaya");
  assert.equal(enriched.street, "King Fahd Road");
});

test("coordinateCacheKey rounds coordinates for lookup dedupe", () => {
  assert.equal(coordinateCacheKey(24.713551, 46.675301), "24.71355,46.67530");
});
