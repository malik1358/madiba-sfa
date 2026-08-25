import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerGpsUpdateFromProspect,
  buildProspectNameSearchTokens,
  customerRecordMatchesCode,
  formatCustomerLookupPreview,
  prospectHasStoredLocation,
  rankProspectLinkCustomerSuggestions,
  scoreProspectCustomerNameMatch,
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

test("buildProspectNameSearchTokens drops short and common words", () => {
  assert.deepEqual(
    buildProspectNameSearchTokens("RENEWABLE TECHNOLOGY FOR TRADING EST"),
    ["RENEWABLE", "TECHNOLOGY", "TRADING"],
  );
});

test("scoreProspectCustomerNameMatch ranks similar ERP names higher", () => {
  const prospect = {
    company_name: "RENEWABLE TECHNOLOGY FOR TRADING EST",
    city: "Riyadh",
    area: "Al Aarid",
    salesman_code: "OSAMA",
  };

  const strongMatch = scoreProspectCustomerNameMatch(prospect, {
    customer_code: "1301",
    customer_name: "RENEWABLE TECHNOLOGY TRADING EST",
    city: "Riyadh",
    area: "Al Aarid",
    current_salesman_code: "OSAMA",
    latitude: null,
    longitude: null,
  });

  const weakMatch = scoreProspectCustomerNameMatch(prospect, {
    customer_code: "9999",
    customer_name: "GOLDEN TOP COMPANY",
    city: "Jeddah",
    area: "Industrial",
    current_salesman_code: "ALI",
    latitude: null,
    longitude: null,
  });

  assert.ok(strongMatch > weakMatch);
});

test("rankProspectLinkCustomerSuggestions excludes customers with GPS and returns best matches", () => {
  const suggestions = rankProspectLinkCustomerSuggestions(
    { company_name: "RENEWABLE TECHNOLOGY FOR TRADING EST" },
    [
      {
        customer_code: "1301",
        customer_name: "RENEWABLE TECHNOLOGY TRADING EST",
        latitude: null,
        longitude: null,
      },
      {
        customer_code: "1302",
        customer_name: "RENEWABLE TECHNOLOGY TRADING EST",
        latitude: 24.5,
        longitude: 46.7,
      },
      {
        customer_code: "2001",
        customer_name: "UNRELATED SHOP",
        latitude: null,
        longitude: null,
      },
    ],
    5,
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].customer_code, "1301");
});
