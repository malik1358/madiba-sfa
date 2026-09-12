import {
  matchesExcelColumnFilter,
  normalizeExcelFilterValue,
  pruneExcelFilterSelection,
  rowMatchesOtherExcelFilters,
} from "./excelColumnFilter.js";

export function excelFilterCellText(value) {
  return normalizeExcelFilterValue(value) || "-";
}

export function uniqueExcelFilterOptions(values = []) {
  return [...new Set((values || []).map(excelFilterCellText))].sort((left, right) => (
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
  ));
}

export function rowExcelValues(row, keys, valueOf) {
  return Object.fromEntries((keys || []).map((key) => [key, valueOf(row, key)]));
}

export function buildExcelFilterOptions(rows = [], keys = [], valueOf, filters = {}) {
  return Object.fromEntries((keys || []).map((key) => {
    const values = [];
    for (const row of rows || []) {
      const cells = rowExcelValues(row, keys, valueOf);
      if (!rowMatchesOtherExcelFilters(cells, filters, key, keys, matchesExcelColumnFilter)) continue;
      values.push(cells[key]);
    }
    return [key, uniqueExcelFilterOptions(values)];
  }));
}

export function filterRowsByExcelFilters(rows = [], keys = [], valueOf, filters = {}) {
  return (rows || []).filter((row) => (
    (keys || []).every((key) => matchesExcelColumnFilter(valueOf(row, key), filters[key]))
  ));
}

export function pruneExcelFilters(filters = {}, options = {}) {
  const next = { ...filters };
  let changed = false;
  Object.keys(options || {}).forEach((key) => {
    const pruned = pruneExcelFilterSelection(next[key], options[key]);
    const current = Array.isArray(next[key]) ? next[key] : [];
    if (pruned.length !== current.length || pruned.some((item, index) => item !== current[index])) {
      next[key] = pruned;
      changed = true;
    }
  });
  return changed ? next : filters;
}
