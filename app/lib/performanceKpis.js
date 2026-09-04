import { currentMonthDateRange } from "./salesInvoices.js";

export const PERFORMANCE_KPI_KEYS = ["sales", "collection", "newCustomers", "repeatCustomers"];

export const PERFORMANCE_KPI_LABELS = {
  sales: "Sales",
  collection: "Collection",
  newCustomers: "New customers",
  repeatCustomers: "Repeat customers",
};

export function normalizeSalesmanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function monthStartDate(reportDate) {
  return currentMonthDateRange(reportDate).from;
}

export function monthProgressRatio(reportDate) {
  const date = String(reportDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const day = Number(date.slice(8, 10));
  const lastDay = Number(currentMonthDateRange(date).to.slice(8, 10));
  if (!day || !lastDay) return 0;
  return Math.min(1, Math.max(0, day / lastDay));
}

export function achievementPercent(actual, target) {
  const goal = Number(target || 0);
  if (!(goal > 0)) return null;
  return (Number(actual || 0) / goal) * 100;
}

export function kpiStatus({ actual, target, reportDate }) {
  const achievement = achievementPercent(actual, target);
  if (achievement == null) {
    return { key: "no_target", label: "No target", tone: "neutral" };
  }
  if (achievement >= 100) {
    return { key: "achieved", label: "Achieved", tone: "green" };
  }
  const expected = monthProgressRatio(reportDate) * 100;
  if (achievement + 0.05 >= expected * 0.85) {
    return { key: "on_track", label: "On track", tone: "orange" };
  }
  return { key: "behind", label: "Behind", tone: "red" };
}

export function emptyPerformanceActuals() {
  return {
    sales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function emptyPerformanceTargets() {
  return {
    sales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function normalizePerformanceTargets(row = {}) {
  return {
    sales: Number(row.sales ?? row.sales_target ?? 0) || 0,
    collection: Number(row.collection ?? row.collection_target ?? 0) || 0,
    newCustomers: Number(
      row.newCustomers ?? row.new_customers_target ?? row.new_buying_customers_target ?? 0,
    ) || 0,
    repeatCustomers: Number(
      row.repeatCustomers ?? row.repeat_customers_target ?? row.existing_customers_buying_target ?? 0,
    ) || 0,
  };
}

export function classifyBuyingCustomers(monthCustomerCodes = [], priorCustomerCodes = []) {
  const prior = new Set(
    (priorCustomerCodes || []).map((code) => normalizeSalesmanCode(code)).filter(Boolean),
  );
  const seen = new Set();
  let newCustomers = 0;
  let repeatCustomers = 0;

  (monthCustomerCodes || []).forEach((code) => {
    const normalized = normalizeSalesmanCode(code);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    if (prior.has(normalized)) repeatCustomers += 1;
    else newCustomers += 1;
  });

  return { newCustomers, repeatCustomers };
}

export function buyingCustomerCodesFromSales(rows = []) {
  const codes = [];
  (rows || []).forEach((row) => {
    if (Number(row?.sales_amount || 0) <= 0) return;
    const code = normalizeSalesmanCode(row.customer_code);
    if (code) codes.push(code);
  });
  return codes;
}

export function sumSalesAmount(rows = []) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.sales_amount || 0), 0);
}

export function sumCollectionAmount(rows = []) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.amount_received || 0), 0);
}

export function buildPerformanceKpi(key, { actual = 0, target = 0, reportDate } = {}) {
  const achievement = achievementPercent(actual, target);
  const status = kpiStatus({ actual, target, reportDate });
  return {
    key,
    label: PERFORMANCE_KPI_LABELS[key] || key,
    actual: Number(actual || 0) || 0,
    target: Number(target || 0) || 0,
    achievement,
    status,
  };
}

export function buildPerformanceSnapshot({
  reportDate,
  salesmanCode = "",
  salesmanName = "",
  actuals = emptyPerformanceActuals(),
  targets = emptyPerformanceTargets(),
  updatedAt = null,
  updatedByName = "",
} = {}) {
  const normalizedTargets = normalizePerformanceTargets(targets);
  const normalizedActuals = {
    ...emptyPerformanceActuals(),
    ...actuals,
  };
  const kpis = PERFORMANCE_KPI_KEYS.map((key) => buildPerformanceKpi(key, {
    actual: normalizedActuals[key],
    target: normalizedTargets[key],
    reportDate,
  }));
  const hasTargets = kpis.some((kpi) => kpi.target > 0);
  const overall = kpis.reduce((sum, kpi) => sum + Number(kpi.achievement || 0), 0)
    / Math.max(1, kpis.filter((kpi) => kpi.achievement != null).length || 1);

  return {
    reportDate,
    monthStart: reportDate ? monthStartDate(reportDate) : "",
    salesmanCode: normalizeSalesmanCode(salesmanCode),
    salesmanName: String(salesmanName || "").trim(),
    actuals: normalizedActuals,
    targets: normalizedTargets,
    kpis,
    hasTargets,
    overallAchievement: kpis.some((kpi) => kpi.achievement != null) ? overall : null,
    updatedAt: updatedAt || null,
    updatedByName: String(updatedByName || "").trim(),
    published: hasTargets,
  };
}

export function formatPerformanceKpiValue(key, value) {
  const number = Number(value || 0);
  if (key === "sales" || key === "collection") {
    return number.toLocaleString("en-SA", { maximumFractionDigits: 0 });
  }
  return String(Math.round(number));
}

export function formatAchievementPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export function formatPerformanceUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function performanceUpdatedStatusLabel(snapshot) {
  if (!snapshot?.hasTargets) return "Targets not set";
  const when = formatPerformanceUpdatedAt(snapshot.updatedAt);
  const who = String(snapshot.updatedByName || "").trim();
  if (when && who) return `Targets updated ${when} by ${who}`;
  if (when) return `Targets updated ${when}`;
  return "Targets published";
}

export function formatPerformanceKpiLine(kpi) {
  const actual = formatPerformanceKpiValue(kpi.key, kpi.actual);
  const target = kpi.target > 0 ? formatPerformanceKpiValue(kpi.key, kpi.target) : "—";
  const achievement = formatAchievementPercent(kpi.achievement);
  return `${kpi.label}: ${actual} / ${target} (${achievement}) — ${kpi.status?.label || "No target"}`;
}
