import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExcelFilterOptions,
  filterRowsByExcelFilters,
  pruneExcelFilters,
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
