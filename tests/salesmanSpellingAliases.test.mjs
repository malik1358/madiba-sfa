import test from "node:test";
import assert from "node:assert/strict";

import {
  applySalesmanSpellingAliases,
  applySalesmanSpellingAliasesToUpper,
  canonicalizeSalesmanDisplayText,
  expandSalesmanSpellingComparableVariants,
} from "../app/lib/salesmanSpellingAliases.js";
import {
  comparableSalesmanIdentity,
  groupCollectionStaleOverdueBySalesman,
} from "../app/lib/collectionStaleOverdueEmail.js";
import { getCollectionSalesmanLabel, buildCollectionSalesmanOptions } from "../app/lib/paymentCollections.js";
import {
  identitySearchPattern,
  identitySearchPatternsFor,
  valueMatchesIdentityPattern,
} from "../app/lib/salesmanIdentityMatch.js";
import { normalizeSalesmanCode, normalizeSalesmanName } from "../app/lib/mutualSalesmanGroups.js";
import { normalizeSalesmanLetters } from "../app/lib/salesmanOrderNumber.js";
import { groupBadDebtRowsBySalesman } from "../app/lib/badDebtReportEmail.js";
import { normalizeVisitScheduleSalesmanLabel } from "../app/management/my-day/visitPriority.js";

test("Moinuddin spelling aliases collapse to Moinudin", () => {
  assert.equal(applySalesmanSpellingAliases("MOINUDDIN KHAJA"), "MOINUDIN KHAJA");
  assert.equal(applySalesmanSpellingAliasesToUpper("moinuddin.khaja"), "MOINUDIN.KHAJA");
  assert.equal(canonicalizeSalesmanDisplayText("Moinuddin Khaja"), "Moinudin Khaja");
  assert.equal(canonicalizeSalesmanDisplayText("MOINUDDIN"), "MOINUDIN");
  assert.deepEqual(
    expandSalesmanSpellingComparableVariants("MOINUDIN KHAJA").sort(),
    ["MOINUDDIN KHAJA", "MOINUDIN KHAJA"].sort(),
  );
});

test("stale overdue groups Moinuddin and Moinudin as one salesman", () => {
  assert.equal(comparableSalesmanIdentity("Moinuddin Khaja"), "MOINUDIN KHAJA");
  const groups = groupCollectionStaleOverdueBySalesman([
    {
      customer_code: "1309C",
      customer_name: "Hazzaz",
      salesman_name: "Moinuddin Khaja",
      outstanding_above_120: 1000,
      total_due_amount: 1000,
    },
    {
      customer_code: "1038",
      customer_name: "Al Ilm",
      salesman_name: "Moinudin Khaja",
      outstanding_above_120: 2000,
      total_due_amount: 2000,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].salesmanName, "Moinudin Khaja");
  assert.equal(groups[0].rows.length, 2);
});

test("collection labels and filters merge Moinuddin into Moinudin", () => {
  assert.equal(
    getCollectionSalesmanLabel({ salesman_name: "Moinuddin Khaja", salesman_code: "N/A" }),
    "Moinudin Khaja",
  );
  const options = buildCollectionSalesmanOptions([
    { salesman_name: "Moinuddin Khaja", salesman_code: "N/A" },
    { salesman_name: "Moinudin Khaja", salesman_code: "N/A" },
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].label, "Moinudin Khaja");
});

test("identity search patterns cover both Moinudin spellings", () => {
  assert.equal(identitySearchPattern("Moinuddin Khaja"), "MOINUDIN%KHAJA");
  const patterns = identitySearchPatternsFor("MOINUDIN KHAJA");
  assert.equal(patterns.includes("MOINUDIN%KHAJA"), true);
  assert.equal(patterns.includes("MOINUDDIN%KHAJA"), true);
  assert.equal(valueMatchesIdentityPattern("Moinuddin Khaja", "MOINUDIN%KHAJA"), true);
  assert.equal(valueMatchesIdentityPattern("Moinudin Khaja", "MOINUDDIN%KHAJA"), true);
});

test("shared normalizers and order letters treat Moinuddin as Moinudin", () => {
  assert.equal(normalizeSalesmanCode("MOINUDDIN KHAJA"), "MOINUDIN KHAJA");
  assert.equal(normalizeSalesmanName("Moinuddin Khaja"), "MOINUDIN KHAJA");
  assert.equal(normalizeSalesmanLetters("Moinuddin"), normalizeSalesmanLetters("Moinudin"));
  assert.equal(normalizeVisitScheduleSalesmanLabel("Moinuddin Khaja (MOINUDDIN)"), "Moinudin Khaja");
});

test("bad-debt salesman groups merge Moinuddin spelling", () => {
  const groups = groupBadDebtRowsBySalesman([
    { salesman: "Moinuddin Khaja", customerName: "A", outstandingAbove120: 100, transferredToLegal: false },
    { salesman: "Moinudin Khaja", customerName: "B", outstandingAbove120: 200, transferredToLegal: false },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].salesman, "Moinudin Khaja");
  assert.equal(groups[0].rows.length, 2);
});
