import test from "node:test";
import assert from "node:assert/strict";

import { profileHasCompanyWideSalesScope } from "../app/lib/salesScopeAccess.js";

test("company-wide sales scope includes management and invoice makers", () => {
  assert.equal(profileHasCompanyWideSalesScope({ role: "admin" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "manager" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "report-user" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "report_user" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "invoice-maker" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "invoice_maker" }), true);
});

test("company-wide sales scope includes collectors so customer search is not empty", () => {
  assert.equal(profileHasCompanyWideSalesScope({ role: "collector", salesmanCode: "SM001" }), true);
  assert.equal(profileHasCompanyWideSalesScope({ role: "salesman", salesmanCode: "CL12" }), true);
  assert.equal(profileHasCompanyWideSalesScope({
    role: "salesman",
    salesmanCode: "PARVEZ",
    collectionOnlyMetadata: true,
  }), true);
});

test("ordinary salesmen stay book-scoped", () => {
  assert.equal(profileHasCompanyWideSalesScope({ role: "salesman", salesmanCode: "OSAMA" }), false);
  assert.equal(profileHasCompanyWideSalesScope({ role: "product-promoter", salesmanCode: "PP01" }), false);
});
