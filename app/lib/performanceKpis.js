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

const HISTORICAL_KPI_KEYS = [
  "officeSupplies",
  "otherSales",
  "collection",
  "newCustomers",
  "repeatCustomers",
];

// Minimum share of a KPI's monthly total that must appear before day 1 of the
// current month before we trust an individual pace curve. Guards against
// dividing by near-zero historical values (e.g. one big early-month sale).
const MIN_PACE_BASELINE_SHARE = 0.02;

// Monthly totals per KPI from historical rows (full months only).
export function summarizeHistoricalMonth(rows = [], {
  priorCustomerCodes = [],
} = {}) {
  const split = splitSalesActuals(rows);
  const classified = classifyBuyingCustomers(
    buyingCustomerCodesFromSales(rows),
    priorCustomerCodes,
  );
  return normalizeHistoricalMonthTotals({
    officeSupplies: split.officeSupplies,
    otherSales: split.otherSales,
    collection: sumCollectionAmount(rows),
    newCustomers: classified.newCustomers,
    repeatCustomers: classified.repeatCustomers,
  });
}

// Cumulative totals keyed by day-of-month (1-based) from dated rows.
export function cumulativeByDay(rows = [], dateField = "transaction_date") {
  const daily = new Map();
  (rows || []).forEach((row) => {
    const raw = String(row?.[dateField] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    const day = Number(raw.slice(8, 10));
    if (!day) return;
    daily.set(day, (daily.get(day) || 0) + Number(row?.amount ?? row?.sales_amount ?? 0));
  });
  const sortedDays = [...daily.keys()].sort((left, right) => left - right);
  const maxDay = sortedDays.length ? sortedDays[sortedDays.length - 1] : 0;
  const cumulative = [];
  let running = 0;
  for (let day = 1; day <= maxDay; day += 1) {
    running += daily.get(day) || 0;
    cumulative.push(running);
  }
  return cumulative;
}

export function normalizeHistoricalMonthTotals(totalsByKpi) {
  const normalized = {};
  HISTORICAL_KPI_KEYS.forEach((key) => {
    const value = Number(totalsByKpi?.[key] || 0);
    normalized[key] = value > 0 ? value : 0;
  });
  return normalized;
}

// Builds per-KPI cumulative daily share curves from trailing months of history.
// Each entry answers: "of everything this salesman closed in a full month, what
// share had landed by day D?" — capturing personal pacing (early vs late
// closers) instead of a raw calendar fraction. A month's `dailyCumulative` may
// be either a single array (when the month object represents one KPI) or an
// object keyed by KPI.
export function buildPaceCurveFromHistory(months = []) {
  const usableMonths = (months || []).filter((month) => Number(month?.mtdDays || 0) > 0);
  const perKpi = {};
  HISTORICAL_KPI_KEYS.forEach((key) => {
    let baselineTotal = 0;
    const weightedSums = new Map();
    usableMonths.forEach((month) => {
      const daysInMonth = Number(month?.daysInMonth || 0);
      const mtdDays = Math.min(Number(month.mtdDays || 0), daysInMonth || Number.MAX_SAFE_INTEGER);
      const total = Number(month?.totals?.[key] || 0);
      if (!daysInMonth || !mtdDays || !(total > 0)) return;
      const rawCurve = Array.isArray(month?.dailyCumulative)
        ? month.dailyCumulative
        : month?.dailyCumulative?.[key];
      if (!Array.isArray(rawCurve)) return;
      baselineTotal += total;
      for (let day = 1; day <= mtdDays; day += 1) {
        const reached = Number(rawCurve[day - 1] || 0);
        const share = Math.min(1, Math.max(0, reached / total));
        weightedSums.set(day, (weightedSums.get(day) || 0) + share);
      }
    });
    const points = [];
    for (let day = 1; day <= 31; day += 1) {
      const sum = weightedSums.get(day);
      if (sum != null) points.push({ day, share: sum / usableMonths.length });
    }
    perKpi[key] = { points, baselineTotal };
  });
  return { monthsUsed: usableMonths.length, perKpi };
}

// Resolves the expected achievement percent at the current day of month.
// Priority: individual last-3-months pace → team-average pace → calendar pace.
// New joiners without history fall back to the team average when available,
// otherwise to the plain calendar pace so they are not marked behind unfairly.
export function resolveExpectedProgress({
  kpiKey,
  reportDate,
  paceCurve,
  teamPaceCurve,
}) {
  const calendarShare = monthProgressRatio(reportDate);
  const dateText = String(reportDate || "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? (Number(dateText.slice(8, 10)) || 1) : 1;
  const pickShare = (curve) => {
    const entry = curve?.perKpi?.[kpiKey];
    if (!entry) return null;
    if (entry.baselineTotal < MIN_PACE_BASELINE_SHARE) return null;
    let best = null;
    entry.points.forEach((point) => {
      if (point.day <= day && (best == null || point.day > best.day)) best = point;
    });
    if (best == null) return null;
    if (best.share <= 0) return null;
    return Math.min(1, Math.max(0, best.share));
  };
  const individualShare = pickShare(paceCurve);
  if (individualShare != null) {
    return { share: individualShare, source: "individual" };
  }
  const teamShare = pickShare(teamPaceCurve);
  if (teamShare != null) {
    return { share: teamShare, source: "team" };
  }
  return { share: calendarShare, source: "calendar" };
}

export function kpiStatus({ actual, target, reportDate, expectedProgress }) {
  const achievement = achievementPercent(actual, target);
  if (achievement == null) {
    return { key: "no_target", label: "No target", tone: "neutral" };
  }
  if (achievement >= 100) {
    return { key: "achieved", label: "Achieved", tone: "green" };
  }
  const expected = (expectedProgress?.share ?? monthProgressRatio(reportDate)) * 100;
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

export function buildPerformanceKpi(key, {
  actual = 0,
  target = 0,
  reportDate,
  paceCurve = null,
  teamPaceCurve = null,
} = {}) {
  const achievement = achievementPercent(actual, target);
  const expectedProgress = resolveExpectedProgress({
    kpiKey: key,
    reportDate,
    paceCurve,
    teamPaceCurve,
  });
  const status = kpiStatus({ actual, target, reportDate, expectedProgress });
  return {
    key,
    label: PERFORMANCE_KPI_LABELS[key] || key,
    actual: Number(actual || 0) || 0,
    target: Number(target || 0) || 0,
    achievement,
    expectedProgress,
    expectedAtPace: expectedProgress.share > 0 && Number(target || 0) > 0
      ? expectedProgress.share * Number(target)
      : null,
    paceSource: expectedProgress.source,
    status,
  };
}

export const TEAM_PERFORMANCE_VIEW = "TEAM";

export function consolidatePerformanceSnapshots(snapshots = [], {
  reportDate,
  salesmanName = "Team",
  teamPaceCurve = null,
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
      teamPaceCurve,
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
  paceCurve = null,
  teamPaceCurve = null,
  historyMonthsUsed = 0,
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
    paceCurve,
    teamPaceCurve,
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
    // Attached so team consolidation can rebuild an average pace curve from
    // member snapshots; harmless extra field for standalone use.
    paceCurve: paceCurve || null,
    historyMonthsUsed: Number(historyMonthsUsed || 0) || 0,
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
  const expected = kpi.expectedAtPace != null
    ? ` — expected at pace ${formatPerformanceKpiValue(kpi.key, kpi.expectedAtPace)} (${kpi.paceSource || "calendar"})`
    : "";
  return `${kpi.label}: ${actual} / ${target} (${achievement}) — ${kpi.status?.label || "No target"}${expected}`;
}
