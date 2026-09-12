import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLatestVisitFromLogRow,
  MY_DAY_VISIT_REPORT_LIMIT,
  visitReportsSinceIso,
} from "../app/lib/myDayPlannerLoad.js";

test("visitReportsSinceIso looks back 120 days", () => {
  const since = visitReportsSinceIso(new Date("2026-09-09T12:00:00.000Z"));
  assert.equal(since, "2026-05-12T12:00:00.000Z");
});

test("applyLatestVisitFromLogRow keeps the newest visit and its next-visit date", () => {
  const latest = new Map();
  const nextVisit = new Map();
  const getSortTimestamp = (value) => new Date(value).getTime();

  applyLatestVisitFromLogRow(latest, nextVisit, {
    created_at: "2026-09-01T10:00:00.000Z",
    note: JSON.stringify({
      customer_code: "1234",
      captured_at: "2026-09-01T10:00:00.000Z",
      next_visit_at: "2026-09-10",
    }),
  }, getSortTimestamp);

  applyLatestVisitFromLogRow(latest, nextVisit, {
    created_at: "2026-09-08T10:00:00.000Z",
    note: JSON.stringify({
      customer_code: "1234",
      captured_at: "2026-09-08T10:00:00.000Z",
      next_visit_at: "2026-09-20",
    }),
  }, getSortTimestamp);

  assert.equal(latest.get("1234"), "2026-09-08T10:00:00.000Z");
  assert.equal(nextVisit.get("1234"), "2026-09-20");
  assert.equal(MY_DAY_VISIT_REPORT_LIMIT, 400);
});

test("applyLatestVisitFromLogRow clears a next-visit date already covered by a later visit", () => {
  const latest = new Map();
  const nextVisit = new Map();
  const getSortTimestamp = (value) => new Date(value).getTime();

  applyLatestVisitFromLogRow(latest, nextVisit, {
    created_at: "2026-09-05T10:00:00.000Z",
    note: JSON.stringify({
      customer_code: "1162C",
      captured_at: "2026-09-05T10:00:00.000Z",
      next_visit_at: "2026-08-25",
    }),
  }, getSortTimestamp);

  assert.equal(latest.get("1162C"), "2026-09-05T10:00:00.000Z");
  assert.equal(nextVisit.get("1162C"), null);
});
