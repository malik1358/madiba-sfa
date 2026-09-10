"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  excelFilterButtonLabel,
  filterExcelColumnOptions,
  selectedExcelFilterValues,
  toggleExcelFilterValue,
  toggleVisibleExcelFilterValues,
} from "../lib/excelColumnFilter";

export default function ExcelColumnFilter({
  label,
  options = [],
  selected = [],
  onChange,
  allLabel = "All",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const chosen = selectedExcelFilterValues(selected);
  const chosenKeys = useMemo(
    () => new Set(chosen.map((item) => item.toLowerCase())),
    [chosen],
  );
  const visible = useMemo(() => filterExcelColumnOptions(options, query), [options, query]);
  const allVisibleSelected = visible.length > 0
    && visible.every((item) => chosenKeys.has(String(item).toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const buttonLabel = excelFilterButtonLabel(chosen, allLabel);

  return (
    <div className="moduleExcelColumnFilter" ref={rootRef}>
      <button
        type="button"
        className={`moduleExcelColumnFilterButton${chosen.length ? " isActive" : ""}`}
        aria-label={`Filter ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
      >
        <span>{buttonLabel}</span>
      </button>
      {open ? (
        <div className="moduleExcelColumnFilterPanel" role="listbox" aria-multiselectable="true" aria-label={label}>
          <input
            ref={searchRef}
            className="moduleInput moduleExcelColumnFilterSearch"
            type="search"
            value={query}
            placeholder="Type to search"
            aria-label={`Search ${label}`}
            autoComplete="off"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="moduleExcelColumnFilterOption isSelectAll">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => onChange(toggleVisibleExcelFilterValues(chosen, visible))}
            />
            <span>Select all</span>
          </label>
          <div className="moduleExcelColumnFilterList">
            {visible.map((option) => (
              <label key={option} className="moduleExcelColumnFilterOption">
                <input
                  type="checkbox"
                  checked={chosenKeys.has(String(option).toLowerCase())}
                  onChange={() => onChange(toggleExcelFilterValue(chosen, option))}
                />
                <span>{option}</span>
              </label>
            ))}
            {visible.length === 0 ? (
              <div className="moduleExcelColumnFilterEmpty">No matches</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
