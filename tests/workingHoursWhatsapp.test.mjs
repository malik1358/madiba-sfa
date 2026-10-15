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

test("formatWorkingHoursWhatsappLines shows computed day-route value", () => {
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "3h 26m", minutes: 206 }),
    ["", "Working hours: 3h 26m"],
  );
  assert.deepEqual(
    formatWorkingHoursWhatsappLines({ known: true, value: "0h", minutes: 0 }),
    ["", "Working hours: 0h"],
  );
});

test("resolveWorkingHoursTillMessage counts near stops up to the message time", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-09-07T06:00:00.000Z", transactionType: "MORNING_ATTENDANCE" },
      { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T09:00:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
      { savedAt: "2026-09-07T10:47:00.000Z", transactionType: "LUNCH_BREAK_OUT" },
      { savedAt: "2026-09-07T12:14:00.000Z", transactionType: "LUNCH_BREAK_IN" },
      { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "COLLECTION_VISIT", isFarFromCustomer: false },
    ],
    untilAt: "2026-09-07T09:00:00.000Z",
  });

  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 86);
  assert.equal(hours.value, "1h 26m");
});

test("resolveWorkingHoursTillMessage includes the current stop as the endpoint", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
    ],
    untilAt: "2026-09-07T09:00:00.000Z",
    currentEntry: {
      savedAt: "2026-09-07T09:00:00.000Z",
      transactionType: "COLLECTION_VISIT",
      isFarFromCustomer: false,
    },
  });

  assert.equal(hours.known, true);
  assert.equal(hours.minutes, 86);
  assert.equal(hours.value, "1h 26m");
});

test("resolveWorkingHoursTillMessage ignores stops after the message time", () => {
  const hours = resolveWorkingHoursTillMessage({
    entries: [
      { savedAt: "2026-09-07T07:34:00.000Z", transactionType: "VISIT_REPORT", isFarFromCustomer: false },
      { savedAt: "2026-09-07T09:00:00.000Z", transactionType: "ORDER_SUBMITTED", isFarFromCustomer: false },
      { savedAt: "2026-09-07T15:00:00.000Z", transactionType: "COLLECTION_VISIT", isFarFromCustomer: false },
    ],
    untilAt: "2026-09-07T09:00:00.000Z",
  });

  assert.equal(hours.minutes, 86);
  assert.equal(hours.value, "1h 26m");
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

test("patchWhatsappSummaryWorkingHours replaces an existing working hours line", () => {
  const patched = patchWhatsappSummaryWorkingHours(
    "Visit date/time: 07/09/2026 10:34\nWorking hours: -\nOutcome: Paid",
    { known: true, value: "1h", minutes: 60 },
  );

  assert.match(patched, /Working hours: 1h/);
  assert.doesNotMatch(patched, /Working hours: -/);
});
