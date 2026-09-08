import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesmanScopeMatchers,
  expandMutualGroupScopeIdentities,
  isSoyebProfile,
  mergeMutualGroupProfiles,
  resolveMutualGroupCodes,
  resolveSharedBookProfiles,
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

test("Abdalla can see Ahmed Nabil customers without sharing his own book back", () => {
  const ahmed = { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" };
  const abdalla = { id: "abdalla", salesman_code: "ABDALLA", salesman_name: "Abdalla Anthanath" };
  const abadallaLogin = { id: "abadalla", salesman_code: "ABADALLA", salesman_name: "Abadalla Anthanath" };
  const profiles = [ahmed, abdalla, { id: "j1", salesman_code: "JUNAID", salesman_name: "Junaid" }];

  assert.equal(resolveSharedBookProfiles(profiles, abdalla).some((row) => row.id === "nabil"), true);
  assert.equal(resolveSharedBookProfiles(profiles, abadallaLogin).some((row) => row.id === "nabil"), true);
  assert.deepEqual(resolveSharedBookProfiles(profiles, ahmed), []);
  assert.equal(expandMutualGroupScopeIdentities(profiles, abdalla).includes("AHMED NABIL"), true);
  assert.equal(mergeMutualGroupProfiles([abdalla], profiles, abdalla).some((row) => row.salesman_code === "AHMED NABIL"), true);
  assert.equal(mergeMutualGroupProfiles([ahmed], profiles, ahmed).some((row) => row.salesman_code === "ABDALLA"), false);
});

test("Moinudin and Junaid can see Mohammed Mubeen customers without sharing back or to Parvez", () => {
  const mubeen = { id: "mubeen", salesman_code: "MOHAMMED MUBEEN", salesman_name: "Mohammed Mubeen" };
  const moinudin = { id: "moinudin", salesman_code: "MOINUDIN", salesman_name: "Moinudin Khaja (MOINUDIN)" };
  const moinudinFull = { id: "moinudin-full", salesman_code: "MOINUDIN KHAJA", salesman_name: "Moinudin Khaja" };
  const junaid = { id: "j1", salesman_code: "JUNAID", salesman_name: "Junaid" };
  const parvez = { id: "p1", salesman_code: "PARVEZ", salesman_name: "Parvez (PARVEZ)" };
  const profiles = [mubeen, moinudin, junaid, parvez];

  assert.equal(resolveSharedBookProfiles(profiles, moinudin).some((row) => row.id === "mubeen"), true);
  assert.equal(resolveSharedBookProfiles(profiles, moinudinFull).some((row) => row.id === "mubeen"), true);
  assert.equal(resolveSharedBookProfiles(profiles, junaid).some((row) => row.id === "mubeen"), true);
  assert.deepEqual(resolveSharedBookProfiles(profiles, mubeen), []);
  assert.deepEqual(resolveSharedBookProfiles(profiles, parvez), []);
  assert.equal(expandMutualGroupScopeIdentities(profiles, moinudin).includes("MOHAMMED MUBEEN"), true);
  assert.equal(expandMutualGroupScopeIdentities(profiles, junaid).includes("MOHAMMED MUBEEN"), true);
  assert.equal(expandMutualGroupScopeIdentities(profiles, parvez).includes("MOHAMMED MUBEEN"), false);
  assert.equal(mergeMutualGroupProfiles([moinudin], profiles, moinudin).some((row) => row.salesman_code === "MOHAMMED MUBEEN"), true);
  assert.equal(mergeMutualGroupProfiles([junaid], profiles, junaid).some((row) => row.salesman_code === "MOHAMMED MUBEEN"), true);
  assert.equal(mergeMutualGroupProfiles([mubeen], profiles, mubeen).some((row) => row.salesman_code === "MOINUDIN"), false);
  assert.equal(mergeMutualGroupProfiles([mubeen], profiles, mubeen).some((row) => row.salesman_code === "JUNAID"), false);
});

test("isSoyebProfile matches Soyeb name, alias, and ST103 code", () => {
  assert.equal(isSoyebProfile({ salesman_name: "Soyeb", salesman_code: "SOYEB" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "Soyeb (SOYEB)", salesman_code: "ST103" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "ST103 SOYEB", salesman_code: "ST103" }), true);
  assert.equal(isSoyebProfile({ salesman_name: "Abdalla Anthanath", salesman_code: "ABDALLA" }), false);
});
