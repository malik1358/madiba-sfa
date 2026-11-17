"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  excelFilterButtonLabel,
  excelFilterExcludeContains,
  excelFilterStateIsActive,
  filterExcelColumnOptions,
  selectedExcelFilterValues,
  setExcelFilterExcludeContains,
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
  const [excludeDraft, setExcludeDraft] = useState(() => excelFilterExcludeContains(selected));
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const chosen = selectedExcelFilterValues(selected);
  const excludeContains = excelFilterExcludeContains(selected);
  const chosenKeys = useMemo(
    () => new Set(chosen.map((item) => item.toLowerCase())),
    [chosen],
  );
  const visible = useMemo(() => filterExcelColumnOptions(options, query), [options, query]);
  const allVisibleSelected = visible.length > 0
    && visible.every((item) => chosenKeys.has(String(item).toLowerCase()));
  const active = excelFilterStateIsActive(selected);

  useEffect(() => {
    if (!open) setExcludeDraft(excludeContains);
  }, [excludeContains, open]);

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

  const buttonLabel = excelFilterButtonLabel(selected, allLabel);

  function applyExcludeContains(rawValue) {
    const next = setExcelFilterExcludeContains(selected, rawValue);
    setExcludeDraft(next.excludeContains);
    onChange(next);
  }

  return (
    <div className="moduleExcelColumnFilter" ref={rootRef}>
      <button
        type="button"
        className={`moduleExcelColumnFilterButton${active ? " isActive" : ""}`}
        aria-label={`Filter ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
          setExcludeDraft(excludeContains);
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
          <div className="moduleExcelColumnFilterExclude">
            <label className="moduleExcelColumnFilterExcludeLabel" htmlFor={`excel-exclude-${label}`}>
              Does not contain
            </label>
            <div className="moduleExcelColumnFilterExcludeRow">
              <input
                id={`excel-exclude-${label}`}
                className="moduleInput moduleExcelColumnFilterExcludeInput"
                type="search"
                value={excludeDraft}
                placeholder="e.g. Legal"
                aria-label={`${label} does not contain`}
                autoComplete="off"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setExcludeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyExcludeContains(excludeDraft);
                  }
                }}
              />
              <button
                type="button"
                className="moduleInlineButton"
                onClick={() => applyExcludeContains(excludeDraft)}
              >
                Apply
              </button>
              {excludeContains ? (
                <button
                  type="button"
                  className="moduleInlineButton"
                  onClick={() => applyExcludeContains("")}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <label className="moduleExcelColumnFilterOption isSelectAll">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => onChange(toggleVisibleExcelFilterValues(selected, visible))}
            />
            <span>Select all</span>
          </label>
          <div className="moduleExcelColumnFilterList">
            {visible.map((option) => (
              <label key={option} className="moduleExcelColumnFilterOption">
                <input
                  type="checkbox"
                  checked={chosenKeys.has(String(option).toLowerCase())}
                  onChange={() => onChange(toggleExcelFilterValue(selected, option))}
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
