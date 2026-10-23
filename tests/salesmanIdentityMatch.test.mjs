import test from "node:test";
import assert from "node:assert/strict";
import {
  exactSalesmanCodesFromPairs,
  identitySearchPattern,
  rowMatchesSalesmanIdentity,
  valueMatchesIdentityPattern,
} from "../app/lib/salesmanIdentityMatch.js";

test("a spaced salesman name matches the stored code that uses punctuation", () => {
  const pattern = identitySearchPattern("AHMED NABIL");
  assert.equal(pattern, "AHMED%NABIL");
  assert.equal(valueMatchesIdentityPattern("AHMED.NABIL", pattern), true);
  assert.equal(valueMatchesIdentityPattern("AHMED NABIL", pattern), true);
  assert.equal(valueMatchesIdentityPattern("OTHER", pattern), false);
  assert.notEqual("AHMED NABIL", "AHMED.NABIL");
});

test("exact salesman codes come from pairs that match the old code or name pattern", () => {
  const patterns = [identitySearchPattern("AHMED NABIL")];
  const codes = exactSalesmanCodesFromPairs([
    { salesman_code: "AHMED.NABIL", salesman_name: "AHMED NABIL" },
    { salesman_code: "S1", salesman_name: "OTHER PERSON" },
    { salesman_code: "S1", salesman_name: "AHMED NABIL" },
    { salesman_code: "OTHER", salesman_name: "SOMEONE ELSE" },
  ], patterns);

  assert.deepEqual(codes, ["AHMED.NABIL", "S1"]);
  assert.equal(rowMatchesSalesmanIdentity(
    { salesman_code: "OTHER", salesman_name: "SOMEONE ELSE" },
    patterns,
  ), false);
});
