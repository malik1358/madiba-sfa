import { nextMonthKey, previousMonthKey, salesDateKey } from "./categoryGrowth.js";

export const DEFAULT_BI_REPORT_PERIOD = "all";

export const BI_REPORT_PERIODS = [
  { key: "all", label: { en: "All time", ar: "كل الفترة" } },
  { key: "mtd", label: { en: "This month", ar: "هذا الشهر" } },
  { key: "last-month", label: { en: "Last month", ar: "الشهر الماضي" } },
  { key: "qtd", label: { en: "This quarter", ar: "هذا الربع" } },
  { key: "last-3m", label: { en: "Last 3 months", ar: "آخر 3 أشهر" } },
  { key: "last-6m", label: { en: "Last 6 months", ar: "آخر 6 أشهر" } },
  { key: "last-12m", label: { en: "Last 12 months", ar: "آخر 12 شهراً" } },
  { key: "ytd", label: { en: "This year", ar: "هذا العام" } },
  { key: "last-year", label: { en: "Last year", ar: "العام الماضي" } },
  { key: "custom", label: { en: "Custom dates", ar: "تاريخ مخصص" } },
];

export function biReportPeriodLabel(key, language = "en") {
  const period = BI_REPORT_PERIODS.find((item) => item.key === key);
  if (!period) return key;
  return period.label[language] || period.label.en;
}

export function lastDayOfMonth(monthKey) {
  const next = nextMonthKey(monthKey);
  if (!next) return "";
  const date = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1));
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function shiftMonthKey(monthKey, delta = 0) {
  let cursor = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(cursor)) return "";
  const steps = Math.abs(Number(delta) || 0);
  for (let index = 0; index < steps; index += 1) {
    cursor = Number(delta) < 0 ? previousMonthKey(cursor) : nextMonthKey(cursor);
  }
  return cursor;
}

function quarterStartMonth(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const startMonth = String((Math.ceil(Number(match[2]) / 3) - 1) * 3 + 1).padStart(2, "0");
  return `${match[1]}-${startMonth}`;
}

export function resolveBiReportPeriod(period, asOfDate, custom = {}) {
  const asOf = salesDateKey(asOfDate);
  const month = asOf.slice(0, 7);
  const year = asOf.slice(0, 4);
  const key = String(period || DEFAULT_BI_REPORT_PERIOD);

  if (key === "custom") {
    return {
      dateFrom: salesDateKey(custom.dateFrom),
      dateTo: salesDateKey(custom.dateTo),
    };
  }
  if (!asOf) return { dateFrom: "", dateTo: "" };

  if (key === "mtd") return { dateFrom: `${month}-01`, dateTo: asOf };
  if (key === "last-month") {
    const previous = previousMonthKey(month);
    return { dateFrom: `${previous}-01`, dateTo: lastDayOfMonth(previous) };
  }
  if (key === "qtd") return { dateFrom: `${quarterStartMonth(month)}-01`, dateTo: asOf };
  if (key === "last-3m") return { dateFrom: `${shiftMonthKey(month, -2)}-01`, dateTo: asOf };
  if (key === "last-6m") return { dateFrom: `${shiftMonthKey(month, -5)}-01`, dateTo: asOf };
  if (key === "last-12m") return { dateFrom: `${shiftMonthKey(month, -11)}-01`, dateTo: asOf };
  if (key === "ytd") return { dateFrom: `${year}-01-01`, dateTo: asOf };
  if (key === "last-year") {
    const prior = String(Number(year) - 1);
    return { dateFrom: `${prior}-01-01`, dateTo: `${prior}-12-31` };
  }
  return { dateFrom: "", dateTo: "" };
}

export function applyBiReportPeriod(filters = {}, range = {}) {
  const dateFrom = range.dateFrom || "";
  const dateTo = range.dateTo || "";
  if (filters.dateFrom === dateFrom && filters.dateTo === dateTo) return filters;
  return { ...filters, dateFrom, dateTo };
}

export function formatBiReportPeriodRange(range = {}) {
  if (!range.dateFrom && !range.dateTo) return "";
  if (range.dateFrom && range.dateTo) return `${range.dateFrom} → ${range.dateTo}`;
  return range.dateFrom || range.dateTo || "";
}
