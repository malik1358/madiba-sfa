import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesmanScopeMatchers,
  resolveMutualGroupCodes,
  salesmanValueMatchesScope,
} from "../app/lib/mutualSalesmanGroups.js";

const TEAM_PROFILES = [
  { salesman_code: "JUNAID", salesman_name: "Junaid" },
  { salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" },
  { salesman_code: "SOYEB", salesman_name: "Soyeb" },
  { salesman_code: "AHMED", salesman_name: "Ahmed Nabil" },
];

test("resolveMutualGroupCodes includes all team salesman codes for Parvez", () => {
  const codes = resolveMutualGroupCodes(TEAM_PROFILES, TEAM_PROFILES[1]);
  assert.deepEqual(codes.sort(), ["JUNAID", "PARVEZ", "SOYEB"].sort());
});

test("resolveMutualGroupCodes includes team codes for Junaid", () => {
  const codes = resolveMutualGroupCodes(TEAM_PROFILES, TEAM_PROFILES[0]);
  assert.deepEqual(codes.sort(), ["JUNAID", "PARVEZ", "SOYEB"].sort());
});

test("resolveMutualGroupCodes returns empty list for unrelated salesmen", () => {
  const codes = resolveMutualGroupCodes(TEAM_PROFILES, TEAM_PROFILES[3]);
  assert.deepEqual(codes, []);
});

test("salesmanValueMatchesScope matches teammate invoice salesman names and codes", () => {
  const matchers = buildSalesmanScopeMatchers(TEAM_PROFILES.slice(0, 3));

  assert.equal(salesmanValueMatchesScope("Junaid", matchers), true);
  assert.equal(salesmanValueMatchesScope("JUNAID", matchers), true);
  assert.equal(salesmanValueMatchesScope("Parvez (PARVEZ)", matchers), true);
  assert.equal(salesmanValueMatchesScope("PARVEZ", matchers), true);
  assert.equal(salesmanValueMatchesScope("Soyeb", matchers), true);
  assert.equal(salesmanValueMatchesScope("Ahmed Nabil", matchers), false);
});

test("buildSalesmanScopeMatchers for Parvez includes Junaid identities", () => {
  const parvezScope = buildSalesmanScopeMatchers([TEAM_PROFILES[0], TEAM_PROFILES[1]]);
  assert.equal(salesmanValueMatchesScope("Junaid", parvezScope), true);
  assert.equal(salesmanValueMatchesScope("JUNAID", parvezScope), true);
});
