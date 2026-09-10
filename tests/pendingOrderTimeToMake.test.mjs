import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPendingDuration,
  isPendingOrderTimeFrozen,
  pendingOrderTimeToMakeBucket,
  pendingOrderTimeToMakeSeconds,
  shouldRunTimeToMakeClock,
} from "../app/lib/pendingOrderTimeToMake.js";

test("pending time runs from order created until now when invoice status is unset", () => {
  const created = "2026-09-10T08:00:00.000Z";
  const now = Date.parse("2026-09-10T10:15:07.000Z");
  assert.equal(shouldRunTimeToMakeClock("-"), true);
  assert.equal(pendingOrderTimeToMakeSeconds({ created_at: created }, null, now, "-"), 2 * 3600 + 15 * 60 + 7);
  assert.equal(isPendingOrderTimeFrozen(null, "-"), false);
});

test("pending time does not run when invoice status is set", () => {
  const order = { created_at: "2026-09-10T08:00:00.000Z" };
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  assert.equal(shouldRunTimeToMakeClock("Pending for credit approval"), false);
  assert.equal(isPendingOrderTimeFrozen(null, "Pending for credit approval"), true);
  assert.equal(pendingOrderTimeToMakeSeconds(order, null, now, "Pending for credit approval"), null);
});

test("pending time freezes after invoice upload", () => {
  const order = { created_at: "2026-09-10T08:00:00.000Z" };
  const meta = { invoiceUploadedAt: "2026-09-10T09:00:30.000Z", invoiceBuildSeconds: 3630 };
  assert.equal(isPendingOrderTimeFrozen(meta, "Invoice made"), true);
  assert.equal(pendingOrderTimeToMakeSeconds(order, meta, Date.parse("2026-09-10T12:00:00.000Z"), "Invoice made"), 3630);
});

test("duration and filter buckets stay readable for long waits", () => {
  assert.equal(formatPendingDuration(0), "0s");
  assert.equal(formatPendingDuration(75), "1m 15s");
  assert.equal(formatPendingDuration(2 * 3600 + 5), "2h 0m 5s");
  assert.equal(formatPendingDuration(2 * 86400 + 3600 + 5), "2d 1h 0m 5s");
  assert.equal(pendingOrderTimeToMakeBucket(59), "Under 1 hour");
  assert.equal(pendingOrderTimeToMakeBucket(5 * 3600), "1-6 hours");
  assert.equal(pendingOrderTimeToMakeBucket(10 * 3600), "6-24 hours");
  assert.equal(pendingOrderTimeToMakeBucket(3 * 86400), "1-7 days");
  assert.equal(pendingOrderTimeToMakeBucket(10 * 86400), "Over 7 days");
});
