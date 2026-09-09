import test from "node:test";
import assert from "node:assert/strict";

import {
  customerSalesmanAssignmentMatchesScope,
  findHeadProfile,
  headSalesmanMetadataMatchesLeader,
  resolveReportingChain,
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

test("findHeadProfile returns the direct boss for a salesman", () => {
  const profiles = [
    { id: "george", salesman_code: "GEORGE", salesman_name: "George" },
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    { id: "soyeb", salesman_code: "SOYEB", salesman_name: "Soyeb" },
  ];

  const head = findHeadProfile({ head_salesman_code: "AHMED NABIL" }, profiles);
  assert.equal(head?.id, "nabil");
  assert.equal(head?.salesman_name, "Ahmed Nabil");
  assert.equal(findHeadProfile({}, profiles), null);
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

test("resolveSubordinateUserIds walks nested subordinates for bosses", () => {
  const soyeb = { id: "soyeb", salesman_code: "SOYEB", salesman_name: "Soyeb" };
  const profiles = [
    soyeb,
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    { id: "george", salesman_code: "GEORGE", salesman_name: "George" },
  ];
  const authUsers = [
    { id: "soyeb", user_metadata: {} },
    { id: "nabil", user_metadata: { head_salesman_code: "SOYEB", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" } },
    { id: "george", user_metadata: { head_salesman_code: "AHMED NABIL", salesman_code: "GEORGE", salesman_name: "George" } },
  ];

  const subordinates = resolveSubordinateUserIds(authUsers, soyeb, profiles);
  assert.equal(subordinates.has("nabil"), true);
  assert.equal(subordinates.has("george"), true);
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

test("resolveReportingChain walks bosses by head_salesman_code", async () => {
  const admin = {
    from() {
      return {
        select() {
          return {
            order() {
              return Promise.resolve({
                data: [
                  { id: "nabil-id", salesman_code: "NABIL", salesman_name: "Ahmed Nabil", role: "manager", email: "nabil@madiba.com" },
                  { id: "gm-id", salesman_code: "GM", salesman_name: "General Manager", role: "admin", email: "gm@madiba.com" },
                  { id: "george-id", salesman_code: "GEORGE", salesman_name: "George", role: "salesman", email: "george@madiba.com" },
                ],
                error: null,
              });
            },
          };
        },
      };
    },
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: "george-id", user_metadata: { head_salesman_code: "NABIL" } },
              { id: "nabil-id", user_metadata: { head_salesman_code: "GM" } },
              { id: "gm-id", user_metadata: {} },
            ],
          },
          error: null,
        }),
      },
    },
  };

  const chain = await resolveReportingChain(admin, "george-id");
  assert.deepEqual(chain.map((boss) => boss.id), ["nabil-id", "gm-id"]);
  assert.equal(chain[0].email, "nabil@madiba.com");
});
