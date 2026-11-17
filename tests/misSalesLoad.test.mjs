import test from "node:test";
import assert from "node:assert/strict";
import { MIS_ACTIVE_SALES_SCAN_MS, misSalesShouldUseCube } from "../app/lib/misSalesLoad.js";

test("MIS active_sales scan budget is under route maxDuration", () => {
  assert.ok(MIS_ACTIVE_SALES_SCAN_MS >= 45_000);
  assert.ok(MIS_ACTIVE_SALES_SCAN_MS <= 55_000);
});

test("misSalesShouldUseCube falls back on timeout, error, or empty rows", () => {
  assert.equal(misSalesShouldUseCube({ timedOut: true, rowCount: 1_000_000 }), true);
  assert.equal(misSalesShouldUseCube({ errored: true, rowCount: 1_000_000 }), true);
  assert.equal(misSalesShouldUseCube({ rowCount: 0 }), true);
  assert.equal(misSalesShouldUseCube({ rowCount: 42 }), false);
});
