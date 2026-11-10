import assert from "node:assert/strict";
import test from "node:test";

import { managementRoleIgnoresAuthUserListFailure } from "../app/lib/customersVisibleScope.js";

test("management roles ignore Auth listUsers failure", () => {
  assert.equal(managementRoleIgnoresAuthUserListFailure("admin"), true);
  assert.equal(managementRoleIgnoresAuthUserListFailure("report-user"), true);
  assert.equal(managementRoleIgnoresAuthUserListFailure("report_user"), true);
  assert.equal(managementRoleIgnoresAuthUserListFailure("manager"), true);
});

test("field roles still require Auth listUsers", () => {
  assert.equal(managementRoleIgnoresAuthUserListFailure("salesman"), false);
  assert.equal(managementRoleIgnoresAuthUserListFailure("product-promoter"), false);
  assert.equal(managementRoleIgnoresAuthUserListFailure("invoice-maker"), false);
  assert.equal(managementRoleIgnoresAuthUserListFailure(""), false);
});
