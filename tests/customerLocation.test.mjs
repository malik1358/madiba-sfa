import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
  customerHasSavedLocation,
  distanceFromCustomerKm,
  isFarFromCustomer,
} from "../app/lib/customerLocation.js";

test("distanceFromCustomerKm returns null when customer location is missing", () => {
  const distance = distanceFromCustomerKm(
    { latitude: 24.7136, longitude: 46.6753 },
    { latitude: null, longitude: null },
  );
  assert.equal(distance, null);
});

test("isFarFromCustomer flags entries beyond threshold", () => {
  const entry = { latitude: 24.7136, longitude: 46.6753 };
  const customer = { latitude: 24.7236, longitude: 46.6853 };
  assert.equal(isFarFromCustomer(entry, customer, 20), false);
  assert.equal(isFarFromCustomer(entry, customer, 0.5), true);
});

test("customerHasSavedLocation requires both coordinates", () => {
  assert.equal(customerHasSavedLocation({ latitude: 1, longitude: 2 }), true);
  assert.equal(customerHasSavedLocation({ latitude: 1 }), false);
  assert.equal(CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM, 0.5);
});
