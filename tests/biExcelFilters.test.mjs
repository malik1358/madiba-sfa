import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExcelFilterOptions,
  filterRowsByExcelFilters,
  pruneExcelFilters,
  uniqueExcelFilterOptions,
} from "../app/lib/biExcelFilters.js";

const rows = [
  { name: "Building Material", q1: "100", q2: "—" },
  { name: "Electronics", q1: "200", q2: "50" },
  { name: "Office supplies", q1: "100", q2: "—" },
];
const keys = ["name", "q1", "q2"];
const valueOf = (row, key) => row[key];

test("table filters keep only matching rows", () => {
  const visible = filterRowsByExcelFilters(rows, keys, valueOf, { q2: ["—"] });
  assert.deepEqual(visible.map((row) => row.name), ["Building Material", "Office supplies"]);
});

test("column options ignore values ruled out by other filters", () => {
  const options = buildExcelFilterOptions(rows, keys, valueOf, { q2: ["—"] });
  assert.deepEqual(options.name, ["Building Material", "Office supplies"]);
  assert.deepEqual(options.q1, ["100"]);
});

test("stale selections are pruned when options shrink", () => {
  const pruned = pruneExcelFilters({ name: ["Electronics", "Gone"] }, { name: ["Electronics"] });
  assert.deepEqual(pruned.name, ["Electronics"]);
});

test("formatted amounts sort by value, not by the thousands separator", () => {
  // Outstanding Compare Difference column: 4,749.34 must not sort before 4.11.
  assert.deepEqual(
    uniqueExcelFilterOptions(["+4,749.34", "+4.11", "+3,695.11", "+5,509.64", "+4.58", "+3,000.76"]),
    ["+4.11", "+4.58", "+3,000.76", "+3,695.11", "+4,749.34", "+5,509.64"],
  );
});

test("negative amounts sort below positives and placeholders go last", () => {
  assert.deepEqual(
    uniqueExcelFilterOptions(["+2,880", "-1,380.04", "0", "-", "+150.7"]),
    ["-1,380.04", "0", "+150.7", "+2,880", "-"],
  );
});

test("text columns keep their natural ordering", () => {
  assert.deepEqual(
    uniqueExcelFilterOptions(["Osama", "ABDALLA ANTHANATH", "Junaid", "ST107 Mr Belal", "ST106  Mr George"]),
    ["ABDALLA ANTHANATH", "Junaid", "Osama", "ST106  Mr George", "ST107 Mr Belal"],
  );
});
