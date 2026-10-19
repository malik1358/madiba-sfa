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

test("customerHasArea requires a non-empty area value", async () => {
  const { customerHasArea } = await import("../app/lib/customerLocation.js");
  assert.equal(customerHasArea({ area: "Al Olaya" }), true);
  assert.equal(customerHasArea({ area: "  " }), false);
  assert.equal(customerHasArea({}), false);
});

test("withSalesScopeMatchers lets a team lead match subordinate customer assignments", async () => {
  const { withSalesScopeMatchers } = await import("../app/lib/customerAccess.js");
  const { customerSalesmanAssignmentMatchesScope } = await import("../app/lib/salesHierarchy.js");

  const scope = withSalesScopeMatchers({
    visibleSalesmanCodes: ["AHMED NABIL", "AHMED NABIL", "GEORGE"],
    visibleMembers: [
      { salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
      { salesman_code: "GEORGE", salesman_name: "George" },
    ],
  });

  assert.equal(customerSalesmanAssignmentMatchesScope("GEORGE", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("NABIL", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("JUNAID", scope), false);
});
