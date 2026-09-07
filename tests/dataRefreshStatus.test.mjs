import test from "node:test";
import assert from "node:assert/strict";

import {
  dataRefreshProgressPercent,
  finishDataRefreshJob,
  formatDataAge,
  getDataRefreshStatus,
  isDataRefreshStale,
  markDataRefreshStep,
  startDataRefreshJob,
} from "../app/lib/dataRefreshStatus.js";

test("formatDataAge describes how old saved device data is", () => {
  const now = Date.parse("2026-09-07T08:00:00.000Z");
  assert.equal(formatDataAge(now - 30 * 1000, now), "just now");
  assert.equal(formatDataAge(now - 12 * 60 * 1000, now), "12m ago");
  assert.equal(formatDataAge(now - 5 * 60 * 60 * 1000, now), "5h ago");
  assert.equal(formatDataAge(now - 2 * 24 * 60 * 60 * 1000, now), "2d ago");
  assert.equal(formatDataAge("", now), "unknown");
});

test("data refresh job tracks done versus pending steps", () => {
  startDataRefreshJob("device-data", ["download", "customers", "items"]);
  let status = getDataRefreshStatus();
  assert.equal(status.active, true);
  assert.equal(status.doneCount, 0);
  assert.equal(status.totalCount, 3);
  assert.equal(status.steps[0].status, "running");
  assert.equal(dataRefreshProgressPercent(status) > 0, true);

  markDataRefreshStep("download", "done");
  markDataRefreshStep("customers", "running");
  status = getDataRefreshStatus();
  assert.equal(status.doneCount, 1);
  assert.equal(status.steps[1].status, "running");
  assert.equal(status.steps[2].status, "pending");

  finishDataRefreshJob({ lastSavedAt: Date.now(), lastBuiltAt: "2026-09-07T06:00:00.000Z" });
  status = getDataRefreshStatus();
  assert.equal(status.active, false);
  assert.equal(status.lastBuiltAt, "2026-09-07T06:00:00.000Z");
  assert.equal(status.steps.length, 0);
});

test("isDataRefreshStale flags dumps older than six hours", () => {
  const now = Date.parse("2026-09-07T12:00:00.000Z");
  assert.equal(isDataRefreshStale({ lastSavedAt: now - 2 * 60 * 60 * 1000 }, 6 * 60 * 60 * 1000, now), false);
  assert.equal(isDataRefreshStale({ lastSavedAt: now - 8 * 60 * 60 * 1000 }, 6 * 60 * 60 * 1000, now), true);
  assert.equal(isDataRefreshStale({ lastSavedAt: 0, lastBuiltAt: "" }, 6 * 60 * 60 * 1000, now), true);
});
