import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessWithoutMorningAttendance,
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

test("collectors can stay on Payment Collections without morning attendance redirect", () => {
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections/legal"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/my-collections"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/payment-collections?customer=1224"), true);
  assert.equal(canAccessWithoutMorningAttendance("/management/new-order"), false);
});
