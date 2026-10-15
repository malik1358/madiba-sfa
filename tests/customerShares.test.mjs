import test from "node:test";
import assert from "node:assert/strict";

import { customerMatchesSharedCodeSet, normalizeCustomerCode } from "../app/lib/customerShares.js";
import { buildScopeHash } from "../app/lib/scopeHash.js";
import { customerMatchesCollectionScope } from "../app/lib/paymentCollections.js";

test("normalizeCustomerCode uppercases and trims", () => {
  assert.equal(normalizeCustomerCode("  a1553  "), "A1553");
});

test("customerMatchesSharedCodeSet matches shared codes only", () => {
  assert.equal(customerMatchesSharedCodeSet("1553", ["1553", "2001"]), true);
  assert.equal(customerMatchesSharedCodeSet("1553C", ["1553"]), true);
  assert.equal(customerMatchesSharedCodeSet("9999", ["1553"]), false);
  assert.equal(customerMatchesSharedCodeSet("1553", []), false);
});

test("buildScopeHash includes selective shared customer codes", () => {
  assert.equal(
    buildScopeHash({
      visibleSalesmanCodes: ["SM2", "SM1"],
      sharedCustomerCodes: ["2001", "1553"],
    }),
    "SM1|SM2#share:1553,2001",
  );
  assert.equal(
    buildScopeHash({ visibleSalesmanCodes: ["SM1"], sharedCustomerCodes: [] }),
    "SM1",
  );
});

test("customerMatchesCollectionScope allows selectively shared customers", () => {
  assert.equal(
    customerMatchesCollectionScope({
      customer: { customer_code: "1553", current_salesman_code: "OTHER" },
      customerInvoices: [],
      scopeMatchers: { codes: new Set(["VIEWER"]), comparableNames: new Set(), tokens: new Set(), looseNames: new Set() },
      normalizedScopeCodes: ["VIEWER"],
      sharedCustomerCodes: ["1553"],
      hasAllAccess: false,
    }),
    true,
  );

  assert.equal(
    customerMatchesCollectionScope({
      customer: { customer_code: "9999", current_salesman_code: "OTHER" },
      customerInvoices: [],
      scopeMatchers: { codes: new Set(["VIEWER"]), comparableNames: new Set(), tokens: new Set(), looseNames: new Set() },
      normalizedScopeCodes: ["VIEWER"],
      sharedCustomerCodes: ["1553"],
      hasAllAccess: false,
    }),
    false,
  );
});
