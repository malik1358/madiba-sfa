import test from "node:test";
import assert from "node:assert/strict";
import {
  columnFiltersAreActive,
  rowTextsMatchColumnFilters,
  shouldShowTableRowGroup,
  syncStackedHeaderSticky,
  textMatchesColumnFilter,
} from "../app/lib/tableColumnFilter.js";

test("column filters match case-insensitively and ignore extra spaces", () => {
  assert.equal(textMatchesColumnFilter("Parvez Khan", "parvez"), true);
  assert.equal(textMatchesColumnFilter("Daily Visit", "  VISIT "), true);
  assert.equal(textMatchesColumnFilter("Junaid", "parvez"), false);
  assert.equal(textMatchesColumnFilter("Anything", ""), true);
});

test("row texts honor each column filter independently", () => {
  const row = ["C-100", "Al Madina", "Parvez", "120.50"];
  assert.equal(rowTextsMatchColumnFilters(row, ["c-1", "madina", "", "120"]), true);
  assert.equal(rowTextsMatchColumnFilters(row, ["c-1", "madina", "zia", ""]), false);
  assert.equal(rowTextsMatchColumnFilters(row, ["", "", "", ""]), true);
  assert.equal(columnFiltersAreActive(["", "  "]), false);
});

test("stacked header sticky helper ignores tables without two header rows", () => {
  assert.equal(syncStackedHeaderSticky(null), false);
});

test("stacked header sticky helper records the first header row height", () => {
  const table = {
    classList: {
      added: [],
      removed: [],
      add(name) { this.added.push(name); },
      remove(name) { this.removed.push(name); },
    },
    style: {
      values: {},
      setProperty(name, value) { this.values[name] = value; },
      removeProperty(name) { delete this.values[name]; },
    },
    querySelector(selector) {
      if (selector === ":scope > thead > tr") {
        return { getBoundingClientRect: () => ({ height: 41.2 }) };
      }
      if (selector === ":scope > thead > tr:nth-child(2)") {
        return {};
      }
      return null;
    },
  };

  assert.equal(syncStackedHeaderSticky(table), true);
  assert.deepEqual(table.classList.added, ["moduleStackedHeaderTable"]);
  assert.equal(table.style.values["--module-stacked-header-row1"], "42px");
});

test("placeholder detail rows hide only while a column filter is active", () => {
  const placeholder = { cellTexts: ["No entries"], cellCount: 1, firstColSpan: 8 };
  assert.equal(shouldShowTableRowGroup(placeholder, [""]), true);
  assert.equal(shouldShowTableRowGroup(placeholder, ["parvez"]), false);
  assert.equal(shouldShowTableRowGroup({ cellTexts: ["Parvez"], cellCount: 4, firstColSpan: 1 }, ["parvez"]), true);
});
