import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKGROUND_GPS_IDLE_MS,
  calculateWorkingHoursMinutes,
  deriveActivityStatus,
  extractLunchTimes,
  filterLogsByKsaEventDate,
  formatKsaDateTime,
  formatWorkingHours,
  getKsaDateString,
  isOnLunchBreak,
  ksaDayBounds,
  ksaMidnightEndIso,
  shouldCaptureIdleGpsPing,
  shouldWarnInactivity,
} from "../app/lib/workdayActivity.js";

test("ksaDayBounds covers the full KSA calendar day", () => {
  const bounds = ksaDayBounds("2026-08-18");
  assert.equal(bounds.startIso, "2026-08-17T21:00:00.000Z");
  assert.equal(bounds.endIso, "2026-08-18T20:59:59.999Z");
});

test("ksaMidnightEndIso stores 11:59 PM KSA", () => {
  assert.equal(ksaMidnightEndIso("2026-08-18"), "2026-08-18T20:59:59.999Z");
  assert.equal(formatKsaDateTime("2026-08-18T20:59:59.999Z"), "18/08/2026, 23:59");
});

test("filterLogsByKsaEventDate keeps only events on the report day", () => {
  const logs = [
    {
      entry_type: "MORNING_ATTENDANCE",
      note: JSON.stringify({ captured_at: "2026-08-18T03:00:00.000Z" }),
      created_at: "2026-08-18T03:00:00.000Z",
    },
    {
      entry_type: "END_OF_DAY",
      note: JSON.stringify({
        autoClosed: true,
        captured_at: "2026-08-17T20:59:59.999Z",
      }),
      created_at: "2026-08-18T03:05:00.000Z",
    },
  ];

  const filtered = filterLogsByKsaEventDate(logs, "2026-08-18");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].entry_type, "MORNING_ATTENDANCE");
});

test("extractLunchTimes returns first lunch out and in after morning attendance", () => {
  const logs = [
    {
      entry_type: "MORNING_ATTENDANCE",
      note: JSON.stringify({ captured_at: "2026-08-18T03:00:00.000Z" }),
      created_at: "2026-08-18T03:00:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_OUT",
      note: JSON.stringify({ captured_at: "2026-08-18T09:00:00.000Z" }),
      created_at: "2026-08-18T09:00:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_IN",
      note: JSON.stringify({ captured_at: "2026-08-18T09:45:00.000Z" }),
      created_at: "2026-08-18T09:45:00.000Z",
    },
  ];

  const lunch = extractLunchTimes(logs);
  assert.ok(lunch.lunchOutAt);
  assert.ok(lunch.lunchInAt);
});

test("isOnLunchBreak is true after lunch out and false after lunch in", () => {
  const logs = [
    {
      entry_type: "LUNCH_BREAK_OUT",
      note: JSON.stringify({ captured_at: "2026-08-18T09:00:00.000Z" }),
      created_at: "2026-08-18T09:00:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_IN",
      note: JSON.stringify({ captured_at: "2026-08-18T09:45:00.000Z" }),
      created_at: "2026-08-18T09:45:00.000Z",
    },
  ];

  assert.equal(isOnLunchBreak(logs.slice(0, 1), Date.parse("2026-08-18T09:30:00.000Z")), true);
  assert.equal(isOnLunchBreak(logs, Date.parse("2026-08-18T10:00:00.000Z")), false);
});

test("deriveActivityStatus marks idle users without recent transactions", () => {
  const loginAt = "2026-08-18T03:00:00.000Z";
  const now = new Date("2026-08-18T12:00:00.000Z");
  const reportDate = getKsaDateString(now);

  const status = deriveActivityStatus({
    loginAt,
    logoutAt: null,
    userLogs: [
      {
        entry_type: "VISIT_REPORT",
        note: JSON.stringify({ captured_at: "2026-08-18T03:10:00.000Z" }),
        created_at: "2026-08-18T03:10:00.000Z",
      },
    ],
    collections: [],
    orders: [],
    reportDate,
    now,
  });

  assert.equal(status, "idle");
});

test("deriveActivityStatus marks active users with recent transactions", () => {
  const loginAt = "2026-08-18T03:00:00.000Z";
  const now = new Date("2026-08-18T12:00:00.000Z");
  const reportDate = getKsaDateString(now);

  const status = deriveActivityStatus({
    loginAt,
    logoutAt: null,
    userLogs: [
      {
        entry_type: "VISIT_REPORT",
        note: JSON.stringify({ captured_at: "2026-08-18T11:45:00.000Z" }),
        created_at: "2026-08-18T11:45:00.000Z",
      },
    ],
    collections: [],
    orders: [],
    reportDate,
    now,
  });

  assert.equal(status, "active");
});

test("shouldWarnInactivity ignores lunch break and ended workdays", () => {
  const loginAt = "2026-08-18T03:00:00.000Z";
  const now = new Date("2026-08-18T12:00:00.000Z");
  const staleVisit = {
    entry_type: "VISIT_REPORT",
    note: JSON.stringify({ captured_at: "2026-08-18T03:10:00.000Z" }),
    created_at: "2026-08-18T03:10:00.000Z",
  };

  assert.equal(
    shouldWarnInactivity({
      loginAt,
      logoutAt: "2026-08-18T13:00:00.000Z",
      userLogs: [staleVisit],
      now,
    }),
    false,
  );

  assert.equal(
    shouldWarnInactivity({
      loginAt,
      logoutAt: null,
      userLogs: [
        staleVisit,
        {
          entry_type: "LUNCH_BREAK_OUT",
          note: JSON.stringify({ captured_at: "2026-08-18T11:30:00.000Z" }),
          created_at: "2026-08-18T11:30:00.000Z",
        },
      ],
      now,
    }),
    false,
  );
});

test("calculateWorkingHoursMinutes sums login to lunch out and lunch in to logout", () => {
  const minutes = calculateWorkingHoursMinutes({
    loginAt: "2026-08-18T03:00:00.000Z",
    lunchOutAt: "2026-08-18T09:00:00.000Z",
    lunchInAt: "2026-08-18T09:45:00.000Z",
    logoutAt: "2026-08-18T13:00:00.000Z",
  });

  assert.equal(minutes, 555);
  assert.equal(formatWorkingHours(minutes), "9h 15m");
});

test("calculateWorkingHoursMinutes uses openEndedAt when logout is missing", () => {
  const minutes = calculateWorkingHoursMinutes({
    loginAt: "2026-08-18T03:00:00.000Z",
    lunchOutAt: "2026-08-18T09:00:00.000Z",
    lunchInAt: "2026-08-18T09:45:00.000Z",
    logoutAt: null,
    openEndedAt: "2026-08-18T12:00:00.000Z",
  });

  assert.equal(minutes, 495);
});

test("calculateWorkingHoursMinutes falls back to login to logout without lunch", () => {
  const minutes = calculateWorkingHoursMinutes({
    loginAt: "2026-08-18T03:00:00.000Z",
    lunchOutAt: null,
    lunchInAt: null,
    logoutAt: "2026-08-18T13:00:00.000Z",
  });

  assert.equal(minutes, 600);
  assert.equal(formatWorkingHours(minutes), "10h");
});

test("formatWorkingHours returns dash when no minutes", () => {
  assert.equal(formatWorkingHours(null), "-");
  assert.equal(formatWorkingHours(0), "-");
});

test("shouldCaptureIdleGpsPing waits for 15 minutes of inactivity", () => {
  const loginTs = Date.parse("2026-08-19T09:00:00.000Z");

  assert.equal(
    shouldCaptureIdleGpsPing({
      now: loginTs + 10 * 60 * 1000,
      lastActivityTs: loginTs,
      lastGpsPingTs: loginTs,
      idleMs: BACKGROUND_GPS_IDLE_MS,
    }),
    false,
  );

  assert.equal(
    shouldCaptureIdleGpsPing({
      now: loginTs + 16 * 60 * 1000,
      lastActivityTs: loginTs,
      lastGpsPingTs: loginTs,
      idleMs: BACKGROUND_GPS_IDLE_MS,
    }),
    true,
  );
});

test("shouldCaptureIdleGpsPing skips when a recent ping already happened", () => {
  const loginTs = Date.parse("2026-08-19T09:00:00.000Z");
  const pingTs = loginTs + 16 * 60 * 1000;

  assert.equal(
    shouldCaptureIdleGpsPing({
      now: pingTs + 5 * 60 * 1000,
      lastActivityTs: loginTs,
      lastGpsPingTs: pingTs,
      idleMs: BACKGROUND_GPS_IDLE_MS,
    }),
    false,
  );
});
