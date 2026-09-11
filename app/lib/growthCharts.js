export const GROWTH_CHART_PALETTE = [
  "#0f4c5c",
  "#0ea5a4",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#65a30d",
  "#0891b2",
];

export const OTHERS_SERIES_KEY = "__others__";
export const TOTAL_SERIES_KEY = "__total__";

export function rowChartLabel(row = {}) {
  return String(row.label || row.category || "").trim() || "Unclassified";
}

export function compactChartNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  const abs = Math.abs(number);
  if (abs >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(number / 1000)}k`;
  return String(Math.round(number));
}

export function periodTotal(row = {}, periods = [], valuesOf = (item) => item.monthValues) {
  const values = valuesOf(row) || {};
  return (periods || []).reduce((sum, period) => sum + Number(values[period] || 0), 0);
}

export function splitTopChartRows(rows = [], { limit = 5, amountOf = (row) => Number(row.lifetime || 0) } = {}) {
  const ranked = [...(rows || [])].sort((left, right) => amountOf(right) - amountOf(left) || rowChartLabel(left).localeCompare(rowChartLabel(right)));
  return {
    top: ranked.slice(0, limit),
    rest: ranked.slice(limit),
  };
}

export function buildPeriodChartModel(rows = [], periods = [], valuesOf = (row) => row.monthValues, {
  limit = 5,
  othersLabel = "Others",
  totalLabel = "Total",
} = {}) {
  const amountOf = (row) => periodTotal(row, periods, valuesOf);
  const { top, rest } = splitTopChartRows(rows, { limit, amountOf });
  const series = top.map((row, index) => ({
    key: rowChartLabel(row),
    label: rowChartLabel(row),
    color: GROWTH_CHART_PALETTE[index % GROWTH_CHART_PALETTE.length],
    values: (periods || []).map((period) => Number((valuesOf(row) || {})[period] || 0)),
  }));

  if (rest.length) {
    series.push({
      key: OTHERS_SERIES_KEY,
      label: othersLabel,
      color: "#94a3b8",
      values: (periods || []).map((period) => (
        rest.reduce((sum, row) => sum + Number((valuesOf(row) || {})[period] || 0), 0)
      )),
    });
  }

  series.push({
    key: TOTAL_SERIES_KEY,
    label: totalLabel,
    color: "#0f172a",
    dashed: true,
    values: (periods || []).map((period) => (
      (rows || []).reduce((sum, row) => sum + Number((valuesOf(row) || {})[period] || 0), 0)
    )),
  });

  const max = Math.max(1, ...series.flatMap((item) => item.values));
  return { periods: periods || [], series, max };
}

export function buildCompareChartItems(rows = [], {
  latestOf = (row) => Number(row.latestCompleteAmount || 0),
  priorOf = (row) => Number(row.priorMonthAmount || 0),
  limit = 8,
} = {}) {
  return splitTopChartRows(rows, { limit, amountOf: latestOf }).top.map((row) => ({
    key: rowChartLabel(row),
    label: rowChartLabel(row),
    latest: latestOf(row),
    prior: priorOf(row),
  }));
}

export function buildShareChartItems(rows = [], { amountOf = (row) => Number(row.lifetime || 0), limit = 8 } = {}) {
  const { top, rest } = splitTopChartRows(rows, { limit, amountOf });
  const items = top.map((row) => ({
    key: rowChartLabel(row),
    label: rowChartLabel(row),
    value: amountOf(row),
  }));
  if (rest.length) {
    items.push({
      key: OTHERS_SERIES_KEY,
      label: "Others",
      value: rest.reduce((sum, row) => sum + amountOf(row), 0),
    });
  }
  return items;
}

export function buildSignalMix(rows = [], statusOf = (row) => row.status || row.trajectory?.status) {
  return (rows || []).reduce((counts, row) => {
    const status = String(statusOf(row) || "neutral");
    const key = ["green", "orange", "red", "neutral"].includes(status) ? status : "neutral";
    counts[key] += 1;
    return counts;
  }, {
    green: 0,
    orange: 0,
    red: 0,
    neutral: 0,
  });
}
