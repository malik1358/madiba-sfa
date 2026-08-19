import test from "node:test";
import assert from "node:assert/strict";

import { resolveMutualGroupCodes } from "../app/lib/mutualSalesmanGroups.js";

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
