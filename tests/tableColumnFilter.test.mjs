import test from "node:test";
import assert from "node:assert/strict";
import {
  columnFiltersAreActive,
  rowTextsMatchColumnFilters,
  sortTableRowGroups,
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

test("column filters support ! prefix for does-not-contain", () => {
  assert.equal(textMatchesColumnFilter("1054C Legal", "!Legal"), false);
  assert.equal(textMatchesColumnFilter("1136C", "!Legal"), true);
  assert.equal(textMatchesColumnFilter("1054C Legal", "!  legal "), false);
  assert.equal(textMatchesColumnFilter("Anything", "!"), true);
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

function makeHeaderRow({ filterRow = false, height = 41.2 } = {}) {
  return {
    classList: {
      contains(name) {
        return filterRow && name === "moduleTableColumnFilterRow";
      },
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { height };
    },
  };
}

test("stacked header sticky helper records the first header row height", () => {
  const firstRow = makeHeaderRow();
  const secondRow = makeHeaderRow({ height: 30 });
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
    querySelectorAll(selector) {
      if (selector === ":scope > thead > tr") return [firstRow, secondRow];
      return [];
    },
  };

  assert.equal(syncStackedHeaderSticky(table), true);
  assert.deepEqual(table.classList.added, ["moduleStackedHeaderTable"]);
  assert.equal(table.style.values["--module-stacked-header-row1"], "42px");
});

test("stacked header sticky helper treats an injected filter row as the second header", () => {
  const firstRow = makeHeaderRow();
  const filterRow = makeHeaderRow({ filterRow: true, height: 34 });
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
    querySelectorAll(selector) {
      if (selector === ":scope > thead > tr") return [firstRow, filterRow];
      return [];
    },
  };

  assert.equal(syncStackedHeaderSticky(table), true);
  assert.equal(table.style.values["--module-stacked-header-row1"], "42px");
});

test("placeholder detail rows hide only while a column filter is active", () => {
  const placeholder = { cellTexts: ["No entries"], cellCount: 1, firstColSpan: 8 };
  assert.equal(shouldShowTableRowGroup(placeholder, [""]), true);
  assert.equal(shouldShowTableRowGroup(placeholder, ["parvez"]), false);
  assert.equal(shouldShowTableRowGroup({ cellTexts: ["Parvez"], cellCount: 4, firstColSpan: 1 }, ["parvez"]), true);
});

function sortGroup(value, isTotal = false, details = []) {
  const primary = { classList: { contains: (name) => name === "moduleBiTotalRow" && isTotal } };
  return { primary, primaryCells: [{ innerText: value }], rows: [primary, ...details] };
}

test("sorting numeric rows is stable and keeps blank values last in either direction", () => {
  const ten = sortGroup("10");
  const two = sortGroup("2");
  const tiedTwo = sortGroup("2");
  const blank = sortGroup("");
  assert.deepEqual(sortTableRowGroups([ten, two, blank, tiedTwo]), [two, tiedTwo, ten, blank]);
  assert.deepEqual(sortTableRowGroups([ten, two, blank, tiedTwo], 0, "desc"), [ten, two, tiedTwo, blank]);
});

test("sorting preserves grouped detail rows and pins totals last", () => {
  const detail = { id: "detail" };
  const ten = sortGroup("10", false, [detail]);
  const two = sortGroup("2");
  const total = sortGroup("Total", true);
  assert.deepEqual(sortTableRowGroups([ten, total, two]), [two, ten, total]);
  assert.deepEqual(ten.rows, [ten.primary, detail]);
});

test("sorting recognizes currency values and chronological ISO dates", () => {
  const high = sortGroup("﷼1,250.50");
  const low = sortGroup("﷼90.25");
  assert.deepEqual(sortTableRowGroups([high, low]), [low, high]);
  const october = sortGroup("2026-10-02");
  const september = sortGroup("2026-09-30");
  assert.deepEqual(sortTableRowGroups([october, september]), [september, october]);
  const octoberDisplay = sortGroup("02 Oct 2026");
  const septemberDisplay = sortGroup("30 Sep 2026");
  assert.deepEqual(sortTableRowGroups([octoberDisplay, septemberDisplay]), [septemberDisplay, octoberDisplay]);
});

test("Total / avg-days columns stay numeric when some cells are dashes", () => {
  const high = sortGroup("1,506,234");
  const mid = sortGroup("993");
  const low = sortGroup("990");
  const blank = sortGroup("—");
  assert.deepEqual(
    sortTableRowGroups([mid, high, blank, low], 0, "desc"),
    [high, mid, low, blank],
  );
  assert.deepEqual(
    sortTableRowGroups([mid, high, blank, low], 0, "asc"),
    [low, mid, high, blank],
  );
});

test("amount-plus-delta cells sort by the amount, not the percent text", () => {
  const down = sortGroup("516,958 -48%");
  const up = sortGroup("898,690 +18384%");
  const plain = sortGroup("1,506,234");
  assert.deepEqual(
    sortTableRowGroups([up, plain, down], 0, "desc"),
    [plain, up, down],
  );
});
