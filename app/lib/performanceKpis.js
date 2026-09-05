import { currentMonthDateRange } from "./salesInvoices.js";

export function isMissingSchemaColumn(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code === "42703"
    || code === "PGRST204"
    || (message.includes("column") && message.includes("does not exist"))
    || (message.includes("could not find") && message.includes("column"))
    || message.includes("schema cache");
}

export const PERFORMANCE_KPI_KEYS = [
  "officeSupplies",
  "otherSales",
  "collection",
  "newCustomers",
  "repeatCustomers",
];

export const PERFORMANCE_KPI_LABELS = {
  officeSupplies: "Sales of office supplies",
  otherSales: "Others",
  collection: "Collection",
  newCustomers: "New customers",
  repeatCustomers: "Repeat customers",
};

const MONEY_KPI_KEYS = new Set(["officeSupplies", "otherSales", "collection", "sales"]);

export function isOfficeSuppliesSale(row = {}) {
  const text = [row.category, row.item_name, row.item_category, row.group]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!text) return false;
  const compact = text.replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
  return (
    /\boffice\b/.test(text)
    || /stationer/.test(text)
    || /officesuppl/.test(compact)
    || text.includes("قرطاس")
    || text.includes("مكتبي")
  );
}

export function splitSalesActuals(rows = []) {
  return (rows || []).reduce((totals, row) => {
    const amount = Number(row?.sales_amount || 0);
    if (!(amount > 0)) return totals;
    if (isOfficeSuppliesSale(row)) totals.officeSupplies += amount;
    else totals.otherSales += amount;
    return totals;
  }, { officeSupplies: 0, otherSales: 0 });
}

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
    officeSupplies: 0,
    otherSales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function emptyPerformanceTargets() {
  return {
    officeSupplies: 0,
    otherSales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function normalizePerformanceTargets(row = {}) {
  const officeSupplies = Number(
    row.officeSupplies
    ?? row.office_supplies_sales_target
    ?? row.office_supplies_target
    ?? 0,
  ) || 0;
  const otherSales = Number(
    row.otherSales
    ?? row.other_sales_target
    ?? 0,
  ) || 0;
  const legacySales = Number(row.sales ?? row.sales_target ?? 0) || 0;

  return {
    officeSupplies: officeSupplies || (otherSales ? 0 : legacySales),
    otherSales,
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

export const TEAM_PERFORMANCE_VIEW = "TEAM";

export function consolidatePerformanceSnapshots(snapshots = [], {
  reportDate,
  salesmanName = "Team",
} = {}) {
  const rows = (snapshots || []).filter(Boolean);
  const actuals = emptyPerformanceActuals();
  const targets = emptyPerformanceTargets();
  let latestUpdatedAt = null;
  let latestUpdatedByName = "";

  rows.forEach((row) => {
    PERFORMANCE_KPI_KEYS.forEach((key) => {
      actuals[key] += Number(row?.actuals?.[key] || 0);
      targets[key] += Number(row?.targets?.[key] || 0);
    });
    const updatedAt = row?.updatedAt || null;
    if (updatedAt && (!latestUpdatedAt || String(updatedAt) > String(latestUpdatedAt))) {
      latestUpdatedAt = updatedAt;
      latestUpdatedByName = row.updatedByName || "";
    }
  });

  return {
    ...buildPerformanceSnapshot({
      reportDate: reportDate || rows[0]?.reportDate,
      salesmanCode: TEAM_PERFORMANCE_VIEW,
      salesmanName,
      actuals,
      targets,
      updatedAt: latestUpdatedAt,
      updatedByName: latestUpdatedByName,
    }),
    isTeam: true,
    memberCount: rows.length,
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
  if (MONEY_KPI_KEYS.has(key)) {
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
