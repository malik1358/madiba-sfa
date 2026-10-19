import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesmanScopeMatchers,
  expandMutualGroupScopeIdentities,
  isSoyebProfile,
  mergeMutualGroupProfiles,
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

test("resolveMutualGroupCodes matches Parvez even when the profile name is not exactly PARVEZ", () => {
  const parvez = { id: "p1", salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" };
  const junaid = { id: "j1", salesman_code: "JUNAID", salesman_name: "Junaid" };
  const soyeb = { id: "s1", salesman_code: "SOYEB", salesman_name: "Soyeb" };
  const profiles = [parvez, junaid, soyeb, { id: "a1", salesman_code: "AHMED", salesman_name: "Ahmed Nabil" }];

  assert.deepEqual(resolveMutualGroupCodes(profiles, parvez).sort(), ["JUNAID", "PARVEZ", "SOYEB"].sort());
  assert.ok(expandMutualGroupScopeIdentities(profiles, parvez).includes("JUNAID"));
  assert.equal(mergeMutualGroupProfiles([parvez], profiles, parvez).some((row) => row.salesman_code === "JUNAID"), true);
});

test("Parvez scope matchers include Junaid customers assigned as JUNAID", () => {
  const parvez = { salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" };
  const junaid = { salesman_code: "JUNAID", salesman_name: "Junaid" };
  const matchers = buildSalesmanScopeMatchers([parvez, junaid]);

  assert.equal(salesmanValueMatchesScope("JUNAID", matchers), true);
  assert.equal(salesmanValueMatchesScope("Junaid", matchers), true);
});

test("isSoyebProfile matches Soyeb name, alias, and ST103 code", () => {
  assert.equal(isSoyebProfile({ salesman_name: "Soyeb", salesman_code: "SOYEB" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "Soyeb (SOYEB)", salesman_code: "ST103" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "ST103 SOYEB", salesman_code: "ST103" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "Abdalla Anthanath", salesman_code: "ABDALLA" }), false);
});
