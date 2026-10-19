import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToDateKey,
  filterScheduleDateGroups,
  getScheduleWindowEndDateKey,
  isScheduleDateInWindow,
} from "../app/lib/scheduleDateWindow.js";

test("schedule window includes past, today, and tomorrow only", () => {
  const today = "2026-09-03";
  assert.equal(getScheduleWindowEndDateKey(today), "2026-09-04");
  assert.equal(isScheduleDateInWindow("2026-08-07", today), true);
  assert.equal(isScheduleDateInWindow("2026-09-03", today), true);
  assert.equal(isScheduleDateInWindow("2026-09-04", today), true);
  assert.equal(isScheduleDateInWindow("2026-09-05", today), false);
  assert.equal(isScheduleDateInWindow("2026-12-01", today), false);
});

test("addDaysToDateKey crosses month and year boundaries", () => {
  assert.equal(addDaysToDateKey("2026-09-30", 1), "2026-10-01");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
});

test("filterScheduleDateGroups drops dates after tomorrow", () => {
  const groups = filterScheduleDateGroups([
    { dateKey: "2026-09-02", rows: [1] },
    { dateKey: "2026-09-03", rows: [2] },
    { dateKey: "2026-09-04", rows: [3] },
    { dateKey: "2026-09-12", rows: [4] },
  ], "2026-09-03");

  assert.deepEqual(groups.map((group) => group.dateKey), ["2026-09-02", "2026-09-03", "2026-09-04"]);
});
