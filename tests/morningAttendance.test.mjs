import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessWithoutMorningAttendance,
  isInlineMorningAttendancePath,
  isMorningAttendanceRequiredForRole,
  WORKDAY_GATE_READY_EVENT,
  WORKDAY_TIMES_UPDATED_EVENT,
  todayAttendanceBounds,
  todayDateKey,
} from "../app/lib/morningAttendance.js";
import { getKsaDateString, ksaDayBounds } from "../app/lib/workdayActivity.js";

test("morning attendance uses the KSA calendar day, not UTC midnight", () => {
  const justAfterKsaMidnight = new Date("2026-08-29T21:30:00.000Z");
  assert.equal(todayDateKey(justAfterKsaMidnight), "2026-08-30");
  assert.notEqual(justAfterKsaMidnight.toISOString().slice(0, 10), "2026-08-30");
  assert.deepEqual(
    todayAttendanceBounds(justAfterKsaMidnight),
    ksaDayBounds(getKsaDateString(justAfterKsaMidnight)),
  );
});

test("Collections paths skip the redirect but use the inline attendance gate", () => {
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections/legal"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/my-collections"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections?customer=1224"), true);
  assert.equal(isInlineMorningAttendancePath("/management/payment-collections?customer=1224"), true);
  assert.equal(isInlineMorningAttendancePath("/management/my-day"), false);
  assert.equal(canAccessWithoutMorningAttendance("/management/new-order"), false);
  assert.equal(canAccessWithoutMorningAttendance("/management/visit-without-order"), false);
});

test("morning attendance is required for every role except admin", () => {
  assert.equal(isMorningAttendanceRequiredForRole("admin"), false);
  for (const role of ["manager", "salesman", "collector", "invoice_maker", "invoice-maker", "product-promoter"]) {
    assert.equal(isMorningAttendanceRequiredForRole(role), true, role);
  }
});

test("workday gate ready event stays aligned with workday times updated event", () => {
  assert.equal(WORKDAY_GATE_READY_EVENT, WORKDAY_TIMES_UPDATED_EVENT);
});
