import test from "node:test";
import assert from "node:assert/strict";

import {
  customerSalesmanAssignmentMatchesScope,
  headSalesmanMetadataMatchesLeader,
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
