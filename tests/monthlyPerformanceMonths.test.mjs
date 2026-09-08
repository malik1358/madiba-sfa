import test from "node:test";
import assert from "node:assert/strict";

import {
  nextMonthStart,
  selectMonthlyPerformanceMonths,
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
