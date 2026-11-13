import test from "node:test";
import assert from "node:assert/strict";
import {
  applyColumnVisibilityToTable,
  canHideLabel,
  emptyColumnPrefs,
  hiddenLabelsForTable,
  HIDDEN_COLUMN_CLASS,
  mergeTableHidden,
  normalizeColumnLabel,
  normalizeHiddenLabels,
  normalizeTableId,
  parseColumnPrefs,
  sanitizeHiddenLabels,
  tableColumnPrefsSettingKey,
} from "../app/lib/tableColumnVisibility.js";

test("normalize helpers trim labels and table ids", () => {
  assert.equal(normalizeColumnLabel("  Salesman  code "), "Salesman code");
  assert.equal(normalizeTableId(" returns-above-sales.xlsx "), "returns-above-sales");
  assert.deepEqual(normalizeHiddenLabels(["A", " A ", "", "B", "A"]), ["A", "B"]);
  assert.equal(tableColumnPrefsSettingKey("abc-123"), "table_column_prefs_v1:abc-123");
  assert.equal(tableColumnPrefsSettingKey(""), "");
});

test("parseColumnPrefs normalizes version and per-table hidden lists", () => {
  assert.deepEqual(parseColumnPrefs(null), emptyColumnPrefs());
  const parsed = parseColumnPrefs({
    version: 9,
    tables: {
      " bi-sales-mix ": { hidden: [" Other ", "Other", ""] },
      "": { hidden: ["x"] },
    },
  });
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.tables["bi-sales-mix"].hidden, ["Other"]);
});

test("mergeTableHidden upserts and clears empty hides", () => {
  const merged = mergeTableHidden(emptyColumnPrefs(), "returns-above-sales", ["Category"]);
  assert.deepEqual(hiddenLabelsForTable(merged, "returns-above-sales"), ["Category"]);
  const cleared = mergeTableHidden(merged, "returns-above-sales", []);
  assert.equal(cleared.tables["returns-above-sales"], undefined);
});

test("sanitizeHiddenLabels keeps at least one column visible", () => {
  assert.deepEqual(
    sanitizeHiddenLabels(["A", "B", "C"], ["A", "B", "C", "Z"]),
    ["A", "B"],
  );
  assert.equal(canHideLabel(["A", "B"], ["A"], "B"), false);
  assert.equal(canHideLabel(["A", "B"], [], "A"), true);
});

test("applyColumnVisibilityToTable hides matching leaf cells by label", () => {
  const table = {
    _hidden: new Set(),
    querySelectorAll(selector) {
      if (selector === `.${HIDDEN_COLUMN_CLASS}`) {
        return [...this._hidden];
      }
      if (selector === ":scope > thead > tr") return [this.headerRow];
      if (selector === ":scope > tbody > tr") return [this.bodyRow];
      if (selector === ":scope > tfoot > tr") return [];
      return [];
    },
  };

  function cell(label) {
    const node = {
      dataset: { columnFilterLabel: label },
      colSpan: 1,
      rowSpan: 1,
      classList: {
        _names: new Set(),
        add(name) {
          this._names.add(name);
          table._hidden.add(node);
        },
        remove(name) {
          this._names.delete(name);
          if (!this._names.has(HIDDEN_COLUMN_CLASS)) table._hidden.delete(node);
        },
        contains(name) {
          return this._names.has(name);
        },
      },
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
      getAttribute(name) {
        return this.attrs[name];
      },
    };
    return node;
  }

  const hCustomer = cell("Customer");
  const hCode = cell("Code");
  const hAmount = cell("Amount");
  const bCustomer = cell("");
  const bCode = cell("");
  const bAmount = cell("");

  table.headerRow = {
    querySelectorAll(selector) {
      if (selector === ":scope > th, :scope > td") return [hCustomer, hCode, hAmount];
      return [];
    },
  };
  table.bodyRow = {
    querySelectorAll(selector) {
      if (selector === ":scope > th, :scope > td") return [bCustomer, bCode, bAmount];
      return [];
    },
  };

  // Stub getFilterableHeaderCells path: single header row without custom controls.
  // applyColumnVisibilityToTable calls getFilterableHeaderCells which reads thead rows.
  // Provide the minimal DOM shape that getHeaderLabelRows + getFilterableHeaderCells expect.
  table.querySelectorAll = function querySelectorAll(selector) {
    if (selector === `.${HIDDEN_COLUMN_CLASS}`) return [...this._hidden];
    if (selector === ":scope > thead th[data-column-filter-label], :scope > thead td[data-column-filter-label]") {
      return [hCustomer, hCode, hAmount];
    }
    if (selector === ":scope > thead > tr") return [this.headerRow];
    if (selector === ":scope > tbody > tr") return [this.bodyRow];
    if (selector === ":scope > tfoot > tr") return [];
    return [];
  };
  table.headerRow.querySelectorAll = (selector) => {
    if (selector === "input, select") return [];
    if (selector === ":scope > th, :scope > td") return [hCustomer, hCode, hAmount];
    return [];
  };

  const hidden = applyColumnVisibilityToTable(table, ["Code", "Missing"]);
  assert.deepEqual(hidden, ["Code"]);
  assert.equal(hCode.classList.contains(HIDDEN_COLUMN_CLASS), true);
  assert.equal(bCode.classList.contains(HIDDEN_COLUMN_CLASS), true);
  assert.equal(hCustomer.classList.contains(HIDDEN_COLUMN_CLASS), false);
  assert.equal(bAmount.classList.contains(HIDDEN_COLUMN_CLASS), false);

  applyColumnVisibilityToTable(table, []);
  assert.equal(hCode.classList.contains(HIDDEN_COLUMN_CLASS), false);
  assert.equal(bCode.classList.contains(HIDDEN_COLUMN_CLASS), false);
});
