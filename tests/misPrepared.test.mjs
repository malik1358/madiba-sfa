import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMisAsOfDate,
  deserializePreparedMis,
  serializePreparedMis,
} from "../app/lib/misPrepared.js";

test("defaultMisAsOfDate returns previous KSA month-end", () => {
  assert.equal(defaultMisAsOfDate("2026-11-02"), "2026-10-31");
  assert.equal(defaultMisAsOfDate("2026-03-01"), "2026-02-28");
  assert.equal(defaultMisAsOfDate("2026-01-15"), "2025-12-31");
});

test("serialize/deserialize prepared MIS round-trips", () => {
  const payload = serializePreparedMis({
    asOfDate: "2026-10-31",
    builtAt: "2026-11-02T10:00:00.000Z",
    batchId: "batch-1",
    report: { asOfMonth: "2026-10", headline: { sales: 1 } },
  });
  const parsed = deserializePreparedMis(payload);
  assert.equal(parsed.asOfDate, "2026-10-31");
  assert.equal(parsed.batchId, "batch-1");
  assert.equal(parsed.report.headline.sales, 1);
  assert.equal(deserializePreparedMis({ version: 99, report: {} }), null);
});
