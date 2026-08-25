import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerGpsUpdateFromProspect,
  customerRecordMatchesCode,
  formatCustomerLookupPreview,
  prospectHasStoredLocation,
} from "../app/lib/prospectCustomerLink.js";

test("prospectHasStoredLocation accepts valid prospect coordinates", () => {
  assert.equal(prospectHasStoredLocation({ latitude: 24.5, longitude: 46.7 }), true);
  assert.equal(prospectHasStoredLocation({ latitude: 0, longitude: 46.7 }), false);
});

test("buildCustomerGpsUpdateFromProspect copies GPS when customer is missing location", () => {
  const update = buildCustomerGpsUpdateFromProspect(
    { latitude: 24.5683, longitude: 46.7407, city: "Riyadh", area: "Al Aarid" },
    { customer_code: "1301", latitude: null, longitude: null },
  );

  assert.deepEqual(update, {
    latitude: 24.5683,
    longitude: 46.7407,
    city: "Riyadh",
    area: "Al Aarid",
    updated_at: update.updated_at,
  });
});

test("buildCustomerGpsUpdateFromProspect skips copy when customer already has GPS", () => {
  const update = buildCustomerGpsUpdateFromProspect(
    { latitude: 24.5683, longitude: 46.7407 },
    { customer_code: "1301", latitude: 24.1, longitude: 46.2 },
  );

  assert.equal(update, null);
});

test("buildCustomerGpsUpdateFromProspect can overwrite existing customer GPS", () => {
  const update = buildCustomerGpsUpdateFromProspect(
    { latitude: 24.5683, longitude: 46.7407 },
    { customer_code: "1301", latitude: 24.1, longitude: 46.2 },
    { overwriteCustomerGps: true },
  );

  assert.equal(update.latitude, 24.5683);
  assert.equal(update.longitude, 46.7407);
});

test("customerRecordMatchesCode resolves ERP code from combined customer name", () => {
  const row = {
    customer_code: "",
    customer_name: "1301 AL TAWFEER TRADING COMPANY",
  };

  assert.equal(customerRecordMatchesCode(row, "1301"), true);
  assert.equal(customerRecordMatchesCode(row, "1302"), false);
});

test("formatCustomerLookupPreview returns cleaned ERP code and name", () => {
  const preview = formatCustomerLookupPreview({
    customer_code: "1301 AL TAWFEER TRADING COMPANY",
    customer_name: "1301 AL TAWFEER TRADING COMPANY",
  });

  assert.equal(preview.customer_code, "1301");
  assert.equal(preview.customer_name, "AL TAWFEER TRADING COMPANY");
});
