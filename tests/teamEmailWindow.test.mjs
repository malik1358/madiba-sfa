import test from "node:test";
import assert from "node:assert/strict";

import {
  deferredTeamEmailKey,
  mergeDeferredTeamEmailItem,
} from "../app/lib/deferredTeamEmail.js";
import {
  isWithinTeamEmailWindow,
  nextTeamEmailWindowStart,
  scheduledPreviousDayEmailDates,
  shouldEmailInactivity,
} from "../app/lib/workdayActivity.js";

test("team email window is 08:30 to 22:00 KSA, Saturday through Thursday", () => {
  assert.equal(isWithinTeamEmailWindow(new Date("2026-10-17T05:29:00.000Z")), false);
  assert.equal(isWithinTeamEmailWindow(new Date("2026-10-17T05:30:00.000Z")), true);
  assert.equal(isWithinTeamEmailWindow(new Date("2026-10-15T18:59:00.000Z")), true);
  assert.equal(isWithinTeamEmailWindow(new Date("2026-10-15T19:00:00.000Z")), false);
  assert.equal(isWithinTeamEmailWindow(new Date("2026-10-16T09:00:00.000Z")), false);
});

test("mail before 08:30 or on Friday waits until the next Saturday–Thursday 08:30", () => {
  assert.equal(
    nextTeamEmailWindowStart(new Date("2026-10-17T04:00:00.000Z")).toISOString(),
    "2026-10-17T05:30:00.000Z",
  );
  assert.equal(
    nextTeamEmailWindowStart(new Date("2026-10-16T12:00:00.000Z")).toISOString(),
    "2026-10-17T05:30:00.000Z",
  );
  assert.equal(
    nextTeamEmailWindowStart(new Date("2026-10-15T19:30:00.000Z")).toISOString(),
    "2026-10-17T05:30:00.000Z",
  );
});

test("Saturday morning sends the held Thursday digest and Friday's previous day", () => {
  assert.deepEqual(
    scheduledPreviousDayEmailDates(new Date("2026-10-17T05:30:00.000Z")),
    ["2026-10-15", "2026-10-16"],
  );
  assert.deepEqual(
    scheduledPreviousDayEmailDates(new Date("2026-10-18T05:30:00.000Z")),
    ["2026-10-17"],
  );
});

test("inactivity email to the team waits until 08:30 and skips Friday", () => {
  const loginAt = "2026-09-06T02:00:00.000Z";
  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: [],
    now: new Date("2026-09-06T05:20:00.000Z"),
  }), false);
  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: [],
    now: new Date("2026-09-06T05:30:00.000Z"),
  }), true);
  assert.equal(shouldEmailInactivity({
    loginAt: "2026-09-04T06:00:00.000Z",
    logoutAt: null,
    userLogs: [],
    now: new Date("2026-09-04T12:00:00.000Z"),
  }), false);
});

test("deferred team emails keep one row per order, month, or upload", () => {
  assert.equal(deferredTeamEmailKey({ kind: "invoice_upload", orderId: "ord-1" }), "invoice_upload:ord-1");
  const first = mergeDeferredTeamEmailItem([], {
    kind: "kpi_targets",
    month: "2026-10",
    salesmanCodes: ["AHMED"],
    changedLabelsBySalesman: { AHMED: ["Sales"] },
  }, new Date("2026-10-15T20:00:00.000Z"));
  const merged = mergeDeferredTeamEmailItem(first, {
    kind: "kpi_targets",
    month: "2026-10",
    salesmanCodes: ["BELAL"],
    changedLabelsBySalesman: { BELAL: ["Collection"] },
  }, new Date("2026-10-15T21:00:00.000Z"));
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].salesmanCodes, ["AHMED", "BELAL"]);
  assert.equal(merged[0].changedLabelsBySalesman.AHMED[0], "Sales");
  assert.equal(merged[0].changedLabelsBySalesman.BELAL[0], "Collection");
});
