import test from "node:test";
import assert from "node:assert/strict";

import {
  assignedSalesmanCodes,
  customerAssignmentMatchesScope,
  customerHasActiveSalesmanTransfer,
} from "../app/lib/customerSalesmanAssignment.js";
import { buildSalesmanScopeMatchers } from "../app/lib/mutualSalesmanGroups.js";
import { customerMatchesCollectionScope } from "../app/lib/paymentCollections.js";

test("assignedSalesmanCodes includes current and previous salesman", () => {
  assert.deepEqual(assignedSalesmanCodes({
    current_salesman_code: "PARVEZ",
    previous_salesman_code: "OSAMA",
  }), ["PARVEZ", "OSAMA"]);
  assert.equal(customerHasActiveSalesmanTransfer({
    current_salesman_code: "PARVEZ",
    previous_salesman_code: "OSAMA",
  }), true);
  assert.equal(customerHasActiveSalesmanTransfer({
    current_salesman_code: "PARVEZ",
    previous_salesman_code: "",
  }), false);
});

test("customerAssignmentMatchesScope is true for previous salesman after transfer", () => {
  const osama = buildSalesmanScopeMatchers([{ salesman_code: "OSAMA", salesman_name: "Osama" }]);
  const parvez = buildSalesmanScopeMatchers([{ salesman_code: "PARVEZ", salesman_name: "Parvez" }]);
  const customer = { current_salesman_code: "PARVEZ", previous_salesman_code: "OSAMA" };

  assert.equal(customerAssignmentMatchesScope(customer, osama, ["OSAMA"]), true);
  assert.equal(customerAssignmentMatchesScope(customer, parvez, ["PARVEZ"]), true);
  const nabil = buildSalesmanScopeMatchers([{ salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" }]);
  assert.equal(customerAssignmentMatchesScope(customer, nabil, ["AHMED NABIL"]), false);
});

test("transferred customer stays visible to both salesmen in collections", () => {
  const customer = {
    current_salesman_code: "PARVEZ",
    previous_salesman_code: "OSAMA",
  };
  const invoices = [{ salesman: "Osama", pending_amount: 1200 }];
  const osamaScope = buildSalesmanScopeMatchers([{ salesman_code: "OSAMA", salesman_name: "Osama" }]);
  const parvezScope = buildSalesmanScopeMatchers([{ salesman_code: "PARVEZ", salesman_name: "Parvez" }]);
  const nabilScope = buildSalesmanScopeMatchers([{ salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" }]);

  assert.equal(customerMatchesCollectionScope({
    customer,
    customerInvoices: invoices,
    scopeMatchers: osamaScope,
    normalizedScopeCodes: ["OSAMA"],
  }), true);
  assert.equal(customerMatchesCollectionScope({
    customer,
    customerInvoices: invoices,
    scopeMatchers: parvezScope,
    normalizedScopeCodes: ["PARVEZ"],
  }), true);
  assert.equal(customerMatchesCollectionScope({
    customer,
    customerInvoices: invoices,
    scopeMatchers: nabilScope,
    normalizedScopeCodes: ["AHMED NABIL"],
  }), false);
});
