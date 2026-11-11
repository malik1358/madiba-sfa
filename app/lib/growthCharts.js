import {
  estimateAtCurrentPace,
  expectedPacePercent,
  monthEndPaceEstimate,
  resolveSalesPaceAsOfDate,
} from "./performanceKpis.js";
import { getKsaDateString } from "./workdayActivity.js";

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

/**
 * KPI-style month-end projection for an open MTD chart point.
 * Uses workday expected pace (same shape as Method A sales forecast without personal shares).
 */
export function chartOpenMonthEstimate(actual, {
  openMonth = "",
  period = "",
  todayIso = "",
  salesAsOfDate = "",
} = {}) {
  const month = String(openMonth || "").slice(0, 7);
  const key = String(period || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || key !== month) {
    return Number(actual || 0) || 0;
  }
  const today = String(todayIso || getKsaDateString()).slice(0, 10);
  const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(today) && today > monthEnd) {
    return Number(actual || 0) || 0;
  }
  const reportDate = `${month}-01`;
  const paceDate = resolveSalesPaceAsOfDate(reportDate, today || reportDate, salesAsOfDate || undefined);
  const expected = expectedPacePercent(paceDate, null);
  const estimate = monthEndPaceEstimate({
    actual,
    expected,
    asOfDate: paceDate,
  });
  if (estimate == null) {
    const fallback = estimateAtCurrentPace(actual, expected);
    return fallback == null ? (Number(actual || 0) || 0) : fallback;
  }
  return estimate;
}

export function chartMonthPeriodLabel(month, currentMonth, { estimated = false } = {}) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  if (month !== currentMonth) return label;
  return estimated ? `${label} est.` : `${label} MTD`;
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
  openMonth = "",
  todayIso = "",
  salesAsOfDate = "",
  estimateOpenMonth = false,
} = {}) {
  const amountOf = (row) => periodTotal(row, periods, valuesOf);
  const { top, rest } = splitTopChartRows(rows, { limit, amountOf });
  const valueFor = (raw, period) => {
    const amount = Number(raw || 0) || 0;
    if (!estimateOpenMonth) return amount;
    return chartOpenMonthEstimate(amount, {
      openMonth,
      period,
      todayIso,
      salesAsOfDate,
    });
  };
  const series = top.map((row, index) => ({
    key: rowChartLabel(row),
    label: rowChartLabel(row),
    color: GROWTH_CHART_PALETTE[index % GROWTH_CHART_PALETTE.length],
    values: (periods || []).map((period) => valueFor((valuesOf(row) || {})[period], period)),
  }));

  if (rest.length) {
    series.push({
      key: OTHERS_SERIES_KEY,
      label: othersLabel,
      color: "#94a3b8",
      values: (periods || []).map((period) => valueFor(
        rest.reduce((sum, row) => sum + Number((valuesOf(row) || {})[period] || 0), 0),
        period,
      )),
    });
  }

  series.push({
    key: TOTAL_SERIES_KEY,
    label: totalLabel,
    color: "#0f172a",
    dashed: true,
    values: (periods || []).map((period) => valueFor(
      (rows || []).reduce((sum, row) => sum + Number((valuesOf(row) || {})[period] || 0), 0),
      period,
    )),
  });

  const max = Math.max(1, ...series.flatMap((item) => item.values));
  return {
    periods: periods || [],
    series,
    max,
    openMonthEstimated: Boolean(estimateOpenMonth && openMonth && (periods || []).includes(openMonth)),
  };
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
