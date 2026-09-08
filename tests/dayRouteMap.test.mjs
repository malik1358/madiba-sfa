import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDayRoutePoints,
  buildDayRouteSvg,
  buildGooglePlaceUrl,
  buildIdleBubbles,
  buildNamedRouteStops,
  buildWorkdayRouteStops,
  idleBubbleRadius,
  longestIdlePlace,
  resolveDayRouteWorkingHours,
} from "../app/lib/dayRouteMap.js";

test("day route map marks GPS pings inside idle gaps as unlogged", () => {
  const points = buildDayRoutePoints(
    [
      { savedAt: "2026-09-01T05:56:00.000Z", transactionType: "MORNING_ATTENDANCE", entryLatitude: 24.71, entryLongitude: 46.67 },
      { savedAt: "2026-09-01T07:00:00.000Z", transactionType: "GPS_PING", entryLatitude: 24.72, entryLongitude: 46.68 },
      { savedAt: "2026-09-01T09:43:00.000Z", transactionType: "COLLECTION_VISIT", entryLatitude: 24.73, entryLongitude: 46.69 },
    ],
    [{ fromAt: "2026-09-01T05:56:00.000Z", toAt: "2026-09-01T09:43:00.000Z", minutes: 227 }],
  );

  assert.equal(points[1].kind, "unlogged");
  assert.equal(points[2].kind, "stop");
  const svg = buildDayRouteSvg(points, {
    idleGaps: [{ fromAt: "2026-09-01T05:56:00.000Z", toAt: "2026-09-01T09:43:00.000Z", minutes: 227 }],
  });
  assert.match(svg, /#dc2626/);
  assert.match(svg, /<path /);
  assert.match(svg, /3h 47m/);
  assert.ok(idleBubbleRadius(200) > idleBubbleRadius(50));
  assert.equal(buildIdleBubbles(points, [{ fromAt: "2026-09-01T05:56:00.000Z", toAt: "2026-09-01T09:43:00.000Z", minutes: 227 }]).length, 1);
});

test("Google place URL includes a labeled pin query", () => {
  const url = buildGooglePlaceUrl({
    latitude: 24.72,
    longitude: 46.68,
    mapLabel: "Unlogged idle near Enjaz Gateway",
  });
  assert.match(url, /google\.com\/maps\?q=/);
  assert.match(url, /Enjaz/);
});

test("longest idle place uses GPS inside the gap and names the next customer", () => {
  const points = buildDayRoutePoints(
    [
      {
        savedAt: "2026-09-01T08:19:00.000Z",
        transactionType: "COLLECTION_VISIT",
        customerName: "Enjaz Gateway",
        customerCode: "1497",
        entryLatitude: 24.71,
        entryLongitude: 46.67,
        area: "Al Malaz District",
      },
      {
        savedAt: "2026-09-01T10:00:00.000Z",
        transactionType: "GPS_PING",
        entryLatitude: 24.62,
        entryLongitude: 46.78,
        area: "Al Mashael District",
      },
      {
        savedAt: "2026-09-01T12:39:00.000Z",
        transactionType: "ORDER_SUBMITTED",
        customerName: "Dawood Ahmed",
        customerCode: "1107C",
        entryLatitude: 24.62,
        entryLongitude: 46.78,
        area: "Al Mashael District",
      },
    ],
    [{ fromAt: "2026-09-01T08:19:00.000Z", toAt: "2026-09-01T12:39:00.000Z", minutes: 200 }],
  );

  const idle = longestIdlePlace(points, [
    { fromAt: "2026-09-01T08:19:00.000Z", toAt: "2026-09-01T12:39:00.000Z", minutes: 200 },
  ]);
  assert.equal(idle.minutes, 200);
  assert.match(idle.label, /Dawood Ahmed/);
  assert.match(idle.mapsUrl, /24\.62/);

  const stops = buildNamedRouteStops(points, [
    { fromAt: "2026-09-01T08:19:00.000Z", toAt: "2026-09-01T12:39:00.000Z", minutes: 200 },
  ]);
  assert.equal(stops.some((stop) => stop.label.includes("Enjaz Gateway")), true);
  assert.equal(stops.some((stop) => stop.kind === "idle"), true);

  const workdayStops = buildWorkdayRouteStops(points, [
    { fromAt: "2026-09-01T08:19:00.000Z", toAt: "2026-09-01T12:39:00.000Z", minutes: 200 },
  ]);
  assert.equal(workdayStops.some((stop) => stop.label.includes("Enjaz Gateway")), false);
  assert.equal(workdayStops.some((stop) => stop.kind === "idle"), true);
});

test("resolveDayRouteWorkingHours excludes lunch between login and logout", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "MORNING_ATTENDANCE" },
    { savedAt: "2026-09-07T10:47:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
    { savedAt: "2026-09-07T12:14:00.000Z", transactionType: "LUNCH_BREAK_IN" },
    { savedAt: "2026-09-07T16:10:00.000Z", transactionType: "END_OF_DAY" },
  ]);

  assert.equal(hours.minutes, 429);
  assert.equal(hours.value, "7h 9m");
});

test("resolveDayRouteWorkingHours uses login to logout when lunch is missing", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T07:34:00.000Z", type: "MORNING_ATTENDANCE" },
    { savedAt: "2026-09-07T16:10:00.000Z", type: "END_OF_DAY" },
  ]);

  assert.equal(hours.value, "8h 36m");
});
