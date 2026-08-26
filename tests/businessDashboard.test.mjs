import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBusinessAlerts,
  buildBusinessKpis,
  summarizeOutstandingRows,
} from "../app/lib/businessDashboard.js";

test("summarizeOutstandingRows totals exposure", () => {
  const summary = summarizeOutstandingRows([
    { total_outstanding: 1000, outstanding_61_90: 200, outstanding_above_120: 100 },
    { total_outstanding: 500, outstanding_above_90: 300 },
  ]);

  assert.equal(summary.totalOutstanding, 1500);
  assert.equal(summary.above90, 600);
  assert.equal(summary.customersWithDue, 2);
});

test("buildBusinessKpis marks idle and attendance status", () => {
  const kpis = buildBusinessKpis({
    salesToday: 0,
    fieldHeadcount: 10,
    loggedInCount: 7,
    idleNow: 2,
    pendingOrdersOlder7: 3,
  });

  const attendance = kpis.find((row) => row.key === "attendance_rate");
  const idle = kpis.find((row) => row.key === "idle_now");
  const pending = kpis.find((row) => row.key === "pending_orders_7d");

  assert.equal(attendance.display, "70%");
  assert.equal(attendance.status, "orange");
  assert.equal(idle.status, "red");
  assert.equal(pending.status, "red");
});

test("buildBusinessAlerts prioritizes red operational issues", () => {
  const alerts = buildBusinessAlerts({
    reportDate: "2026-08-26",
    isToday: true,
    notLoggedInUsers: ["Ahmed", "Karim"],
    idleUsers: ["Salem"],
    pendingOrdersOlder30: 2,
    outstandingStaleDays: 10,
    outstandingUploadedAt: "2026-08-16T10:00:00.000Z",
    fieldHeadcount: 5,
    attendanceRate: 40,
    outstandingAbove90: 600000,
  });

  assert.ok(alerts.some((row) => row.code === "NOT_LOGGED_IN" && row.severity === "red"));
  assert.ok(alerts.some((row) => row.code === "PENDING_30D"));
  assert.ok(alerts.some((row) => row.code === "HIGH_OVERDUE"));
  assert.equal(alerts[0].severity, "red");
});
