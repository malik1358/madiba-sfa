import test from "node:test";
import assert from "node:assert/strict";

import {
  canStartAdminLoginAs,
  normalizeAdminLoginAsTargets,
} from "../app/lib/adminLoginAs.js";

test("admin login-as is limited to the admin role", () => {
  assert.equal(canStartAdminLoginAs("admin"), true);
  assert.equal(canStartAdminLoginAs(" ADMIN "), true);
  assert.equal(canStartAdminLoginAs("manager"), false);
  assert.equal(canStartAdminLoginAs("invoice-maker"), false);
});

test("login-as target list excludes inactive or incomplete profiles", () => {
  assert.deepEqual(normalizeAdminLoginAsTargets([
    { id: "b", salesman_name: "Zed", salesman_code: "Z", role: "salesman" },
    { id: "inactive", salesman_name: "Inactive", is_active: false },
    { salesman_name: "Missing id", role: "salesman" },
    { id: "a", salesman_name: "Ava", salesman_code: "A", role: "salesman" },
  ]), [
    { id: "a", salesmanCode: "A", salesmanName: "Ava", role: "salesman" },
    { id: "b", salesmanCode: "Z", salesmanName: "Zed", role: "salesman" },
  ]);
});