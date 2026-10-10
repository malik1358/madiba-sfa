import test from "node:test";
import assert from "node:assert/strict";

import {
  HOME_LOCATION_BLOCK_RADIUS_METERS,
  findRepeatedAttendanceLocations,
  haversineDistanceMeters,
  isAtHomeLocation,
} from "../app/lib/homeLocation.js";
import { buildGpsActivityNote } from "../app/lib/geo.js";
import { applyCustomerGpsUpdate } from "../app/lib/customerGpsHistory.js";

test("home-location check uses the 500 meter boundary", () => {
  const home = { latitude: 24.63063, longitude: 46.69947 };
  const nearby = { latitude: 24.6307, longitude: 46.6995 };
  const far = { latitude: 24.64, longitude: 46.7 };

  assert.equal(HOME_LOCATION_BLOCK_RADIUS_METERS, 500);
  assert.ok(haversineDistanceMeters(home, nearby) < 500);
  assert.equal(isAtHomeLocation(nearby, home), true);
  assert.equal(isAtHomeLocation(far, home), false);
  assert.equal(isAtHomeLocation({ latitude: 1 }, home), false);
});

test("repeated attendance candidates count distinct KSA dates, not punch rows", () => {
  const rows = [];
  for (let day = 1; day <= 6; day += 1) {
    const date = `2026-09-${String(day).padStart(2, "0")}T06:00:00.000Z`;
    rows.push({
      user_id: "osama-user",
      entry_type: "MORNING_ATTENDANCE",
      note: buildGpsActivityNote("MORNING_ATTENDANCE", { latitude: 24.63063, longitude: 46.69947 }, { captured_at: date }),
      created_at: date,
    });
    rows.push({
      user_id: "osama-user",
      entry_type: "END_OF_DAY",
      note: buildGpsActivityNote("END_OF_DAY", { latitude: 24.63064, longitude: 46.69946 }, { captured_at: date }),
      created_at: date,
    });
  }
  rows.push({
    user_id: "other-user",
    entry_type: "MORNING_ATTENDANCE",
    note: buildGpsActivityNote("MORNING_ATTENDANCE", { latitude: 24.63063, longitude: 46.69947 }),
    created_at: "2026-09-01T06:00:00.000Z",
  });

  const [candidate] = findRepeatedAttendanceLocations(rows);
  assert.equal(candidate.userId, "osama-user");
  assert.equal(candidate.distinctDays, 6);
  assert.equal(candidate.loginCount, 6);
  assert.equal(candidate.logoutCount, 6);
  assert.equal(findRepeatedAttendanceLocations(rows, 7).length, 0);
});

test("customer GPS writes are rejected inside the actor's saved home radius", async () => {
  const home = { home_latitude: 24.63063, home_longitude: 46.69947 };
  const admin = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.equal(columns, "home_latitude,home_longitude");
          return this;
        },
        not() {
          return this;
        },
        then(resolve) {
          resolve({ data: [home], error: null });
        },
        eq(column, value) {
          assert.equal(column, "id");
          assert.equal(value, "salesman-user");
          return this;
        },
        async maybeSingle() {
          return { data: home, error: null };
        },
      };
    },
  };

  await assert.rejects(applyCustomerGpsUpdate(admin, {
    customerCode: "1234",
    latitude: 24.6307,
    longitude: 46.6995,
    actor: { id: "salesman-user" },
  }), /saved home location.*report only/i);
});