import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeReceiptMonthsIntoPerformanceWindow,
  nextMonthStart,
  selectMonthlyPerformanceMonths,
  shiftMonthKey,
} from "../app/lib/monthlyPerformanceMonths.js";

test("selectMonthlyPerformanceMonths keeps six historic months and adds the current month when it has data", () => {
  const months = selectMonthlyPerformanceMonths(
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07", "2026-08", "2026-09"],
    "2026-09",
  );

  assert.deepEqual(months, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07", "2026-08", "2026-09"]);
});

test("selectMonthlyPerformanceMonths omits the current month when it has no activity", () => {
  const months = selectMonthlyPerformanceMonths(
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07", "2026-08"],
    "2026-09",
  );

  assert.deepEqual(months, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-07", "2026-08"]);
});

test("nextMonthStart rolls into the following year", () => {
  assert.equal(nextMonthStart("2026-09"), "2026-10-01");
  assert.equal(nextMonthStart("2026-12"), "2027-01-01");
});

test("shiftMonthKey moves backward across year boundaries", () => {
  assert.equal(shiftMonthKey("2026-09", -6), "2026-03");
  assert.equal(shiftMonthKey("2026-02", -3), "2025-11");
});

test("mergeReceiptMonthsIntoPerformanceWindow adds receipt-only months without dropping sales months", () => {
  const months = mergeReceiptMonthsIntoPerformanceWindow(
    ["2025-12", "2026-01", "2026-03", "2026-04", "2026-05", "2026-07"],
    ["2026-02", "2026-06", "2025-10"],
    "2026-09",
  );

  assert.deepEqual(months, [
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
  ]);
});

test("mergeReceiptMonthsIntoPerformanceWindow keeps current-month receipts", () => {
  const months = mergeReceiptMonthsIntoPerformanceWindow(
    ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
    ["2026-09"],
    "2026-09",
  );

  assert.deepEqual(months, [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ]);
});
