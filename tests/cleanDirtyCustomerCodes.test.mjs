import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirtyCodeRemapTargets,
  buildDirtyCustomerTwinMap,
  extractCleanCode,
} from "../app/lib/cleanDirtyCustomerCodes.js";

test("extractCleanCode pulls numeric/C prefix before the name", () => {
  assert.equal(extractCleanCode("1109C  Dhajja Al Tawfeer Trading Company"), "1109C");
  assert.equal(extractCleanCode("1109C"), "");
  assert.equal(extractCleanCode("Al-muntaj Al-Raqi"), "");
});

test("buildDirtyCustomerTwinMap pairs CODE  Name rows with clean CODE twins", () => {
  const twins = buildDirtyCustomerTwinMap([
    { id: 1, customer_code: "1109C", customer_name: "Dhajja", latest_transaction_date: "2026-01-01" },
    {
      id: 2,
      customer_code: "1109C  Dhajja Al Tawfeer Trading Company",
      customer_name: "1109C  Dhajja Al Tawfeer Trading Company",
      latest_transaction_date: "2026-07-29",
    },
    { id: 3, customer_code: "Al-muntaj Al-Raqi trading company", customer_name: "Al-muntaj" },
  ]);

  assert.equal(twins.length, 1);
  assert.equal(twins[0].dirtyId, 2);
  assert.equal(twins[0].cleanCode, "1109C");
  assert.equal(twins[0].cleanId, 1);
});

test("buildDirtyCodeRemapTargets remaps orphan dirty sales codes after master delete", () => {
  const remaps = buildDirtyCodeRemapTargets(
    [
      { id: 1, customer_code: "1109C", customer_name: "Dhajja", latest_transaction_date: "2026-01-01" },
      { id: 3, customer_code: "2201C", customer_name: "Other", latest_transaction_date: "2026-02-01" },
    ],
    [
      "1109C  Dhajja Al Tawfeer Trading Company",
      "2201C",
      "Al-muntaj Al-Raqi trading company",
    ],
  );

  assert.equal(remaps.length, 1);
  assert.equal(remaps[0].dirtyCode, "1109C  Dhajja Al Tawfeer Trading Company");
  assert.equal(remaps[0].cleanCode, "1109C");
  assert.equal(remaps[0].dirtyId, null);
});
