export function normalizeExcelFilterValue(value) {
  return String(value ?? "").trim();
}

export function selectedExcelFilterValues(selected) {
  if (selected && typeof selected === "object" && !Array.isArray(selected)) {
    return selectedExcelFilterValues(selected.selected ?? selected.values ?? []);
  }
  if (Array.isArray(selected)) {
    return selected.map(normalizeExcelFilterValue).filter(Boolean);
  }
  const text = normalizeExcelFilterValue(selected);
  return text ? [text] : [];
}

export function excelFilterExcludeContains(selected) {
  if (selected && typeof selected === "object" && !Array.isArray(selected)) {
    return String(selected.excludeContains ?? selected.exclude ?? "").trim();
  }
  return "";
}

export function normalizeExcelFilterState(selected) {
  return {
    selected: selectedExcelFilterValues(selected),
    excludeContains: excelFilterExcludeContains(selected),
  };
}

export function buildExcelFilterState({ selected = [], excludeContains = "" } = {}) {
  return {
    selected: selectedExcelFilterValues(selected),
    excludeContains: String(excludeContains || "").trim(),
  };
}

export function excelFilterStateIsActive(selected) {
  const state = normalizeExcelFilterState(selected);
  return state.selected.length > 0 || Boolean(state.excludeContains);
}

export function matchesExcelColumnFilter(value, selected) {
  const state = normalizeExcelFilterState(selected);
  const text = normalizeExcelFilterValue(value) || "-";
  if (state.excludeContains) {
    if (text.toLowerCase().includes(state.excludeContains.toLowerCase())) return false;
  }
  if (state.selected.length === 0) return true;
  const keys = new Set(state.selected.map((item) => item.toLowerCase()));
  return keys.has(text.toLowerCase());
}

export function excelFilterButtonLabel(selected, allLabel = "All") {
  const state = normalizeExcelFilterState(selected);
  const parts = [];
  if (state.selected.length === 1) parts.push(state.selected[0]);
  else if (state.selected.length > 1) parts.push(`${state.selected.length} selected`);
  if (state.excludeContains) parts.push(`≠ ${state.excludeContains}`);
  if (!parts.length) return allLabel;
  return parts.join(" · ");
}

export function filterExcelColumnOptions(options, query) {
  const q = String(query || "").trim().toLowerCase();
  return (Array.isArray(options) ? options : []).filter((option) => (
    !q || String(option).toLowerCase().includes(q)
  ));
}

export function toggleExcelFilterValue(selected, value) {
  const text = normalizeExcelFilterValue(value);
  const state = normalizeExcelFilterState(selected);
  if (!text) return buildExcelFilterState(state);
  const exists = state.selected.some((item) => item.toLowerCase() === text.toLowerCase());
  const nextSelected = exists
    ? state.selected.filter((item) => item.toLowerCase() !== text.toLowerCase())
    : [...state.selected, text];
  return buildExcelFilterState({
    selected: nextSelected,
    excludeContains: state.excludeContains,
  });
}

export function pruneExcelFilterSelection(selected, availableOptions) {
  const state = normalizeExcelFilterState(selected);
  if (!excelFilterStateIsActive(state)) {
    return buildExcelFilterState();
  }
  const availableKeys = new Set(
    (Array.isArray(availableOptions) ? availableOptions : [])
      .map((item) => normalizeExcelFilterValue(item).toLowerCase())
      .filter(Boolean),
  );
  return buildExcelFilterState({
    selected: state.selected.filter((item) => availableKeys.has(item.toLowerCase())),
    excludeContains: state.excludeContains,
  });
}

export function excelFilterStatesEqual(left, right) {
  const a = normalizeExcelFilterState(left);
  const b = normalizeExcelFilterState(right);
  if (a.excludeContains.toLowerCase() !== b.excludeContains.toLowerCase()) return false;
  if (a.selected.length !== b.selected.length) return false;
  return a.selected.every((item, index) => item === b.selected[index]);
}

export function rowMatchesOtherExcelFilters(values, filters, currentKey, filterKeys, matches) {
  return (Array.isArray(filterKeys) ? filterKeys : []).every((key) => (
    key === currentKey || matches(values?.[key], filters?.[key])
  ));
}

export function toggleVisibleExcelFilterValues(selected, visibleOptions) {
  const state = normalizeExcelFilterState(selected);
  const visible = (Array.isArray(visibleOptions) ? visibleOptions : [])
    .map(normalizeExcelFilterValue)
    .filter(Boolean);
  if (visible.length === 0) return buildExcelFilterState(state);

  const currentKeys = new Set(state.selected.map((item) => item.toLowerCase()));
  const allVisibleSelected = visible.every((item) => currentKeys.has(item.toLowerCase()));
  if (allVisibleSelected) {
    const visibleKeys = new Set(visible.map((item) => item.toLowerCase()));
    return buildExcelFilterState({
      selected: state.selected.filter((item) => !visibleKeys.has(item.toLowerCase())),
      excludeContains: state.excludeContains,
    });
  }

  const next = [...state.selected];
  visible.forEach((item) => {
    if (!currentKeys.has(item.toLowerCase())) next.push(item);
  });
  return buildExcelFilterState({
    selected: next,
    excludeContains: state.excludeContains,
  });
}

export function setExcelFilterExcludeContains(selected, excludeContains) {
  const state = normalizeExcelFilterState(selected);
  return buildExcelFilterState({
    selected: state.selected,
    excludeContains,
  });
}
