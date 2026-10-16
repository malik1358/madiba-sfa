import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_PERFORMANCE_SETTING_KEY,
  buildDailyPerformanceRecord,
  judgeDailySpeed,
  median,
  parsePerformanceHistory,
  runAppPerformanceCheck,
  withDailyCheck,
} from "../app/lib/appPerformanceCheck.js";

const steadyMetrics = {
  external_build_info_ms: 400,
  build_info_ms: 80,
  auth_health_ms: 120,
  db_ping_ms: 40,
  customers_count_ms: 70,
  recent_orders_ms: 90,
};

function priorDays(count, metrics = steadyMetrics) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    metrics,
  }));
}

test("median uses the middle sample", () => {
  assert.equal(median([10, 30, 20]), 20);
  assert.equal(median([10, 40]), 25);
  assert.equal(median([]), null);
});

test("the first stored day is a baseline", () => {
  const judged = judgeDailySpeed([], steadyMetrics);
  assert.equal(judged.status, "baseline");
  assert.deepEqual(judged.slower, []);
});

test("a large jump after three steady days is slower", () => {
  const judged = judgeDailySpeed(priorDays(3), {
    ...steadyMetrics,
    recent_orders_ms: 900,
  });
  assert.equal(judged.status, "slower");
  assert.deepEqual(judged.slower, ["recent_orders_ms"]);
});

test("small jitter stays steady", () => {
  const judged = judgeDailySpeed(priorDays(4), {
    ...steadyMetrics,
    recent_orders_ms: 140,
  });
  assert.equal(judged.status, "steady");
  assert.deepEqual(judged.slower, []);
});

test("same-day reruns replace that day and history stays capped", () => {
  const stored = withDailyCheck({
    checks: [
      { date: "2026-10-01", metrics: steadyMetrics },
      { date: "2026-10-02", metrics: steadyMetrics },
    ],
  }, { date: "2026-10-02", metrics: { ...steadyMetrics, db_ping_ms: 55 } }, 2);
  assert.deepEqual(stored.checks.map((row) => row.date), ["2026-10-01", "2026-10-02"]);
  assert.equal(stored.checks[1].metrics.db_ping_ms, 55);
});

test("probe failures are stored as an error day", () => {
  const record = buildDailyPerformanceRecord({
    date: "2026-10-16",
    checkedAt: "2026-10-16T02:30:00.000Z",
    metrics: steadyMetrics,
    counts: { customers: 10, recent_orders: 2 },
    errors: { db_ping: "timeout" },
    priorChecks: priorDays(5),
  });
  assert.equal(record.status, "error");
  assert.equal(record.errors.db_ping, "timeout");
});

test("a check reads history, stores one day, and ignores a bad external time", async () => {
  let saved = null;
  const admin = {
    from() {
      const builder = {
        select() { return builder; },
        limit() { return Promise.resolve({ error: null }); },
        gte() { return builder; },
        eq() { return builder; },
        maybeSingle: async () => ({
          data: { setting_value: JSON.stringify({ version: 1, checks: [] }) },
          error: null,
        }),
        upsert: async (row) => {
          saved = row;
          return { error: null };
        },
        then(resolve, reject) {
          return Promise.resolve({ count: 4, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const result = await runAppPerformanceCheck(admin, {
    now: new Date("2026-10-16T02:30:00.000Z"),
    date: "2026-10-16",
    externalBuildInfoMs: -1,
    probeResults: {
      buildInfo: { ok: true, ms: 80 },
      authHealth: { ok: true, ms: 100 },
      dbPing: { ok: true, ms: 30 },
      customers: { ok: true, ms: 50, value: 4 },
      orders: { ok: true, ms: 60, value: 4 },
    },
  });

  assert.equal(result.status, "baseline");
  assert.equal(result.metrics.external_build_info_ms, null);
  assert.equal(saved.setting_key, APP_PERFORMANCE_SETTING_KEY);
  assert.equal(parsePerformanceHistory(saved.setting_value).checks.length, 1);
});
