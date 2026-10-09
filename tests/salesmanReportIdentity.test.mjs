import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeReportSalesmanCode,
  normalizeReportSalesmanName,
  reportSalesmanCodeAliases,
  reportSalesmanLabel,
} from "../app/lib/salesmanReportIdentity.js";

test("Thamer legacy names and code resolve to one report identity", () => {
  for (const value of ["Thamer", "THAMER", "Thamer (SM002)", "THAMER MOHAMMAD AHMED QASEM"]) {
    assert.equal(normalizeReportSalesmanCode(value), "SM002");
    assert.equal(normalizeReportSalesmanName(value), "Thamer");
  }

  assert.deepEqual(reportSalesmanCodeAliases("SM002"), [
    "SM002",
    "THAMER",
    "THAMER MOHAMMAD AHMED QASEM",
  ]);
  assert.equal(reportSalesmanLabel({ salesman_name: "THAMER", salesman_code: "THAMER" }), "Thamer · SM002");
  assert.equal(
    reportSalesmanLabel({ salesman_name: "THAMER MOHAMMAD AHMED QASEM", salesman_code: "THAMER MOHAMMAD AHMED QASEM" }),
    "Thamer · SM002",
  );
});

test("report identity normalization preserves unrelated salesman identities", () => {
  assert.equal(normalizeReportSalesmanCode("SM003"), "SM003");
  assert.equal(normalizeReportSalesmanName("Thomas"), "Thomas");
  assert.equal(reportSalesmanLabel({ salesman_name: "Thomas", salesman_code: "SM003" }), "Thomas · SM003");
});