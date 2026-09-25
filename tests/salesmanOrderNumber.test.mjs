import test from "node:test";
import assert from "node:assert/strict";

import {
  formatSalesmanOrderNumber,
  isSalesmanOrderNumber,
  isSalesmanOrderNumberForCode,
  maxSequenceFromOrderNumbers,
  nextSalesmanOrderSequence,
  normalizeSalesmanLetters,
  parseSalesmanOrderNumber,
  resolveSalesmanOrderPrefix,
} from "../app/lib/salesmanOrderNumber.js";

test("normalizeSalesmanLetters strips spaces and symbols", () => {
  assert.equal(normalizeSalesmanLetters("Ahmed Nabil"), "AHMEDNABIL");
  assert.equal(normalizeSalesmanLetters("  parvez  "), "PARVEZ");
  assert.equal(normalizeSalesmanLetters("AR"), "AR");
});

test("resolveSalesmanOrderPrefix uses 1 letter when first letter is unique", () => {
  assert.equal(
    resolveSalesmanOrderPrefix("PARVEZ", ["JUNAID", "SOYEB", "AR"]),
    "P",
  );
  assert.equal(formatSalesmanOrderNumber("PARVEZ", 1, { peerCodes: ["JUNAID", "SOYEB"] }), "P01");
});

test("resolveSalesmanOrderPrefix uses 2 letters when first letter collides", () => {
  assert.equal(
    resolveSalesmanOrderPrefix("PARVEZ", ["PARVEZ", "PRASHANT", "JUNAID"]),
    "PA",
  );
  assert.equal(
    resolveSalesmanOrderPrefix("PRASHANT", ["PARVEZ", "PRASHANT", "JUNAID"]),
    "PR",
  );
  assert.equal(
    formatSalesmanOrderNumber("PARVEZ", 3, { peerCodes: ["PARVEZ", "PRASHANT"] }),
    "PA03",
  );
});

test("format and parse short salesman order numbers", () => {
  assert.equal(formatSalesmanOrderNumber("PARVEZ", 42, { prefix: "P" }), "P42");
  assert.deepEqual(parseSalesmanOrderNumber("p01"), {
    prefix: "P",
    sequence: 1,
    orderNumber: "P01",
  });
  assert.deepEqual(parseSalesmanOrderNumber("PA03"), {
    prefix: "PA",
    sequence: 3,
    orderNumber: "PA03",
  });
  assert.equal(isSalesmanOrderNumber("P01"), true);
  assert.equal(isSalesmanOrderNumberForCode("P01", "Parvez"), true);
  assert.equal(isSalesmanOrderNumberForCode("PA03", "Parvez"), true);
  assert.equal(isSalesmanOrderNumberForCode("P01", "JUNAID"), false);
  assert.equal(isSalesmanOrderNumber("pending:abc"), false);
});

test("legacy hyphen order numbers still parse", () => {
  assert.deepEqual(parseSalesmanOrderNumber("parvez-42"), {
    prefix: "PARVEZ",
    sequence: 42,
    orderNumber: "PARVEZ-0042",
  });
  assert.equal(isSalesmanOrderNumberForCode("PARVEZ-0042", "Parvez"), true);
});

test("next sequence and max from lists use the short prefix", () => {
  assert.equal(nextSalesmanOrderSequence(0), 1);
  assert.equal(nextSalesmanOrderSequence(9), 10);
  assert.equal(
    maxSequenceFromOrderNumbers(
      ["P07", "J09", "P12", "PA03", "296"],
      "PARVEZ",
      ["PARVEZ", "JUNAID", "SOYEB"],
    ),
    12,
  );
  assert.equal(
    maxSequenceFromOrderNumbers(
      ["PA07", "PR09", "PA12", "P99"],
      "PARVEZ",
      ["PARVEZ", "PRASHANT"],
    ),
    12,
  );
});
