import test from "node:test";
import assert from "node:assert/strict";

import { buildDayRoutePoints, buildDayRouteSvg } from "../app/lib/dayRouteMap.js";

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
  const svg = buildDayRouteSvg(points);
  assert.match(svg, /#dc2626/);
  assert.match(svg, /<path /);
});
