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

test("customerRowHasSavedGps requires both coordinates", async () => {
  const { customerRowHasSavedGps } = await import("../app/lib/customerGpsHistory.js");
  assert.equal(customerRowHasSavedGps({ latitude: 24.7, longitude: 46.6 }), true);
  assert.equal(customerRowHasSavedGps({ latitude: 24.7 }), false);
  assert.equal(customerRowHasSavedGps({ latitude: null, longitude: null }), false);
});

test("promoteEntryGpsToCustomerIfMissing writes when customer has no GPS", async () => {
  const { promoteEntryGpsToCustomerIfMissing, CUSTOMER_GPS_SOURCE } = await import("../app/lib/customerGpsHistory.js");
  const updates = [];
  const history = [];
  const admin = {
    from(table) {
      if (table === "customers") {
        return {
          update(payload) {
            updates.push(payload);
            return {
              eq() {
                return {
                  select() {
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            customer_code: "1573",
                            latitude: payload.latitude,
                            longitude: payload.longitude,
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "customer_gps_history") {
        return {
          async insert(row) {
            history.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const result = await promoteEntryGpsToCustomerIfMissing(admin, {
    customerCode: "1573",
    latitude: 24.7136,
    longitude: 46.6753,
    actor: { id: "u1", salesman_name: "Abdul", role: "salesman" },
    customerRow: { customer_code: "1573", latitude: null, longitude: null },
  });

  assert.equal(result?.latitude, 24.7136);
  assert.equal(result?.longitude, 46.6753);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].gps_update_source, CUSTOMER_GPS_SOURCE.visit);
  assert.equal(history.length, 1);
});

test("promoteEntryGpsToCustomerIfMissing skips when customer already has GPS", async () => {
  const { promoteEntryGpsToCustomerIfMissing } = await import("../app/lib/customerGpsHistory.js");
  let touched = false;
  const admin = {
    from() {
      touched = true;
      throw new Error("should not query when GPS already saved");
    },
  };

  const result = await promoteEntryGpsToCustomerIfMissing(admin, {
    customerCode: "1573",
    latitude: 24.7136,
    longitude: 46.6753,
    customerRow: { customer_code: "1573", latitude: 24.1, longitude: 46.2 },
  });

  assert.equal(result, null);
  assert.equal(touched, false);
});
