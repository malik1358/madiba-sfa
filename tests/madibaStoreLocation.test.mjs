import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
  isFarFromCustomer,
} from "../app/lib/customerLocation.js";
import {
  formatEntryCoordinates,
  markVisitsWithAcceptedGpsHistory,
  shouldMarkVisitFarFromCustomer,
} from "../app/lib/dailyVisitReportStats.js";
import {
  MADIBA_STORE_BLOCK_RADIUS_METERS,
  MADIBA_STORE_CUSTOMER_GPS_ERROR,
  MADIBA_STORE_LATITUDE,
  MADIBA_STORE_LONGITUDE,
  assertNotMadibaStoreCustomerLocation,
  isAtMadibaStore,
  madibaStoreLabel,
} from "../app/lib/madibaStoreLocation.js";

const STORE = {
  latitude: MADIBA_STORE_LATITUDE,
  longitude: MADIBA_STORE_LONGITUDE,
};

test("MADIBA store radius is 50 meters", () => {
  assert.equal(MADIBA_STORE_BLOCK_RADIUS_METERS, 50);
  assert.equal(isAtMadibaStore(STORE), true);
  assert.equal(isAtMadibaStore({
    latitude: STORE.latitude + 0.001,
    longitude: STORE.longitude,
  }), false);
});

test("customer pin updates inside the store radius are rejected", () => {
  assert.throws(
    () => assertNotMadibaStoreCustomerLocation(STORE),
    (error) => String(error?.message || "").includes("MADIBA store")
      && String(error?.message || "").includes("report only"),
  );
  assert.match(MADIBA_STORE_CUSTOMER_GPS_ERROR, /report only/i);
});

test("entries at the MADIBA store are always FAR", () => {
  const customerNearStore = {
    latitude: STORE.latitude + 0.0002,
    longitude: STORE.longitude,
  };
  // Saved pin can be under the normal 0.5 km FAR threshold.
  assert.ok(
    haversineUnderThreshold(STORE, customerNearStore, CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM),
  );
  assert.equal(isFarFromCustomer(STORE, customerNearStore), true);
  assert.equal(isFarFromCustomer(STORE, { latitude: null, longitude: null }), true);
  assert.equal(
    shouldMarkVisitFarFromCustomer(
      { entryLatitude: STORE.latitude, entryLongitude: STORE.longitude, meta: { gpsLocationUpdateAccepted: true } },
      false,
    ),
    true,
  );
});

test("daily visit report labels store coordinates as MADIBA store", () => {
  assert.equal(
    formatEntryCoordinates({
      entryLatitude: STORE.latitude,
      entryLongitude: STORE.longitude,
    }),
    madibaStoreLabel("en"),
  );
  assert.equal(
    formatEntryCoordinates({
      entryLatitude: 24.7136,
      entryLongitude: 46.6753,
    }),
    "24.71360, 46.67530",
  );
});

test("first-time customer GPS capture is marked for report information only", () => {
  const visit = {
    id: "visit-1",
    user_id: "salesman-1",
    customer_code: "1278",
    transaction_type: "ORDER_SUBMITTED",
    latitude: 24.7,
    longitude: 46.7,
    saved_at: "2026-10-10T08:12:00.000Z",
    meta: {},
  };
  const history = [{
    customer_code: "1278",
    latitude: 24.7,
    longitude: 46.7,
    previous_latitude: null,
    previous_longitude: null,
    source: "visit",
    updated_by: "salesman-1",
    created_at: "2026-10-10T08:11:50.000Z",
  }];

  const [marked] = markVisitsWithAcceptedGpsHistory([visit], history);
  assert.equal(marked.meta.firstCustomerGpsCaptured, true);
  assert.equal(marked.meta.gpsLocationUpdateAccepted, undefined);
});

function haversineUnderThreshold(from, to, thresholdKm) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return km <= thresholdKm;
}
