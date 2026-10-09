import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLatestNearVisitDatesByCustomer,
  daysSinceKsaDate,
} from "../app/lib/latestCustomerVisits.js";

test("latest visit uses any user's near visit and skips a later FAR visit", () => {
  const latest = buildLatestNearVisitDatesByCustomer([
    { customer_code: "A1", latitude: 24.7136, longitude: 46.6753 },
  ], {
    collectionVisits: [
      {
        id: 10,
        customer_code: "A1",
        saved_at: "2026-10-05T08:00:00.000Z",
        latitude: 24.7136,
        longitude: 46.6753,
        created_by: "another-user",
      },
      {
        id: 11,
        customer_code: "A1",
        saved_at: "2026-10-06T08:00:00.000Z",
        latitude: 25.2,
        longitude: 46.6753,
        created_by: "third-user",
      },
    ],
  });

  assert.equal(latest.get("A1"), "2026-10-05");
});

test("field visit logs from any user are included unless FAR", () => {
  const latest = buildLatestNearVisitDatesByCustomer([
    { customer_code: "A1", latitude: 24.7136, longitude: 46.6753 },
  ], {
    activityLogs: [
      {
        entry_type: "VISIT_REPORT",
        created_at: "2026-10-05T10:00:00.000Z",
        note: JSON.stringify({
          customer_code: "A1",
          captured_at: "2026-10-05T10:00:00.000Z",
          latitude: 24.7136,
          longitude: 46.6753,
        }),
        user_id: "another-user",
      },
      {
        entry_type: "VISIT_REPORT",
        created_at: "2026-10-06T10:00:00.000Z",
        note: JSON.stringify({
          customer_code: "A1",
          captured_at: "2026-10-06T10:00:00.000Z",
          latitude: 25.2,
          longitude: 46.6753,
        }),
        user_id: "third-user",
      },
    ],
  });

  assert.equal(latest.get("A1"), "2026-10-05");
});

test("visit-day count uses KSA calendar dates rather than elapsed hours", () => {
  assert.equal(daysSinceKsaDate("2026-10-05", "2026-10-06"), 1);
  assert.equal(daysSinceKsaDate("2026-10-06", "2026-10-06"), 0);
});

test("accepted GPS update does not classify its visit as FAR", () => {
  const latest = buildLatestNearVisitDatesByCustomer([
    { customer_code: "A1", latitude: 24.7136, longitude: 46.6753 },
  ], {
    activityLogs: [{
      entry_type: "VISIT_REPORT",
      created_at: "2026-10-06T10:00:00.000Z",
      note: JSON.stringify({
        customer_code: "A1",
        captured_at: "2026-10-06T10:00:00.000Z",
        latitude: 25.2,
        longitude: 46.6753,
        customer_gps_update_accepted: true,
      }),
    }],
  });

  assert.equal(latest.get("A1"), "2026-10-06");
});