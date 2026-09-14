import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
  customerHasSavedLocation,
  distanceFromCustomerKm,
  isFarFromCustomer,
} from "../app/lib/customerLocation.js";

test("customerWithUpdatedLocation replaces GPS used for distance-from-customer", async () => {
  const { customerWithUpdatedLocation, distanceFromCustomerKm } = await import("../app/lib/customerLocation.js");
  const entry = { latitude: 26.437766, longitude: 50.102296 };
  const customer = {
    customer_code: "1183",
    customer_name: "Masco Saudi Trading Company",
    latitude: 26.25,
    longitude: 50.0,
  };

  const before = distanceFromCustomerKm(entry, customer);
  assert.ok(before > 1);

  const updated = customerWithUpdatedLocation(customer, {
    latitude: entry.latitude,
    longitude: entry.longitude,
  });
  const after = distanceFromCustomerKm(entry, updated);
  assert.ok(after !== null && after < 0.01);
  // Original customer object stays unchanged.
  assert.equal(customer.latitude, 26.25);
  assert.equal(customer.longitude, 50.0);
});

test("maybePromptCustomerLocationUpdate syncs in-memory customer GPS when accepted", async () => {
  const originalFetch = globalThis.fetch;
  const customer = {
    customer_code: "1183",
    customer_name: "Masco Saudi Trading Company",
    latitude: 26.25,
    longitude: 50.0,
    area: "Dammam",
  };
  const entry = { latitude: 26.437766, longitude: 50.102296 };

  globalThis.fetch = async (url, options = {}) => {
    if (String(options.method || "GET").toUpperCase() === "PATCH") {
      return {
        ok: true,
        json: async () => ({
          success: true,
          customer: {
            ...customer,
            latitude: entry.latitude,
            longitude: entry.longitude,
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const {
      CUSTOMER_LOCATION_UPDATE_UPDATE,
      distanceFromCustomerKm,
      maybePromptCustomerLocationUpdate,
    } = await import("../app/lib/customerLocation.js");

    const choice = await maybePromptCustomerLocationUpdate({
      customerCode: "1183",
      customerName: "Masco Saudi Trading Company",
      entryLocation: entry,
      accessToken: "token",
      customer,
      skipReverseGeocode: true,
      promptChoice: async () => CUSTOMER_LOCATION_UPDATE_UPDATE,
    });

    assert.equal(choice, CUSTOMER_LOCATION_UPDATE_UPDATE);
    assert.equal(customer.latitude, entry.latitude);
    assert.equal(customer.longitude, entry.longitude);
    assert.ok(distanceFromCustomerKm(entry, customer) < 0.01);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("fetchCustomerLocation soft-fails on aborted requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("signal is aborted without reason");
    error.name = "AbortError";
    throw error;
  };

  try {
    const { fetchCustomerLocation } = await import("../app/lib/customerLocation.js");
    const customer = await fetchCustomerLocation("token", "1234");
    assert.equal(customer, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchCustomerLocation returns null when offline network fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    const { fetchCustomerLocation } = await import("../app/lib/customerLocation.js");
    const result = await fetchCustomerLocation("token", "1234");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("evaluateCustomerLocationUpdatePrompt survives offline geocode failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator || {}, "onLine");
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: false },
    configurable: true,
  });

  try {
    const { evaluateCustomerLocationUpdatePrompt } = await import("../app/lib/customerLocation.js");
    const prompt = await evaluateCustomerLocationUpdatePrompt({
      customerCode: "1234",
      customerName: "Far Shop",
      entryLocation: { latitude: 24.8, longitude: 46.8 },
      accessToken: "token",
      customer: {
        customer_code: "1234",
        customer_name: "Far Shop",
        latitude: 24.7136,
        longitude: 46.6753,
        area: "",
      },
    });
    assert.equal(Boolean(prompt?.message), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOnLine) {
      Object.defineProperty(globalThis.navigator, "onLine", originalOnLine);
    }
  }
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
