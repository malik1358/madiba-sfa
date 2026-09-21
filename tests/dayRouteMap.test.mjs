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

test("resolveDayRouteWorkingHours uses first and last near customer transactions, not login or logout", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T06:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
    { savedAt: "2026-09-07T07:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: true },
    { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
    { savedAt: "2026-09-07T10:47:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
    { savedAt: "2026-09-07T12:14:00.000Z", transactionType: "LUNCH_BREAK_IN" },
    { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "COLLECTION_VISIT", isFarFromCustomer: false },
    { savedAt: "2026-09-07T15:40:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: true },
    { savedAt: "2026-09-07T16:10:00.000Z", transactionType: "END_OF_DAY" },
  ]);

  assert.equal(hours.minutes, 359);
  assert.equal(hours.value, "5h 59m");
});

test("resolveDayRouteWorkingHours ignores login and logout when lunch is missing", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T06:00:00.000Z", type: "MORNING_ATTENDANCE" },
    { savedAt: "2026-09-07T07:34:00.000Z", type: "ORDER_SUBMITTED" },
    { savedAt: "2026-09-07T16:10:00.000Z", type: "COLLECTION_VISIT" },
    { savedAt: "2026-09-07T17:00:00.000Z", type: "END_OF_DAY" },
  ]);

  assert.equal(hours.value, "8h 36m");
});

test("resolveDayRouteWorkingHours does not extend past the last near transaction into lunch or logout", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T08:00:00.000Z", transactionType: "VISIT_REPORT" },
    { savedAt: "2026-09-07T11:00:00.000Z", transactionType: "ORDER_SUBMITTED" },
    { savedAt: "2026-09-07T12:00:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
    { savedAt: "2026-09-07T13:00:00.000Z", transactionType: "LUNCH_BREAK_IN" },
    { savedAt: "2026-09-07T17:00:00.000Z", transactionType: "END_OF_DAY" },
  ]);

  assert.equal(hours.value, "3h");
});

test("resolveDayRouteWorkingHours stops at lunch out when lunch in was not punched", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T08:00:00.000Z", transactionType: "COLLECTION_VISIT" },
    { savedAt: "2026-09-07T12:00:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
    { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "VISIT_REPORT" },
  ]);

  assert.equal(hours.value, "4h");
});

test("resolveDayRouteWorkingHours is blank without a near customer transaction", () => {
  const hours = resolveDayRouteWorkingHours([
    { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "MORNING_ATTENDANCE" },
    { savedAt: "2026-09-07T16:10:00.000Z", transactionType: "END_OF_DAY" },
    { savedAt: "2026-09-07T11:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: true },
  ]);

  assert.equal(hours.minutes, null);
  assert.equal(hours.value, "-");
});
