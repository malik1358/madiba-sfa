import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichVisitsWithDistances,
  haversineDistanceKm,
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
