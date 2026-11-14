import test from "node:test";
import assert from "node:assert/strict";

import { resolveCustomerAuditSalesmanFilter } from "../app/management/customer-audit/lib/helpers.js";

test("customer audit salesman filter keeps ALL and in-list picks", () => {
  assert.equal(resolveCustomerAuditSalesmanFilter("ALL", ["OSAMA"]), "ALL");
  assert.equal(resolveCustomerAuditSalesmanFilter("OSAMA", ["OSAMA", "ZIA"]), "OSAMA");
});

test("customer audit salesman filter drops stale picks missing from current results", () => {
  assert.equal(resolveCustomerAuditSalesmanFilter("AHMED NABIL", ["OSAMA"]), "ALL");
  assert.equal(resolveCustomerAuditSalesmanFilter("AHMED NABIL", []), "ALL");
  assert.equal(resolveCustomerAuditSalesmanFilter("AHMED NABIL", null), "ALL");
});
