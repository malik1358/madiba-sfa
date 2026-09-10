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

test("evaluateCustomerLocationUpdatePrompt asks for a prospect with no saved GPS", async () => {
  const { evaluateCustomerLocationUpdatePrompt } = await import("../app/lib/customerLocation.js");
  const prompt = await evaluateCustomerLocationUpdatePrompt({
    customerCode: "PROSPECT-64",
    customerName: "Gana al araice",
    entryLocation: { latitude: 24.7136, longitude: 46.6753 },
    accessToken: "token",
    customer: {
      customer_code: "PROSPECT-64",
      customer_name: "Gana al araice",
      is_prospect: true,
    },
    skipReverseGeocode: true,
  });

  assert.equal(Boolean(prompt?.message), true);
  assert.match(prompt.message, /No saved location/);
});

test("shouldSkipCustomerLocationWrite covers live and offline prospect codes", async () => {
  const { shouldSkipCustomerLocationWrite } = await import("../app/lib/customerLocation.js");
  assert.equal(shouldSkipCustomerLocationWrite("PROSPECT-64", {}), true);
  assert.equal(shouldSkipCustomerLocationWrite("PROSPECT-OFF-abc", { is_prospect: true }), true);
  assert.equal(shouldSkipCustomerLocationWrite("1173C", {}), false);
});

test("evaluateCustomerLocationUpdatePrompt uses the supplied customer and skips network", async () => {
  const { evaluateCustomerLocationUpdatePrompt } = await import("../app/lib/customerLocation.js");
  const nearby = {
    customer_code: "1234",
    customer_name: "Nearby Shop",
    latitude: 24.7136,
    longitude: 46.6753,
    area: "Olaya",
  };

  const prompt = await evaluateCustomerLocationUpdatePrompt({
    customerCode: "1234",
    customerName: "Nearby Shop",
    entryLocation: { latitude: 24.7137, longitude: 46.6754 },
    accessToken: "token",
    customer: nearby,
    skipReverseGeocode: true,
  });

  assert.equal(prompt, null);
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
