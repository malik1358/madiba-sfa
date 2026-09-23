import test from "node:test";
import assert from "node:assert/strict";

import {
  formatSalesmanOrderNumber,
  isSalesmanOrderNumber,
  isSalesmanOrderNumberForCode,
  maxSequenceFromOrderNumbers,
  nextSalesmanOrderSequence,
  normalizeSalesmanOrderPrefix,
  parseSalesmanOrderNumber,
} from "../app/lib/salesmanOrderNumber.js";

test("normalizeSalesmanOrderPrefix strips spaces and symbols", () => {
  assert.equal(normalizeSalesmanOrderPrefix("Ahmed Nabil"), "AHMEDNABIL");
  assert.equal(normalizeSalesmanOrderPrefix("  parvez  "), "PARVEZ");
  assert.equal(normalizeSalesmanOrderPrefix("AR"), "AR");
});

test("format and parse salesman order numbers", () => {
  assert.equal(formatSalesmanOrderNumber("PARVEZ", 42), "PARVEZ-0042");
  assert.deepEqual(parseSalesmanOrderNumber("parvez-42"), {
    prefix: "PARVEZ",
    sequence: 42,
    orderNumber: "PARVEZ-0042",
  });
  assert.equal(isSalesmanOrderNumber("PARVEZ-0042"), true);
  assert.equal(isSalesmanOrderNumberForCode("PARVEZ-0042", "Parvez"), true);
  assert.equal(isSalesmanOrderNumberForCode("PARVEZ-0042", "JUNAID"), false);
  assert.equal(isSalesmanOrderNumber("pending:abc"), false);
});

test("next sequence and max from lists are salesman scoped", () => {
  assert.equal(nextSalesmanOrderSequence(0), 1);
  assert.equal(nextSalesmanOrderSequence(9), 10);
  assert.equal(
    maxSequenceFromOrderNumbers(["PARVEZ-0007", "JUNAID-0099", "PARVEZ-0012", "296"], "PARVEZ"),
    12,
  );
});
