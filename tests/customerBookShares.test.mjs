import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultSharePairs,
  resolveSharedBookProfilesFromRows,
} from "../app/lib/customerBookShares.js";
import {
  expandMutualGroupScopeIdentities,
  mergeMutualGroupProfiles,
} from "../app/lib/mutualSalesmanGroups.js";

test("resolveSharedBookProfilesFromRows is one-way by profile id", () => {
  const mubeen = { id: "mubeen", salesman_code: "MOHAMMED MUBEEN", salesman_name: "Mohammed Mubeen" };
  const moinudin = { id: "moinudin", salesman_code: "MOINUDIN", salesman_name: "Moinudin Khaja" };
  const junaid = { id: "junaid", salesman_code: "JUNAID", salesman_name: "Junaid" };
  const profiles = [mubeen, moinudin, junaid];
  const shareRows = [
    { source_salesman_id: "mubeen", viewer_salesman_id: "moinudin", is_active: true },
    { source_salesman_id: "mubeen", viewer_salesman_id: "junaid", is_active: true },
  ];

  assert.equal(resolveSharedBookProfilesFromRows(profiles, moinudin, shareRows).some((row) => row.id === "mubeen"), true);
  assert.equal(resolveSharedBookProfilesFromRows(profiles, junaid, shareRows).some((row) => row.id === "mubeen"), true);
  assert.deepEqual(resolveSharedBookProfilesFromRows(profiles, mubeen, shareRows), []);
  assert.equal(expandMutualGroupScopeIdentities(profiles, moinudin, { shareRows }).includes("MOHAMMED MUBEEN"), true);
  assert.equal(mergeMutualGroupProfiles([moinudin], profiles, moinudin, { shareRows }).some((row) => row.id === "mubeen"), true);
  assert.equal(mergeMutualGroupProfiles([mubeen], profiles, mubeen, { shareRows }).some((row) => row.id === "moinudin"), false);
});

test("inactive share rows are ignored", () => {
  const source = { id: "s1", salesman_code: "A", salesman_name: "A" };
  const viewer = { id: "v1", salesman_code: "B", salesman_name: "B" };
  const rows = [{ source_salesman_id: "s1", viewer_salesman_id: "v1", is_active: false }];
  assert.deepEqual(resolveSharedBookProfilesFromRows([source, viewer], viewer, rows), []);
});

test("buildDefaultSharePairs materializes hardcoded books when profiles exist", () => {
  const profiles = [
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    { id: "abdalla", salesman_code: "ABDALLA", salesman_name: "Abdalla Anthanath" },
    { id: "mubeen", salesman_code: "MOHAMMED MUBEEN", salesman_name: "Mohammed Mubeen" },
    { id: "moinudin", salesman_code: "MOINUDIN", salesman_name: "Moinudin Khaja (MOINUDIN)" },
    { id: "junaid", salesman_code: "JUNAID", salesman_name: "Junaid" },
  ];

  const pairs = buildDefaultSharePairs(profiles);
  const keys = pairs.map((pair) => `${pair.source_salesman_id}->${pair.viewer_salesman_id}`).sort();

  assert.ok(keys.includes("nabil->abdalla"));
  assert.ok(keys.includes("mubeen->moinudin"));
  assert.ok(keys.includes("mubeen->junaid"));
  assert.equal(keys.includes("abdalla->nabil"), false);
});
