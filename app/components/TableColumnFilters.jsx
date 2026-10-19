"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { translate, useAppLanguage } from "../lib/appLanguage";
import {
  applyColumnFiltersToTable,
  columnFiltersAreActive,
  getFilterableHeaderCells,
  tableHasCustomHeaderFilters,
} from "../lib/tableColumnFilter";

const TEXT = {
  filter: { en: "Filter", ar: "تصفية" },
  clearFilters: { en: "Clear filters", ar: "مسح التصفية" },
  shown: { en: "shown", ar: "ظاهر" },
};

export default function TableColumnFilters({ tableHostRef, enabled = true }) {
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const [headerCells, setHeaderCells] = useState([]);
  const [filters, setFilters] = useState([]);
  const [shownCount, setShownCount] = useState(null);
  const [hasCustomFilters, setHasCustomFilters] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const host = tableHostRef.current;
    if (!host) return undefined;

    const syncHeaders = () => {
      const table = host.querySelector("table");
      if (!table || tableHasCustomHeaderFilters(table)) {
        setHasCustomFilters(Boolean(table && tableHasCustomHeaderFilters(table)));
        setHeaderCells([]);
        return;
      }

      setHasCustomFilters(false);
      const cells = getFilterableHeaderCells(table);
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

  if (!enabled || hasCustomFilters || headerCells.length === 0) return null;

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
      {headerCells.map((column) => (
        column.cell
          ? createPortal(
            <input
              key={`${column.index}-${column.label}`}
              className="moduleTableColumnFilterInput"
              type="search"
              value={filterValues[column.index]}
              placeholder={t("filter")}
              aria-label={`${t("filter")} ${column.label}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => {
                  const next = headerCells.map((_, index) => current[index] || "");
                  next[column.index] = value;
                  return next;
                });
              }}
            />,
            column.cell,
          )
          : null
      ))}
    </>
  );
}
