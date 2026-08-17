import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichVisitsWithDistances,
  formatCollectorDisplayName,
  GPS_REQUIRED_ERROR,
  haversineDistanceKm,
  nearestActivityGps,
  parseGpsFromActivityNote,
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

test("captureGpsLocation exposes a consistent required GPS error", async () => {
  assert.match(GPS_REQUIRED_ERROR, /GPS is required/i);
});
