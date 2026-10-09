export function normalizeColumnFilterText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function textMatchesColumnFilter(cellText, filterText) {
  const filter = normalizeColumnFilterText(filterText);
  if (!filter) return true;
  return normalizeColumnFilterText(cellText).includes(filter);
}

export function columnFiltersAreActive(filterTexts) {
  return (Array.isArray(filterTexts) ? filterTexts : []).some((value) => Boolean(normalizeColumnFilterText(value)));
}

export function rowTextsMatchColumnFilters(cellTexts, filterTexts) {
  const filters = Array.isArray(filterTexts) ? filterTexts : [];
  if (!columnFiltersAreActive(filters)) return true;
  const texts = Array.isArray(cellTexts) ? cellTexts : [];
  return filters.every((filter, index) => textMatchesColumnFilter(texts[index] ?? "", filter));
}

export function shouldShowTableRowGroup({ cellTexts, cellCount, firstColSpan }, filterTexts) {
  const isPlaceholder = Number(cellCount || 0) === 1 && Number(firstColSpan || 1) > 1;
  if (isPlaceholder) return !columnFiltersAreActive(filterTexts);
  return rowTextsMatchColumnFilters(cellTexts, filterTexts);
}

export function isFilteredOutTableRow(row) {
  if (!row) return true;
  if (row.hidden) return true;
  if (typeof row.hasAttribute === "function" && row.hasAttribute("hidden")) return true;
  return Boolean(row.classList?.contains?.("moduleTableRowFilteredOut"));
}

function isCustomHeaderFilterControl(element) {
  return Boolean(
    element?.matches?.("input, select")
    && !element.classList.contains("moduleTableColumnFilterInput")
  );
}

export function isInjectedColumnFilterRow(row) {
  return Boolean(row?.classList?.contains("moduleTableColumnFilterRow"));
}

export function getHeaderLabelRows(table) {
  if (!table) return [];
  return [...table.querySelectorAll(":scope > thead > tr")].filter((row) => {
    if (isInjectedColumnFilterRow(row)) return false;
    return ![...row.querySelectorAll("input, select")].some((element) => isCustomHeaderFilterControl(element));
  });
}

export function tableHasCustomHeaderFilters(table) {
  if (!table) return false;
  if (table.querySelector(":scope > thead .moduleExcelColumnFilter")) return true;
  return [...table.querySelectorAll(":scope > thead input, :scope > thead select")]
    .some((element) => isCustomHeaderFilterControl(element));
}

export function headerCellLabel(cell) {
  if (!cell) return "";
  if (cell.dataset?.columnFilterLabel) return cell.dataset.columnFilterLabel;
  const parts = [...(cell.childNodes || [])]
    .filter((node) => {
      if (node.nodeType === 3) return true;
      if (node.nodeType !== 1) return false;
      return !node.classList?.contains("moduleTableColumnFilterInput")
        && !node.classList?.contains("moduleReportSortButton");
    })
    .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

export function getFilterableHeaderCells(table) {
  if (!table) return [];
  const labelRows = getHeaderLabelRows(table);
  if (labelRows.length === 0) return [];

  if (labelRows.length === 1) {
    const cells = [...labelRows[0].querySelectorAll(":scope > th, :scope > td")]
      .filter((cell) => Number(cell.colSpan || 1) <= 1);
    cells.forEach((cell, index) => {
      if (!cell.dataset.columnFilterLabel) {
        cell.dataset.columnFilterLabel = headerCellLabel(cell) || `Column ${index + 1}`;
      }
    });
    return cells;
  }

  const firstCells = [...labelRows[0].querySelectorAll(":scope > th, :scope > td")];
  const lastCells = [...labelRows[labelRows.length - 1].querySelectorAll(":scope > th, :scope > td")]
    .filter((cell) => Number(cell.colSpan || 1) <= 1);
  const leadingCells = [];
  const trailingCells = [];
  let seenGroupHeader = false;
  firstCells.forEach((cell) => {
    const colSpan = Number(cell.colSpan || 1);
    const rowSpan = Number(cell.rowSpan || 1);
    if (colSpan > 1) {
      seenGroupHeader = true;
      return;
    }
    if (rowSpan > 1) {
      if (seenGroupHeader) trailingCells.push(cell);
      else leadingCells.push(cell);
    }
  });

  const cells = [...leadingCells, ...lastCells, ...trailingCells];
  cells.forEach((cell, index) => {
    if (!cell.dataset.columnFilterLabel) {
      cell.dataset.columnFilterLabel = headerCellLabel(cell) || `Column ${index + 1}`;
    }
  });
  return cells;
}

export function groupTableBodyRows(table) {
  const rows = [...(table?.querySelectorAll(":scope > tbody > tr") || [])];
  const groups = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
    const isDetail = cells.length === 1 && Number(cells[0].colSpan || 1) > 1;

    if (isDetail && groups.length > 0) {
      groups[groups.length - 1].rows.push(row);
      index += 1;
      continue;
    }

    const group = { primary: row, primaryCells: cells, rows: [row] };
    let extra = Math.max(0, ...cells.map((cell) => Number(cell.rowSpan || 1) - 1));
    index += 1;

    while (extra > 0 && index < rows.length) {
      group.rows.push(rows[index]);
      extra -= 1;
      index += 1;
    }

    while (index < rows.length) {
      const nextCells = [...rows[index].querySelectorAll(":scope > th, :scope > td")];
      if (!(nextCells.length === 1 && Number(nextCells[0].colSpan || 1) > 1)) break;
      group.rows.push(rows[index]);
      index += 1;
    }

    groups.push(group);
  }

  return groups;
}

function sortableNumber(value) {
  const normalized = String(value || "").replace(/[\s,﷼%]/g, "").replace(/[()]/g, "-");
  if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function sortTableRowGroups(groups = [], columnIndex = 0, direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  const sortable = [];
  const pinned = [];
  groups.forEach((group, index) => {
    const firstCell = String(group?.primaryCells?.[0]?.innerText || group?.primaryCells?.[0]?.textContent || "").trim().toLowerCase();
    const isPinned = group?.primary?.classList?.contains?.("moduleBiTotalRow")
      || /^(grand\s+)?total\b/.test(firstCell)
      || /^subtotal\b/.test(firstCell);
    const cell = group?.primaryCells?.[columnIndex];
    const value = String(cell?.dataset?.sortValue ?? cell?.innerText ?? cell?.textContent ?? "").replace(/\s+/g, " ").trim();
    (isPinned ? pinned : sortable).push({ group, index, value });
  });

  const values = sortable.map(({ value }) => value).filter(Boolean);
  const numeric = values.length > 0 && values.every((value) => sortableNumber(value) !== null);
  const date = !numeric && values.length > 0 && values.every((value) => (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(value)
    || /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(value)
  ));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const timestamp = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) return Date.UTC(year, month - 1, day);
    return Date.parse(value);
  };

  sortable.sort((left, right) => {
    if (!left.value && right.value) return 1;
    if (left.value && !right.value) return -1;
    if (!left.value && !right.value) return left.index - right.index;
    const comparison = numeric
      ? sortableNumber(left.value) - sortableNumber(right.value)
      : date ? timestamp(left.value) - timestamp(right.value) : collator.compare(left.value, right.value);
    return comparison === 0 ? left.index - right.index : comparison * sign;
  });

  return [...sortable, ...pinned].map(({ group }) => group);
}

export function isSortableReportTable(table) {
  return Boolean(
    table?.matches?.("table.moduleTable, table.auditMatrix, table.auditCategoryMatrixV3, table.auditItemMatrix, table.auditPerformanceMatrix, table.auditQuickOrderTable, table.auditTransactionTable")
    && !table.closest(".moduleOrderEntry, .moduleOrderReview, [data-disable-report-sort]")
    && !table.querySelector("tbody input, tbody select, tbody textarea"),
  );
}

function setRowFilteredOut(row, hidden) {
  row.hidden = hidden;
  row.classList.toggle("moduleTableRowFilteredOut", hidden);
}

export function syncStackedHeaderSticky(table) {
  if (!table) return false;
  const labelRows = getHeaderLabelRows(table);
  const filterRow = [...(table.querySelectorAll(":scope > thead > tr") || [])]
    .find((row) => isInjectedColumnFilterRow(row));
  const firstRow = labelRows[0] || null;
  const secondRow = labelRows[1] || (labelRows.length === 1 ? filterRow : null);
  if (!firstRow || !secondRow) {
    table.classList.remove("moduleStackedHeaderTable");
    table.style.removeProperty("--module-stacked-header-row1");
    return false;
  }

  table.classList.add("moduleStackedHeaderTable");
  const height = Math.max(1, Math.ceil(firstRow.getBoundingClientRect().height));
  table.style.setProperty("--module-stacked-header-row1", `${height}px`);
  return true;
}

export function applyColumnFiltersToTable(table, filterTexts) {
  if (!table) return 0;
  const groups = groupTableBodyRows(table);
  let shown = 0;

  groups.forEach((group) => {
    const cellTexts = group.primaryCells.map((cell) => String(cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim());
    const match = shouldShowTableRowGroup({
      cellTexts,
      cellCount: group.primaryCells.length,
      firstColSpan: group.primaryCells[0] ? Number(group.primaryCells[0].colSpan || 1) : 1,
    }, filterTexts);

    group.rows.forEach((row) => setRowFilteredOut(row, !match));
    if (match && !(group.primaryCells.length === 1 && Number(group.primaryCells[0]?.colSpan || 1) > 1)) {
      shown += 1;
    }
  });

  return shown;
}
