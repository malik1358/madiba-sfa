import test from "node:test";
import assert from "node:assert/strict";

import {
  customerSalesmanAssignmentMatchesScope,
  headSalesmanMetadataMatchesLeader,
  resolveReportingChainFromAuth,
  resolveSubordinateUserIds,
} from "../app/lib/salesHierarchy.js";
import { buildSalesmanScopeMatchers } from "../app/lib/mutualSalesmanGroups.js";

test("headSalesmanMetadataMatchesLeader matches code and name variants", () => {
  const nabil = { salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" };

  assert.equal(headSalesmanMetadataMatchesLeader({
    head_salesman_code: "AHMED NABIL",
    head_salesman_name: "Ahmed Nabil",
  }, nabil), true);

  assert.equal(headSalesmanMetadataMatchesLeader({
    head_salesman_code: "NABIL",
    head_salesman_name: "",
  }, nabil), true);

  assert.equal(headSalesmanMetadataMatchesLeader({
    head_salesman_code: "GEORGE",
    head_salesman_name: "",
  }, nabil), false);
});

test("resolveReportingChainFromAuth walks Belal to Nabil to Soyeb", () => {
  const profiles = [
    { id: "belal", salesman_code: "BELAL", salesman_name: "Belal" },
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    { id: "soyeb", salesman_code: "SOYEB", salesman_name: "Soyeb" },
  ];
  const authUsers = [
    { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
    { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
    { id: "soyeb", user_metadata: {} },
  ];

  assert.deepEqual(
    resolveReportingChainFromAuth({ actorUserId: "belal", profiles, authUsers }).map((row) => row.id),
    ["nabil", "soyeb"],
  );
  assert.deepEqual(
    resolveReportingChainFromAuth({ actorUserId: "nabil", profiles, authUsers }).map((row) => row.id),
    ["soyeb"],
  );
});

test("resolveReportingChainFromAuth stops on a cycle", () => {
  const profiles = [
    { id: "a", salesman_code: "A", salesman_name: "A" },
    { id: "b", salesman_code: "B", salesman_name: "B" },
  ];
  const authUsers = [
    { id: "a", user_metadata: { head_salesman_code: "B" } },
    { id: "b", user_metadata: { head_salesman_code: "A" } },
  ];

  assert.deepEqual(
    resolveReportingChainFromAuth({ actorUserId: "a", profiles, authUsers }).map((row) => row.id),
    ["b"],
  );
});

test("resolveSubordinateUserIds finds George under Ahmed Nabil", () => {
  const nabil = { salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" };
  const authUsers = [
    { id: "nabil-id", user_metadata: {} },
    { id: "george-id", user_metadata: { head_salesman_code: "NABIL", head_salesman_name: "Ahmed Nabil" } },
    { id: "other-id", user_metadata: { head_salesman_code: "JUNAID", head_salesman_name: "Junaid" } },
  ];

  const subordinates = resolveSubordinateUserIds(authUsers, nabil);
  assert.equal(subordinates.has("george-id"), true);
  assert.equal(subordinates.has("other-id"), false);
});

test("customerSalesmanAssignmentMatchesScope accepts subordinate salesman labels", () => {
  const scope = {
    visibleSalesmanCodes: ["AHMED NABIL", "GEORGE"],
    scopeMatchers: buildSalesmanScopeMatchers([
      { salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
      { salesman_code: "GEORGE", salesman_name: "George" },
    ]),
  };

  assert.equal(customerSalesmanAssignmentMatchesScope("GEORGE", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("George", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("JUNAID", scope), false);
});

test("customerSalesmanAssignmentMatchesScope accepts Ahmed Nabil name variants", () => {
  const scope = {
    visibleSalesmanCodes: ["AHMED NABIL"],
    scopeMatchers: buildSalesmanScopeMatchers([
      { salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    ]),
  };

  assert.equal(customerSalesmanAssignmentMatchesScope("AHMED NABIL", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("NABIL", scope), true);
  assert.equal(customerSalesmanAssignmentMatchesScope("GEORGE", scope), false);
});
