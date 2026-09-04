import test from "node:test";
import assert from "node:assert/strict";

import {
  achievementPercent,
  buildPerformanceSnapshot,
  classifyBuyingCustomers,
  formatPerformanceKpiLine,
  kpiStatus,
  performanceUpdatedStatusLabel,
} from "../app/lib/performanceKpis.js";
import { buildUserVisitReportEmail } from "../app/lib/dailyVisitReportEmail.js";

test("achievement percent is actual over target", () => {
  assert.equal(achievementPercent(50, 100), 50);
  assert.equal(achievementPercent(120, 100), 120);
  assert.equal(achievementPercent(10, 0), null);
});

test("classifies new and repeat buying customers", () => {
  assert.deepEqual(
    classifyBuyingCustomers(["A", "B", "a", "C"], ["A", "D"]),
    { newCustomers: 2, repeatCustomers: 1 },
  );
});

test("KPI status uses monthly pace and 100% achievement", () => {
  assert.equal(kpiStatus({ actual: 100, target: 100, reportDate: "2026-09-10" }).key, "achieved");
  assert.equal(kpiStatus({ actual: 40, target: 100, reportDate: "2026-09-30" }).key, "behind");
  assert.equal(kpiStatus({ actual: 20, target: 100, reportDate: "2026-09-06" }).key, "on_track");
  assert.equal(kpiStatus({ actual: 10, target: 0, reportDate: "2026-09-06" }).key, "no_target");
});

test("updated status explains when admin last saved targets", () => {
  const snapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-04",
    salesmanCode: "SM001",
    actuals: { sales: 40, collection: 10, newCustomers: 1, repeatCustomers: 2 },
    targets: { sales: 100, collection: 50, newCustomers: 2, repeatCustomers: 4 },
    updatedAt: "2026-09-01T08:00:00.000Z",
    updatedByName: "Admin User",
  });

  assert.equal(snapshot.kpis.length, 4);
  assert.equal(snapshot.kpis[0].label, "Sales");
  assert.match(performanceUpdatedStatusLabel(snapshot), /Admin User/);
  assert.match(formatPerformanceKpiLine(snapshot.kpis[0]), /Sales:/);
  assert.match(formatPerformanceKpiLine(snapshot.kpis[0]), /40\.0%/);
});

test("daily visit email includes monthly KPI status", () => {
  const snapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-02",
    salesmanCode: "SM001",
    actuals: { sales: 25000, collection: 8000, newCustomers: 1, repeatCustomers: 3 },
    targets: { sales: 50000, collection: 10000, newCustomers: 2, repeatCustomers: 6 },
    updatedAt: "2026-09-01T08:00:00.000Z",
    updatedByName: "Boss",
  });

  const message = buildUserVisitReportEmail({
    date: "2026-09-02",
    user: {
      userName: "Ahmed (SM001)",
      visitCount: 1,
      farFromCustomerCount: 0,
      totalRouteDistanceKm: 2,
      performance: snapshot,
      entries: [],
    },
  });

  assert.match(message.text, /Monthly KPI status/);
  assert.match(message.text, /Sales:/);
  assert.match(message.text, /Collection:/);
  assert.match(message.text, /New customers:/);
  assert.match(message.text, /Repeat customers:/);
  assert.match(message.html, /Monthly KPI status/);
  assert.match(message.html, /Achievement/);
  assert.match(message.text, /Boss/);
});
