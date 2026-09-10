import test from "node:test";
import assert from "node:assert/strict";
import {
  excelFilterButtonLabel,
  filterExcelColumnOptions,
  matchesExcelColumnFilter,
  toggleExcelFilterValue,
  toggleVisibleExcelFilterValues,
} from "../app/lib/excelColumnFilter.js";

test("excel column filters match any of the selected values", () => {
  assert.equal(matchesExcelColumnFilter("Parvez", []), true);
  assert.equal(matchesExcelColumnFilter("Parvez", ["Parvez", "Belal"]), true);
  assert.equal(matchesExcelColumnFilter("Osama", ["Parvez", "Belal"]), false);
});

test("typing narrows the option list and toggling keeps multiple values", () => {
  assert.deepEqual(
    filterExcelColumnOptions(["01/09/2026, 09:40", "02/09/2026, 13:14", "03/09/2026, 09:27"], "01/09"),
    ["01/09/2026, 09:40"],
  );
  assert.deepEqual(toggleExcelFilterValue(["Parvez"], "Belal"), ["Parvez", "Belal"]);
  assert.deepEqual(toggleExcelFilterValue(["Parvez", "Belal"], "parvez"), ["Belal"]);
});

test("select all applies only to the visible typed options", () => {
  const visible = ["01/09/2026, 09:40", "01/09/2026, 10:02"];
  assert.deepEqual(toggleVisibleExcelFilterValues([], visible), visible);
  assert.deepEqual(toggleVisibleExcelFilterValues(visible, visible), []);
  assert.equal(excelFilterButtonLabel([]), "All");
  assert.equal(excelFilterButtonLabel(["Parvez", "Belal"]), "2 selected");
});
