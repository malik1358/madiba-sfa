import test from "node:test";
import assert from "node:assert/strict";

import { buildGpsActivityNote } from "../app/lib/geo.js";
import {
  findEndOfDayLog,
  findFirstCustomerEntryLog,
  findLastCustomerEntryLog,
  findMorningAttendanceLog,
  isLoginFarFromFirstCustomer,
  isLogoutFarFromLastCustomer,
  shouldShowLoginFirstCustomerHint,
  shouldShowLogoutLastCustomerHint,
} from "../app/lib/loginFirstCustomerHint.js";

function activityLog(entryType, latitude, longitude) {
  return {
    entry_type: entryType,
    note: buildGpsActivityNote(entryType, { latitude, longitude }),
  };
}

test("finds morning attendance and the first customer entry", () => {
  const logs = [
    activityLog("MORNING_ATTENDANCE", 24.7, 46.6),
    activityLog("GPS_PING", 24.71, 46.61),
    activityLog("VISIT_REPORT", 24.8, 46.8),
    activityLog("ORDER_SUBMITTED", 24.81, 46.81),
  ];

  assert.equal(findMorningAttendanceLog(logs).entry_type, "MORNING_ATTENDANCE");
  assert.equal(findFirstCustomerEntryLog(logs).entry_type, "VISIT_REPORT");
});

test("login far from first customer uses the same 0.5 km threshold", () => {
  const login = activityLog("MORNING_ATTENDANCE", 24.7, 46.6);
  const nearby = activityLog("VISIT_REPORT", 24.7001, 46.6001);
  const far = activityLog("VISIT_REPORT", 24.8, 46.8);

  assert.equal(isLoginFarFromFirstCustomer(login, nearby), false);
  assert.equal(isLoginFarFromFirstCustomer(login, far), true);
});

test("finds end of day and the last customer entry", () => {
  const logs = [
    activityLog("VISIT_REPORT", 24.8, 46.8),
    activityLog("COLLECTION_VISIT", 24.81, 46.81),
    activityLog("GPS_PING", 24.82, 46.82),
    activityLog("END_OF_DAY", 24.7, 46.6),
  ];

  assert.equal(findLastCustomerEntryLog(logs).entry_type, "COLLECTION_VISIT");
  assert.equal(findEndOfDayLog(logs).entry_type, "END_OF_DAY");
});

test("logout far from last customer uses the same 0.5 km threshold", () => {
  const nearby = activityLog("END_OF_DAY", 24.8001, 46.8001);
  const far = activityLog("END_OF_DAY", 24.7, 46.6);
  const last = activityLog("VISIT_REPORT", 24.8, 46.8);

  assert.equal(isLogoutFarFromLastCustomer(nearby, last), false);
  assert.equal(isLogoutFarFromLastCustomer(far, last), true);
});

test("logout hint stays hidden for auto-closed or dismissed logout", () => {
  const logs = [
    activityLog("VISIT_REPORT", 24.8, 46.8),
    {
      entry_type: "END_OF_DAY",
      note: JSON.stringify({
        action: "END_OF_DAY",
        autoClosed: true,
        location: { latitude: 24.7, longitude: 46.6 },
      }),
    },
  ];

  assert.equal(shouldShowLogoutLastCustomerHint({ logs, dismissed: false }), false);
  assert.equal(shouldShowLogoutLastCustomerHint({
    logs: [
      activityLog("VISIT_REPORT", 24.8, 46.8),
      activityLog("END_OF_DAY", 24.7, 46.6),
    ],
    dismissed: true,
  }), false);
  assert.equal(shouldShowLogoutLastCustomerHint({
    logs: [
      activityLog("VISIT_REPORT", 24.8, 46.8),
      activityLog("END_OF_DAY", 24.7, 46.6),
    ],
    dismissed: false,
  }), true);
});

test("hint stays hidden when dismissed or GPS is missing", () => {
  const logs = [
    activityLog("MORNING_ATTENDANCE", 24.7, 46.6),
    activityLog("VISIT_REPORT", 24.8, 46.8),
  ];

  assert.equal(shouldShowLoginFirstCustomerHint({ logs, dismissed: true }), false);
  assert.equal(shouldShowLoginFirstCustomerHint({
    logs: [{ entry_type: "MORNING_ATTENDANCE", note: "{}" }, logs[1]],
  }), false);
  assert.equal(shouldShowLoginFirstCustomerHint({ logs, dismissed: false }), true);
});
