import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCustomerFarFlags,
  buildCurrentWorkingHoursEntry,
  formatWorkingHoursWhatsappLines,
  patchWhatsappSummaryWorkingHours,
  resolveWorkingHoursTillMessage,
} from "../app/lib/workingHoursWhatsapp.js";

test("formatWorkingHoursWhatsappLines shows dash when unknown", () => {
  assert.deepEqual(
    formatWorkingHoursWhatsappLines(null),
    ["", "Working hours: -", ""],
  );
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: false }),
    ["", "Working hours: -", ""],
  );
});

test("formatWorkingHoursWhatsappLines pads blank lines before and after", () => {
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "3h 26m", minutes: 206 }),
    ["", "Working hours: 3h 26m", ""],
  );
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "0h", minutes: 0 }),
    ["", "Working hours: 0h", ""],
  );
});

test("resolveWorkingHoursTillMessage ignores login when there is no near customer stop", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-15T05:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
    ],
    untilAt: "2026-10-15T08:05:00.000Z",
    currentEntry: {
      savedAt: "2026-10-15T08:05:00.000Z",
      transactionType: "VISIT_REPORT",
      isFarFromCustomer: false,
    },
  });

  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 0);
  assert.equal(hours.value, "0h");
});

test("resolveWorkingHoursTillMessage matches the daily visit near-stop window", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-18T06:09:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-10-18T06:14:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-18T10:03:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-10-18T13:48:00.000Z", transactionType: "LUNCH_BREAK_IN" },
      { savedAt: "2026-10-18T13:55:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: true },
      { savedAt: "2026-10-18T14:19:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-18T15:50:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-18T17:24:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
    ],
    untilAt: "2026-10-18T18:49:00.000Z",
    currentEntry: {
      savedAt: "2026-10-18T18:49:00.000Z",
      transactionType: "VISIT_REPORT",
      isFarFromCustomer: false,
    },
  });

  // Login 09:09 and the single morning visit do not count.
  // Afternoon near stops 17:19 → 21:49 = 4h 30m. The far stop at 16:55 does not start the window.
  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 270);
  assert.match(hours.value, /^4h 30m \(17:19 - 21:49\)$/);
});

test("resolveWorkingHoursTillMessage drops an unlogged idle longer than two hours", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-09-07T06:40:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T08:43:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
      { savedAt: "2026-09-07T14:18:00.000Z", transactionType: "COLLECTION_VISIT", isFarFromCustomer: false },
    ],
    untilAt: "2026-09-07T15:46:00.000Z",
    currentEntry: {
      savedAt: "2026-09-07T15:46:00.000Z",
      transactionType: "VISIT_REPORT",
      isFarFromCustomer: false,
    },
  });

  // 09:40–11:43 is 2h 3m with nothing logged, so it is removed along with the longer midday hole.
  assert.equal(hours.minutes, 88);
  assert.match(hours.value, /^1h 28m \(17:18 - 18:46\)$/);
});

test("resolveWorkingHoursTillMessage keeps the span when a draft splits a long idle", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-18T07:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-18T08:40:00.000Z", transactionType: "ORDER_DRAFT" },
    ],
    untilAt: "2026-10-18T10:30:00.000Z",
    currentEntry: {
      savedAt: "2026-10-18T10:30:00.000Z",
      transactionType: "VISIT_REPORT",
      isFarFromCustomer: false,
    },
  });

  assert.equal(hours.minutes, 210);
  assert.match(hours.value, /^3h 30m \(/);
});

test("resolveWorkingHoursTillMessage ignores stops after the message time", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-10-15T07:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-15T08:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-10-15T14:00:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
    ],
    untilAt: "2026-10-15T08:00:00.000Z",
  });

  assert.equal(hours.minutes, 60);
  assert.match(hours.value, /^1h \(/);
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

test("applyCustomerFarFlags uses the customer pin and keeps an accepted GPS update near", () => {
  const entries = applyCustomerFarFlags([
    {
      savedAt: "2026-10-18T14:19:00.000Z",
      transactionType: "VISIT_REPORT",
      customerCode: "1603",
      latitude: 24.564171,
      longitude: 46.708933,
    },
    {
      savedAt: "2026-10-18T13:55:00.000Z",
      transactionType: "VISIT_REPORT",
      customerCode: "1099",
      latitude: 24.80,
      longitude: 46.90,
    },
    {
      savedAt: "2026-10-18T12:00:00.000Z",
      transactionType: "VISIT_REPORT",
      customerCode: "1099",
      latitude: 24.80,
      longitude: 46.90,
      customerGpsUpdateAccepted: true,
    },
  ], [
    { customer_code: "1603", latitude: 24.5642, longitude: 46.7089 },
    { customer_code: "1099", latitude: 24.50, longitude: 46.60 },
  ]);

  assert.equal(entries[0].isFarFromCustomer, false);
  assert.equal(entries[1].isFarFromCustomer, true);
  assert.equal(entries[2].isFarFromCustomer, false);
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

  const accepted = buildCurrentWorkingHoursEntry({
    transactionType: "VISIT_REPORT",
    savedAt: "2026-09-07T09:00:00.000Z",
    location: { latitude: 24.8, longitude: 46.8 },
    customer: { customer_code: "1001", latitude: 24.0, longitude: 46.0 },
    customerGpsUpdateAccepted: true,
  });
  assert.equal(accepted.isFarFromCustomer, false);
});

test("patchWhatsappSummaryWorkingHours inserts after visit date/time with blank lines", () => {
  const patched = patchWhatsappSummaryWorkingHours(
    [
      "Customer: Test",
      "Visit date/time: 07/09/2026 10:34",
      "Outcome: Funds received",
    ].join("\n"),
    { known: true, value: "2h 10m", minutes: 130 },
  );

  assert.match(patched, /Visit date\/time: 07\/09\/2026 10:34\n\nWorking hours: 2h 10m\n\nOutcome:/);
});

test("patchWhatsappSummaryWorkingHours replaces an existing working hours dash", () => {
  const patched = patchWhatsappSummaryWorkingHours(
    "Visit date/time: 07/09/2026 10:34\n\nWorking hours: -\n\nOutcome: Paid",
    { known: true, value: "3h 5m", minutes: 185 },
  );

  assert.match(patched, /\n\nWorking hours: 3h 5m\n\n/);
  assert.doesNotMatch(patched, /Working hours: -/);
});
