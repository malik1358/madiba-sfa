import test from "node:test";
import assert from "node:assert/strict";
import {
  excelFilterButtonLabel,
  excelFilterStateIsActive,
  filterExcelColumnOptions,
  matchesExcelColumnFilter,
  normalizeExcelFilterState,
  pruneExcelFilterSelection,
  rowMatchesOtherExcelFilters,
  setExcelFilterExcludeContains,
  toggleExcelFilterValue,
  toggleVisibleExcelFilterValues,
} from "../app/lib/excelColumnFilter.js";

test("excel column filters match any of the selected values", () => {
  assert.equal(matchesExcelColumnFilter("Parvez", []), true);
  assert.equal(matchesExcelColumnFilter("Parvez", ["Parvez", "Belal"]), true);
  assert.equal(matchesExcelColumnFilter("Osama", ["Parvez", "Belal"]), false);
});

test("does-not-contain excludes matching cell text while keeping others", () => {
  assert.equal(matchesExcelColumnFilter("1054C Legal", { excludeContains: "Legal" }), false);
  assert.equal(matchesExcelColumnFilter("1136C", { excludeContains: "Legal" }), true);
  assert.equal(matchesExcelColumnFilter("1054C Legal", {
    selected: ["1054C Legal", "1136C"],
    excludeContains: "Legal",
  }), false);
  assert.equal(matchesExcelColumnFilter("1136C", {
    selected: ["1054C Legal", "1136C"],
    excludeContains: "Legal",
  }), true);
  assert.equal(excelFilterStateIsActive({ excludeContains: "Legal" }), true);
  assert.equal(excelFilterButtonLabel({ excludeContains: "Legal" }), "≠ Legal");
  assert.equal(
    excelFilterButtonLabel({ selected: ["Parvez", "Belal"], excludeContains: "Legal" }),
    "2 selected · ≠ Legal",
  );
});

test("typing narrows the option list and toggling keeps multiple values", () => {
  assert.deepEqual(
    filterExcelColumnOptions(["01/09/2026, 09:40", "02/09/2026, 13:14", "03/09/2026, 09:27"], "01/09"),
    ["01/09/2026, 09:40"],
  );
  assert.deepEqual(toggleExcelFilterValue(["Parvez"], "Belal"), {
    selected: ["Parvez", "Belal"],
    excludeContains: "",
  });
  assert.deepEqual(toggleExcelFilterValue(["Parvez", "Belal"], "parvez"), {
    selected: ["Belal"],
    excludeContains: "",
  });
  assert.deepEqual(
    toggleExcelFilterValue({ selected: ["Parvez"], excludeContains: "Legal" }, "Belal"),
    { selected: ["Parvez", "Belal"], excludeContains: "Legal" },
  );
});

test("select all applies only to the visible typed options", () => {
  const visible = ["01/09/2026, 09:40", "01/09/2026, 10:02"];
  assert.deepEqual(toggleVisibleExcelFilterValues([], visible), {
    selected: visible,
    excludeContains: "",
  });
  assert.deepEqual(toggleVisibleExcelFilterValues(visible, visible), {
    selected: [],
    excludeContains: "",
  });
  assert.equal(excelFilterButtonLabel([]), "All");
  assert.equal(excelFilterButtonLabel(["Parvez", "Belal"]), "2 selected");
});

test("prune removes selections that are no longer in the dataset but keeps exclude text", () => {
  assert.deepEqual(
    pruneExcelFilterSelection(["Parvez", "Belal", "Osama"], ["Belal"]),
    { selected: ["Belal"], excludeContains: "" },
  );
  assert.deepEqual(
    pruneExcelFilterSelection(["Parvez", "Osama"], ["Trusted Car Company"]),
    { selected: [], excludeContains: "" },
  );
  assert.deepEqual(
    pruneExcelFilterSelection({ selected: ["Parvez", "Gone"], excludeContains: "Legal" }, ["Parvez"]),
    { selected: ["Parvez"], excludeContains: "Legal" },
  );
  assert.deepEqual(
    setExcelFilterExcludeContains(["Parvez"], " legal "),
    { selected: ["Parvez"], excludeContains: "legal" },
  );
  assert.deepEqual(normalizeExcelFilterState(["Parvez"]), {
    selected: ["Parvez"],
    excludeContains: "",
  });
  assert.equal(
    rowMatchesOtherExcelFilters(
      { customer: "Trusted Car Company", status: "SUBMITTED" },
      { customer: ["Parvez"], status: ["SUBMITTED"] },
      "customer",
      ["customer", "status"],
      matchesExcelColumnFilter,
    ),
    true,
  );
});
