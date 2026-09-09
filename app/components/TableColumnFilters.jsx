"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { translate, useAppLanguage } from "../lib/appLanguage";
import {
  applyColumnFiltersToTable,
  columnFiltersAreActive,
  getFilterableHeaderCells,
  getHeaderLabelRows,
  tableHasCustomHeaderFilters,
} from "../lib/tableColumnFilter";

const TEXT = {
  filter: { en: "Filter", ar: "تصفية" },
  clearFilters: { en: "Clear filters", ar: "مسح التصفية" },
  shown: { en: "shown", ar: "ظاهر" },
};

function renderFilterInput(column, value, placeholder, onChange) {
  return (
    <input
      key={`${column.index}-${column.label}`}
      className="moduleTableColumnFilterInput"
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={`${placeholder} ${column.label}`}
      autoComplete="off"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => onChange(column.index, event.target.value)}
    />
  );
}

export default function TableColumnFilters({ tableHostRef, enabled = true }) {
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const [headerCells, setHeaderCells] = useState([]);
  const [filters, setFilters] = useState([]);
  const [shownCount, setShownCount] = useState(null);
  const [hasCustomFilters, setHasCustomFilters] = useState(false);
  const [useFilterRow, setUseFilterRow] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const host = tableHostRef.current;
    if (!host) return undefined;

    const syncHeaders = () => {
      const table = host.querySelector("table");
      if (!table || tableHasCustomHeaderFilters(table)) {
        setHasCustomFilters(Boolean(table && tableHasCustomHeaderFilters(table)));
        setHeaderCells([]);
        setUseFilterRow(false);
        return;
      }

      setHasCustomFilters(false);
      const cells = getFilterableHeaderCells(table);
      const labelRows = getHeaderLabelRows(table);
      setUseFilterRow(labelRows.length === 1);
      setHeaderCells((current) => {
        if (
          current.length === cells.length
          && current.every((item, index) => item.cell === cells[index] && item.label === cells[index].dataset.columnFilterLabel)
        ) {
          return current;
        }
        return cells.map((cell, index) => ({
          index,
          label: cell.dataset.columnFilterLabel || `Column ${index + 1}`,
          cell,
        }));
      });
    };

    syncHeaders();
    const observer = new MutationObserver(syncHeaders);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, tableHostRef]);

  useLayoutEffect(() => {
    if (!enabled || hasCustomFilters) return;
    const table = tableHostRef.current?.querySelector("table");
    if (!table) return;
    const values = headerCells.map((_, index) => filters[index] || "");
    setShownCount(applyColumnFiltersToTable(table, values));
  }, [enabled, filters, hasCustomFilters, headerCells, tableHostRef]);

  const active = columnFiltersAreActive(filters);

  const filterValues = useMemo(
    () => headerCells.map((_, index) => filters[index] || ""),
    [filters, headerCells],
  );

  function updateFilter(index, value) {
    setFilters((current) => {
      const next = headerCells.map((_, columnIndex) => current[columnIndex] || "");
      next[index] = value;
      return next;
    });
  }

  if (!enabled || hasCustomFilters || headerCells.length === 0) return null;

  const table = tableHostRef.current?.querySelector("table");
  const thead = table?.querySelector(":scope > thead");

  return (
    <>
      <div className="moduleTableColumnFilterStatus">
        {active ? (
          <>
            <span>{shownCount ?? 0} {t("shown")}</span>
            <button
              type="button"
              className="moduleInlineButton"
              onClick={() => setFilters([])}
            >
              {t("clearFilters")}
            </button>
          </>
        ) : null}
      </div>
      {useFilterRow && thead
        ? createPortal(
          <tr className="moduleTableColumnFilterRow">
            {headerCells.map((column) => (
              <th key={`${column.index}-${column.label}`} data-column-filter-label={column.label}>
                {renderFilterInput(column, filterValues[column.index], t("filter"), updateFilter)}
              </th>
            ))}
          </tr>,
          thead,
        )
        : headerCells.map((column) => (
          column.cell
            ? createPortal(
              renderFilterInput(column, filterValues[column.index], t("filter"), updateFilter),
              column.cell,
            )
            : null
        ))}
    </>
  );
}
