export function normalizeExcelFilterValue(value) {
  return String(value ?? "").trim();
}

export function selectedExcelFilterValues(selected) {
  if (Array.isArray(selected)) {
    return selected.map(normalizeExcelFilterValue).filter(Boolean);
  }
  const text = normalizeExcelFilterValue(selected);
  return text ? [text] : [];
}

export function matchesExcelColumnFilter(value, selected) {
  const chosen = selectedExcelFilterValues(selected);
  if (chosen.length === 0) return true;
  const text = normalizeExcelFilterValue(value) || "-";
  const keys = new Set(chosen.map((item) => item.toLowerCase()));
  return keys.has(text.toLowerCase());
}

export function excelFilterButtonLabel(selected, allLabel = "All") {
  const chosen = selectedExcelFilterValues(selected);
  if (chosen.length === 0) return allLabel;
  if (chosen.length === 1) return chosen[0];
  return `${chosen.length} selected`;
}

export function filterExcelColumnOptions(options, query) {
  const q = String(query || "").trim().toLowerCase();
  return (Array.isArray(options) ? options : []).filter((option) => (
    !q || String(option).toLowerCase().includes(q)
  ));
}

export function toggleExcelFilterValue(selected, value) {
  const text = normalizeExcelFilterValue(value);
  if (!text) return selectedExcelFilterValues(selected);
  const current = selectedExcelFilterValues(selected);
  const exists = current.some((item) => item.toLowerCase() === text.toLowerCase());
  return exists
    ? current.filter((item) => item.toLowerCase() !== text.toLowerCase())
    : [...current, text];
}

export function pruneExcelFilterSelection(selected, availableOptions) {
  const chosen = selectedExcelFilterValues(selected);
  if (chosen.length === 0) return [];
  const availableKeys = new Set(
    (Array.isArray(availableOptions) ? availableOptions : [])
      .map((item) => normalizeExcelFilterValue(item).toLowerCase())
      .filter(Boolean),
  );
  return chosen.filter((item) => availableKeys.has(item.toLowerCase()));
}

export function rowMatchesOtherExcelFilters(values, filters, currentKey, filterKeys, matches) {
  return (Array.isArray(filterKeys) ? filterKeys : []).every((key) => (
    key === currentKey || matches(values?.[key], filters?.[key])
  ));
}

export function toggleVisibleExcelFilterValues(selected, visibleOptions) {
  const current = selectedExcelFilterValues(selected);
  const visible = (Array.isArray(visibleOptions) ? visibleOptions : [])
    .map(normalizeExcelFilterValue)
    .filter(Boolean);
  if (visible.length === 0) return current;

  const currentKeys = new Set(current.map((item) => item.toLowerCase()));
  const allVisibleSelected = visible.every((item) => currentKeys.has(item.toLowerCase()));
  if (allVisibleSelected) {
    const visibleKeys = new Set(visible.map((item) => item.toLowerCase()));
    return current.filter((item) => !visibleKeys.has(item.toLowerCase()));
  }

  const next = [...current];
  visible.forEach((item) => {
    if (!currentKeys.has(item.toLowerCase())) next.push(item);
  });
  return next;
}
