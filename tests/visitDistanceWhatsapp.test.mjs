import test from "node:test";
import assert from "node:assert/strict";

import {
  findPreviousVisitDistanceAnchors,
  formatVisitDistanceWhatsappLines,
  resolveVisitDistanceMetrics,
  timelineRowFromActivityLog,
} from "../app/lib/visitDistanceWhatsapp.js";

test("formatVisitDistanceWhatsappLines always includes GPS and the three distance fields", () => {
  const lines = formatVisitDistanceWhatsappLines({});
  assert.deepEqual(lines, [
    "",
    "GPS: -",
    "Distance from customer: -",
    "Distance from previous: -",
    "Est. waiting: -",
  ]);
});

test("resolveVisitDistanceMetrics uses customer GPS, previous GPS, and waiting time", () => {
  const metrics = resolveVisitDistanceMetrics({
    location: { latitude: 24.72, longitude: 46.72 },
    customer: { latitude: 24.721, longitude: 46.721 },
    previousGpsRow: {
      latitude: 24.70,
      longitude: 46.70,
      savedAt: "2026-09-10T07:00:00.000Z",
    },
    previousVisitRow: {
      latitude: 24.70,
      longitude: 46.70,
      savedAt: "2026-09-10T07:00:00.000Z",
      transactionType: "VISIT_REPORT",
    },
    savedAt: "2026-09-10T08:00:00.000Z",
  });

  assert.equal(metrics.latitude, 24.72);
  assert.equal(metrics.longitude, 46.72);
  assert.ok(metrics.distanceFromCustomerKm > 0);
  assert.ok(metrics.distanceFromPreviousKm > 2);
  assert.ok(metrics.waitingMinutes > 0);

  const lines = formatVisitDistanceWhatsappLines(metrics);
  assert.equal(lines[0], "");
  assert.match(lines[1], /GPS: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=24\.72%2C46\.72/);
  assert.match(lines[2], /Distance from customer: \d+\.\d{2} km/);
  assert.match(lines[3], /Distance from previous: \d+\.\d{2} km/);
  assert.match(lines[4], /Est. waiting:/);
  assert.doesNotMatch(lines.join("\n"), /Est. waiting: -$/);
});

test("findPreviousVisitDistanceAnchors skips later rows and idle pings for waiting", () => {
  const rows = [
    timelineRowFromActivityLog({
      entry_type: "MORNING_ATTENDANCE",
      created_at: "2026-09-10T06:00:00.000Z",
      note: JSON.stringify({
        captured_at: "2026-09-10T06:00:00.000Z",
        location: { latitude: 24.70, longitude: 46.70 },
      }),
    }),
    {
      savedAt: "2026-09-10T07:00:00.000Z",
      transactionType: "VISIT_REPORT",
      latitude: 24.71,
      longitude: 46.71,
    },
    {
      savedAt: "2026-09-10T07:30:00.000Z",
      transactionType: "GPS_PING",
      latitude: 24.715,
      longitude: 46.715,
    },
    {
      savedAt: "2026-09-10T09:00:00.000Z",
      transactionType: "COLLECTION_VISIT",
      latitude: 24.80,
      longitude: 46.80,
    },
  ];

  const anchors = findPreviousVisitDistanceAnchors(rows, "2026-09-10T08:00:00.000Z");
  assert.equal(anchors.previousGpsRow.transactionType, "GPS_PING");
  assert.equal(anchors.previousVisitRow.transactionType, "VISIT_REPORT");
});
