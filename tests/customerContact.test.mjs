import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_MOBILE_REQUIRED_ERROR,
  customerHasMobile,
  findCustomersByNormalizedMobile,
  formatExistingCustomerDuplicateMessage,
  formatMissingCustomerMobilePrompt,
  isValidKsaMobile,
  mobileLookupVariants,
  mobilesMatch,
  normalizeKsaMobile,
  promptCustomerMobileUpdateIfMissing,
} from "../app/lib/customerContact.js";

test("normalizeKsaMobile accepts local, national, and international formats", () => {
  assert.equal(normalizeKsaMobile("0551234567"), "0551234567");
  assert.equal(normalizeKsaMobile("551234567"), "0551234567");
  assert.equal(normalizeKsaMobile("+966 55 123 4567"), "0551234567");
  assert.equal(normalizeKsaMobile("00966551234567"), "0551234567");
  assert.equal(isValidKsaMobile("0551234567"), true);
  assert.equal(isValidKsaMobile("051234567"), false);
});

test("findCustomersByNormalizedMobile matches equivalent phone formats", () => {
  const customers = [
    { customer_code: "1301", customer_name: "AL TAWFEER", mobile: "+966551234567" },
    { customer_code: "1400", customer_name: "OTHER", mobile: "0501112233" },
  ];

  const matches = findCustomersByNormalizedMobile(customers, "0551234567");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].customer_code, "1301");
  assert.equal(mobilesMatch("966551234567", "0551234567"), true);
  assert.equal(customerHasMobile({ mobile: "" }), false);
  assert.deepEqual(mobileLookupVariants("0551234567"), [
    "0551234567",
    "551234567",
    "966551234567",
    "+966551234567",
    "00966551234567",
  ]);
});

test("formatExistingCustomerDuplicateMessage includes customer code and name", () => {
  const message = formatExistingCustomerDuplicateMessage({
    customer: { customer_code: "1301", customer_name: "AL TAWFEER TRADING", current_salesman_code: "AHMED" },
  });

  assert.match(message, /1301/);
  assert.match(message, /AL TAWFEER TRADING/);
  assert.match(message, /AHMED/);
});

test("promptCustomerMobileUpdateIfMissing skips customers that already have a phone", async () => {
  const customer = { customer_code: "1301", customer_name: "Shop", mobile: "0551234567" };
  const result = await promptCustomerMobileUpdateIfMissing({
    customer,
    promptFn: () => {
      throw new Error("should not prompt");
    },
  });
  assert.equal(result.mobile, "0551234567");
});

test("promptCustomerMobileUpdateIfMissing requires a number when missing", async () => {
  await assert.rejects(
    () => promptCustomerMobileUpdateIfMissing({
      customer: { customer_code: "1301", customer_name: "Shop", mobile: "" },
      promptFn: () => null,
    }),
    { message: CUSTOMER_MOBILE_REQUIRED_ERROR },
  );
});

test("promptCustomerMobileUpdateIfMissing writes a valid number onto the customer", async () => {
  const customer = { customer_code: "1301", customer_name: "Shop", mobile: "" };
  const result = await promptCustomerMobileUpdateIfMissing({
    customer,
    promptFn: () => "0559988776",
  });
  assert.equal(result.mobile, "0559988776");
  assert.equal(customer.mobile, "0559988776");
});

test("formatMissingCustomerMobilePrompt names the customer", () => {
  const message = formatMissingCustomerMobilePrompt({
    customerCode: "1301",
    customerName: "AL TAWFEER",
  });
  assert.match(message, /AL TAWFEER/);
  assert.match(message, /1301/);
  assert.match(message, /05xxxxxxxx/);
});
