import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_GPS_SOURCE,
  formatGpsActorName,
  gpsCoordinatesEqual,
  gpsSourceLabel,
  buildCustomerGpsAuditPayload,
} from "../app/lib/customerGpsHistory.js";
import { planCustomerLocationUpdates } from "../app/lib/customerLocationImport.js";

test("gpsCoordinatesEqual treats the same standing point as unchanged", () => {
  assert.equal(gpsCoordinatesEqual(24.57151, 46.73935, 24.57151, 46.73935), true);
  assert.equal(gpsCoordinatesEqual(24.57151, 46.73935, 24.58, 46.75), false);
  assert.equal(gpsCoordinatesEqual(null, null, null, null), true);
});

test("formatGpsActorName prefers salesman name over email", () => {
  assert.equal(formatGpsActorName({
    salesman_name: "Ahmed Nabil",
    salesman_code: "SM001",
    email: "admin@example.com",
  }), "Ahmed Nabil (SM001)");
  assert.equal(formatGpsActorName({ email: "admin@example.com", role: "admin" }), "admin@example.com");
});

test("gpsSourceLabel maps stored GPS update sources", () => {
  assert.equal(gpsSourceLabel(CUSTOMER_GPS_SOURCE.customerMaster), "Customer Master");
  assert.equal(gpsSourceLabel(CUSTOMER_GPS_SOURCE.visit), "Visit GPS");
  assert.equal(gpsSourceLabel(CUSTOMER_GPS_SOURCE.excelImport), "Excel import");
});

test("buildCustomerGpsAuditPayload stores actor and source", () => {
  const payload = buildCustomerGpsAuditPayload({
    latitude: 24.57,
    longitude: 46.74,
    actor: { id: "user-1", salesman_name: "Admin User", role: "admin" },
    source: CUSTOMER_GPS_SOURCE.customerMaster,
  });

  assert.equal(payload.latitude, 24.57);
  assert.equal(payload.longitude, 46.74);
  assert.equal(payload.gps_updated_by, "user-1");
  assert.equal(payload.gps_updated_by_name, "Admin User");
  assert.equal(payload.gps_update_source, "customer_master");
  assert.ok(payload.gps_updated_at);
});

test("planCustomerLocationUpdates keeps previous GPS for history", () => {
  const plan = planCustomerLocationUpdates(
    [{ party_name: "1415 shop", customer_code: "1415", latitude: 24.5, longitude: 46.6 }],
    [{ customer_code: "1415", customer_name: "SHOP", latitude: 24.1, longitude: 46.2 }],
  );

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].previous_latitude, 24.1);
  assert.equal(plan.updates[0].previous_longitude, 46.2);
});
