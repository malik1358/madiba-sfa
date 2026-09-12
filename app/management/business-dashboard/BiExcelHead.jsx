"use client";

import { useEffect, useMemo, useState } from "react";
import ExcelColumnFilter from "../../components/ExcelColumnFilter";
import { buildExcelFilterOptions, filterRowsByExcelFilters, pruneExcelFilters } from "../../lib/biExcelFilters";

export function useBiExcelFilters(rows = [], keys = [], valueOf) {
  const [filters, setFilters] = useState({});
  const options = useMemo(
    () => buildExcelFilterOptions(rows, keys, valueOf, filters),
    [rows, keys, valueOf, filters],
  );

  useEffect(() => {
    setFilters((current) => pruneExcelFilters(current, options));
  }, [options]);

  const visibleRows = useMemo(
    () => filterRowsByExcelFilters(rows, keys, valueOf, filters),
    [rows, keys, valueOf, filters],
  );

  function setFilter(key, selected) {
    setFilters((current) => ({ ...current, [key]: selected }));
  }

  return { filters, options, visibleRows, setFilter };
}

export default function BiExcelHead({
  label,
  filterKey,
  options,
  filters,
  onChange,
  allLabel = "All",
  className = "",
}) {
  return (
    <th className={className} data-column-filter-label={label}>
      <div className="moduleTableHeadingFilter">
        <span>{label}</span>
        <ExcelColumnFilter
          label={label}
          options={options[filterKey] || []}
          selected={filters[filterKey]}
          onChange={(selected) => onChange(filterKey, selected)}
          allLabel={allLabel}
        />
      </div>
    </th>
  );
}
