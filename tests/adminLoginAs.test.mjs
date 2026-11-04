import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdminLoginAsReturnContext,
  canStartAdminLoginAs,
  isActiveAdminLoginAsContext,
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

test("login-as return context is active only while Auth user is the target", () => {
  const saved = buildAdminLoginAsReturnContext({
    adminSession: { access_token: "admin-access", refresh_token: "admin-refresh" },
    targetId: "22c23484-4bb5-413d-9038-77690b334629",
    targetName: "AHMED NABIL",
  });
  assert.equal(saved.targetId, "22c23484-4bb5-413d-9038-77690b334629");
  assert.equal(isActiveAdminLoginAsContext(saved, "22c23484-4bb5-413d-9038-77690b334629"), true);
  assert.equal(isActiveAdminLoginAsContext(saved, "ee9cd6a1-1a3d-459e-9990-ce5ee439b0b5"), false);
  assert.equal(isActiveAdminLoginAsContext({
    session: { access_token: "x", refresh_token: "y" },
    targetName: "AHMED NABIL",
  }, "22c23484-4bb5-413d-9038-77690b334629"), false);
});