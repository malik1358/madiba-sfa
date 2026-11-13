import { getFilterableHeaderCells } from "./tableColumnFilter.js";

export const TABLE_COLUMN_PREFS_VERSION = 1;
export const TABLE_COLUMN_PREFS_KEY_PREFIX = "table_column_prefs_v1:";
export const HIDDEN_COLUMN_CLASS = "moduleTableColHidden";

export function tableColumnPrefsSettingKey(userId) {
  const id = String(userId || "").trim();
  return id ? `${TABLE_COLUMN_PREFS_KEY_PREFIX}${id}` : "";
}

export function normalizeColumnLabel(label) {
  return String(label || "").replace(/\s+/g, " ").trim();
}

export function normalizeTableId(tableId) {
  return String(tableId || "").trim().replace(/\.xlsx$/i, "").slice(0, 120);
}

export function normalizeHiddenLabels(hidden) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(hidden) ? hidden : []) {
    const label = normalizeColumnLabel(raw);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function emptyColumnPrefs() {
  return { version: TABLE_COLUMN_PREFS_VERSION, tables: {} };
}

export function parseColumnPrefs(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyColumnPrefs();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyColumnPrefs();
  }

  const tables = {};
  const source = value.tables && typeof value.tables === "object" && !Array.isArray(value.tables)
    ? value.tables
    : {};
  Object.entries(source).forEach(([key, entry]) => {
    const tableId = normalizeTableId(key);
    if (!tableId) return;
    const hidden = normalizeHiddenLabels(entry?.hidden);
    tables[tableId] = { hidden };
  });

  return { version: TABLE_COLUMN_PREFS_VERSION, tables };
}

export function hiddenLabelsForTable(prefs, tableId) {
  const id = normalizeTableId(tableId);
  if (!id) return [];
  const parsed = parseColumnPrefs(prefs);
  return normalizeHiddenLabels(parsed.tables?.[id]?.hidden);
}

export function mergeTableHidden(prefs, tableId, hiddenLabels) {
  const parsed = parseColumnPrefs(prefs);
  const id = normalizeTableId(tableId);
  if (!id) return parsed;
  const hidden = normalizeHiddenLabels(hiddenLabels);
  if (hidden.length === 0) {
    delete parsed.tables[id];
  } else {
    parsed.tables[id] = { hidden };
  }
  return parsed;
}

/**
 * Drop unknown labels and keep at least one column visible.
 */
export function sanitizeHiddenLabels(allLabels, hiddenLabels) {
  const available = normalizeHiddenLabels(allLabels);
  const availableSet = new Set(available);
  let hidden = normalizeHiddenLabels(hiddenLabels).filter((label) => availableSet.has(label));
  if (available.length > 0 && hidden.length >= available.length) {
    hidden = hidden.slice(0, available.length - 1);
  }
  return hidden;
}

export function canHideLabel(allLabels, hiddenLabels, labelToHide) {
  const label = normalizeColumnLabel(labelToHide);
  if (!label) return false;
  const next = sanitizeHiddenLabels(allLabels, [...normalizeHiddenLabels(hiddenLabels), label]);
  return next.includes(label);
}

/**
 * Prefer explicit data-column-filter-label leaf headers (BiExcelHead) so open
 * Excel-filter search inputs do not hide the label row from discovery.
 */
export function getVisibilityHeaderCells(table) {
  if (!table) return [];
  const labeled = [...table.querySelectorAll(
    ":scope > thead th[data-column-filter-label], :scope > thead td[data-column-filter-label]",
  )].filter((cell) => Number(cell.colSpan || 1) <= 1);
  if (labeled.length > 0) return labeled;
  return getFilterableHeaderCells(table);
}

export function discoverTableColumnLabels(table) {
  if (!table) return [];
  return getVisibilityHeaderCells(table).map((cell, index) => (
    normalizeColumnLabel(cell.dataset?.columnFilterLabel) || `Column ${index + 1}`
  ));
}

function setCellHidden(cell, hidden) {
  if (!cell) return;
  if (hidden) {
    cell.classList.add(HIDDEN_COLUMN_CLASS);
    cell.setAttribute("aria-hidden", "true");
  } else {
    cell.classList.remove(HIDDEN_COLUMN_CLASS);
    cell.removeAttribute("aria-hidden");
  }
}

function clearHiddenMarkers(table) {
  if (!table || typeof table.querySelectorAll !== "function") return;
  [...table.querySelectorAll(`.${HIDDEN_COLUMN_CLASS}`)].forEach((cell) => {
    setCellHidden(cell, false);
  });
}

function isPlaceholderRow(row) {
  const cells = [...(row?.querySelectorAll?.(":scope > th, :scope > td") || [])];
  return cells.length === 1 && Number(cells[0].colSpan || 1) > 1;
}

/**
 * Hide leaf columns by header label. Returns the sanitized hidden label list applied.
 */
export function applyColumnVisibilityToTable(table, hiddenLabels) {
  if (!table) return [];
  clearHiddenMarkers(table);

  const headerCells = getVisibilityHeaderCells(table);
  const allLabels = headerCells.map((cell, index) => (
    normalizeColumnLabel(cell.dataset?.columnFilterLabel) || `Column ${index + 1}`
  ));
  const hidden = sanitizeHiddenLabels(allLabels, hiddenLabels);
  if (hidden.length === 0) return [];

  const hiddenSet = new Set(hidden);
  const hiddenIndexes = new Set();
  headerCells.forEach((cell, index) => {
    const label = allLabels[index];
    if (!hiddenSet.has(label)) return;
    hiddenIndexes.add(index);
    setCellHidden(cell, true);
  });

  const rows = [
    ...table.querySelectorAll(":scope > thead > tr"),
    ...table.querySelectorAll(":scope > tbody > tr"),
    ...table.querySelectorAll(":scope > tfoot > tr"),
  ];
  rows.forEach((row) => {
    if (isPlaceholderRow(row)) return;
    const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
    if (cells.length !== headerCells.length) {
      // Body rows usually match leaf count; skip mismatched structural rows.
      return;
    }
    hiddenIndexes.forEach((index) => {
      setCellHidden(cells[index], true);
    });
  });

  return hidden;
}

export function isHiddenColumnCell(cell) {
  if (!cell) return false;
  if (cell.classList?.contains?.(HIDDEN_COLUMN_CLASS)) return true;
  if (typeof cell.getAttribute === "function" && cell.getAttribute("aria-hidden") === "true") return true;
  return false;
}
