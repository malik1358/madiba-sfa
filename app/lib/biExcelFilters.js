import {
  excelFilterStatesEqual,
  matchesExcelColumnFilter,
  normalizeExcelFilterValue,
  pruneExcelFilterSelection,
} from "./excelColumnFilter.js";

export function excelFilterCellText(value) {
  return normalizeExcelFilterValue(value) || "-";
}

// "1,234.56", "+2,880", "-1,380.04", "12%", "900 ﷼" — the formatted money/count cells.
const NUMERIC_OPTION = /^[^\d+-]*([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)\s*%?$/;

/** Formatted amounts must sort by value; "4,749.34" is not text-greater than "4.11". */
export function excelFilterOptionNumber(text) {
  const match = NUMERIC_OPTION.exec(String(text ?? "").trim());
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function uniqueExcelFilterOptions(values = []) {
  return [...new Set((values || []).map(excelFilterCellText))].sort((left, right) => {
    const leftNumber = excelFilterOptionNumber(left);
    const rightNumber = excelFilterOptionNumber(right);
    if (leftNumber != null && rightNumber != null) {
      return leftNumber - rightNumber || left.localeCompare(right);
    }
    if (leftNumber != null) return -1;
    if (rightNumber != null) return 1;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function rowExcelValues(row, keys, valueOf) {
  return Object.fromEntries((keys || []).map((key) => [key, valueOf(row, key)]));
}

/**
 * Build checkbox options for every filter column from the full row set.
 * Options stay independent of applied filters so multi-select can keep picking
 * values even after other columns (or this column) already narrow the table.
 * The unused 4th argument is kept for call-site compatibility.
 */
export function buildExcelFilterOptions(rows = [], keys = [], valueOf, _filters = {}) {
  const keyList = Array.isArray(keys) ? keys : [];
  const buckets = Object.fromEntries(keyList.map((key) => [key, []]));
  for (const row of rows || []) {
    for (const key of keyList) {
      buckets[key].push(valueOf(row, key));
    }
  }
  return Object.fromEntries(
    keyList.map((key) => [key, uniqueExcelFilterOptions(buckets[key])]),
  );
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
    if (!excelFilterStatesEqual(next[key], pruned)) {
      next[key] = pruned;
      changed = true;
    }
  });
  return changed ? next : filters;
}
