import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurrentWorkingHoursEntry,
  formatWorkingHoursWhatsappLines,
  patchWhatsappSummaryWorkingHours,
  resolveWorkingHoursTillMessage,
} from "../app/lib/workingHoursWhatsapp.js";

test("formatWorkingHoursWhatsappLines shows dash when unknown", () => {
  assert.deepEqual(
    formatWorkingHoursWhatsappLines(null),
    ["", "Working hours: -"],
  );
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: false }),
    ["", "Working hours: -"],
  );
});

test("formatWorkingHoursWhatsappLines shows computed attendance value", () => {
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "3h 26m", minutes: 206 }),
    ["", "Working hours: 3h 26m"],
  );
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "0h", minutes: 0 }),
    ["", "Working hours: 0h"],
  );
});

test("resolveWorkingHoursTillMessage uses login to message time without lunch", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-15T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
    ],
    untilAt: "2026-10-15T08:05:00.000Z",
  });

  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 185);
  assert.equal(hours.value, "3h 5m");
});

test("resolveWorkingHoursTillMessage excludes lunch break from the total", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-15T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-10-15T09:00:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-10-15T10:00:00.000Z", transactionType: "LUNCH_BREAK_IN" },
    ],
    untilAt: "2026-10-15T12:00:00.000Z",
  });

  // 05:00→09:00 = 4h, 10:00→12:00 = 2h → 6h
  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 360);
  assert.equal(hours.value, "6h");
});

test("resolveWorkingHoursTillMessage ignores punches after the message time", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-15T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-10-15T09:00:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-10-15T10:00:00.000Z", transactionType: "LUNCH_BREAK_IN" },
      { savedAt: "2026-10-15T14:00:00.000Z", transactionType: "END_OF_DAY" },
    ],
    untilAt: "2026-10-15T08:05:00.000Z",
  });

  assert.equal(hours.minutes, 185);
  assert.equal(hours.value, "3h 5m");
});

test("resolveWorkingHoursTillMessage returns 0h when login is missing", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [],
    untilAt: "2026-10-15T08:05:00.000Z",
    currentEntry: {
      savedAt: "2026-10-15T08:05:00.000Z",
      transactionType: "COLLECTION_VISIT",
      isFarFromCustomer: true,
    },
  });

  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 0);
  assert.equal(hours.value, "0h");
});

test("buildCurrentWorkingHoursEntry marks far GPS stops", () => {
  const entry = buildCurrentWorkingHoursEntry({
    transactionType: "VISIT_REPORT",
    savedAt: "2026-09-07T09:00:00.000Z",
    location: { latitude: 24.8, longitude: 46.8 },
    customer: { customer_code: "1001", latitude: 24.0, longitude: 46.0 },
    customerCode: "1001",
  });

  assert.equal(entry.transactionType, "VISIT_REPORT");
  assert.equal(entry.isFarFromCustomer, true);
});

test("patchWhatsappSummaryWorkingHours inserts after visit date/time", () => {
  const patched = patchWhatsappSummaryWorkingHours(
    [
      "Customer: Test",
      "Visit date/time: 07/09/2026 10:34",
      "Outcome: Funds received",
    ].join("\n"),
    { known: true, value: "2h 10m", minutes: 130 },
  );

  assert.match(patched, /Visit date\/time: 07\/09\/2026 10:34\nWorking hours: 2h 10m\nOutcome:/);
});

test("patchWhatsappSummaryWorkingHours replaces an existing working hours dash", () => {
  const patched = patchWhatsappSummaryWorkingHours(
    "Visit date/time: 07/09/2026 10:34\nWorking hours: -\nOutcome: Paid",
    { known: true, value: "3h 5m", minutes: 185 },
  );

  assert.match(patched, /Working hours: 3h 5m/);
  assert.doesNotMatch(patched, /Working hours: -/);
});
