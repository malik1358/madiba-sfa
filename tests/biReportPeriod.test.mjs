import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBiReportPeriod,
  formatBiReportPeriodRange,
  lastDayOfMonth,
  resolveBiReportPeriod,
  shiftMonthKey,
} from "../app/lib/biReportPeriod.js";

test("BI report periods resolve from the as-of date", () => {
  assert.equal(lastDayOfMonth("2026-02"), "2026-02-28");
  assert.equal(shiftMonthKey("2026-09", -11), "2025-10");
  assert.deepEqual(resolveBiReportPeriod("all", "2026-09-14"), { dateFrom: "", dateTo: "" });
  assert.deepEqual(resolveBiReportPeriod("mtd", "2026-09-14"), { dateFrom: "2026-09-01", dateTo: "2026-09-14" });
  assert.deepEqual(resolveBiReportPeriod("last-month", "2026-09-14"), { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  assert.deepEqual(resolveBiReportPeriod("qtd", "2026-09-14"), { dateFrom: "2026-07-01", dateTo: "2026-09-14" });
  assert.deepEqual(resolveBiReportPeriod("last-3m", "2026-09-14"), { dateFrom: "2026-07-01", dateTo: "2026-09-14" });
  assert.deepEqual(resolveBiReportPeriod("last-12m", "2026-09-14"), { dateFrom: "2025-10-01", dateTo: "2026-09-14" });
  assert.deepEqual(resolveBiReportPeriod("ytd", "2026-09-14"), { dateFrom: "2026-01-01", dateTo: "2026-09-14" });
  assert.deepEqual(resolveBiReportPeriod("last-year", "2026-09-14"), { dateFrom: "2025-01-01", dateTo: "2025-12-31" });
  assert.deepEqual(
    resolveBiReportPeriod("custom", "2026-09-14", { dateFrom: "2026-03-01", dateTo: "2026-03-31" }),
    { dateFrom: "2026-03-01", dateTo: "2026-03-31" },
  );
  assert.equal(formatBiReportPeriodRange({ dateFrom: "2026-01-01", dateTo: "2026-09-14" }), "2026-01-01 → 2026-09-14");
  assert.equal(applyBiReportPeriod({ groupBy: "customer", dateFrom: "" }, { dateFrom: "2026-01-01", dateTo: "2026-09-14" }).groupBy, "customer");
});
