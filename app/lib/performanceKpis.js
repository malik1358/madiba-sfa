import { currentMonthDateRange } from "./salesInvoices.js";
import { KSA_TIMEZONE } from "./workdayActivity.js";

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

export const PERFORMANCE_DISPLAY_KPI_KEYS = [
  "officeSupplies",
  "otherSales",
  "totalSales",
  "collection",
  "newCustomers",
  "repeatCustomers",
];

export const PERFORMANCE_KPI_LABELS = {
  officeSupplies: "Sales of office supplies",
  otherSales: "Others",
  totalSales: "Total sales",
  collection: "Collection",
  newCustomers: "New customers",
  repeatCustomers: "Repeat customers",
};

const MONEY_KPI_KEYS = new Set(["officeSupplies", "otherSales", "totalSales", "collection", "sales"]);
const TARGET_FIELD_ALIASES = {
  officeSupplies: ["officeSupplies", "office_supplies_sales_target", "office_supplies_target"],
  otherSales: ["otherSales", "other_sales_target"],
};

function firstPresentNumber(row, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value == null || value === "") continue;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return null;
}

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

export function nextIsoDate(iso) {
  const date = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function isKsaWorkday(iso) {
  const date = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 5 && weekday !== 6;
}

export function resolveKpiPaceDate(monthDate, todayIso) {
  const month = currentMonthDateRange(monthDate);
  const today = String(todayIso || monthDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return month.from;
  if (today < month.from) return month.from;
  if (today > month.to) return month.to;
  return today;
}

export function monthProgressRatio(reportDate) {
  const date = String(reportDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const day = Number(date.slice(8, 10));
  const lastDay = Number(currentMonthDateRange(date).to.slice(8, 10));
  if (!day || !lastDay) return 0;
  return Math.min(1, Math.max(0, day / lastDay));
}

export function ksaWorkdayProgressRatio(asOfDate) {
  const date = String(asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const { from, to } = currentMonthDateRange(date);
  let workdays = 0;
  let elapsed = 0;
  for (let cursor = from; cursor <= to; cursor = nextIsoDate(cursor)) {
    if (!isKsaWorkday(cursor)) continue;
    workdays += 1;
    if (cursor <= date) elapsed += 1;
  }
  if (!workdays) return 0;
  return Math.min(1, Math.max(0, elapsed / workdays));
}

export function averageCumulativeDayShares(salesRows = []) {
  const months = new Map();
  (salesRows || []).forEach((row) => {
    const date = String(row?.transaction_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const amount = Number(row?.sales_amount || 0);
    if (!(amount > 0)) return;
    const month = date.slice(0, 7);
    const day = Number(date.slice(8, 10));
    let bucket = months.get(month);
    if (!bucket) {
      bucket = { total: 0, days: new Map() };
      months.set(month, bucket);
    }
    bucket.total += amount;
    bucket.days.set(day, (bucket.days.get(day) || 0) + amount);
  });

  const curves = [];
  months.forEach((bucket) => {
    if (!(bucket.total > 0) || !bucket.days.size) return;
    const lastDay = Math.max(...bucket.days.keys());
    let cumulative = 0;
    const shares = {};
    for (let day = 1; day <= lastDay; day += 1) {
      cumulative += bucket.days.get(day) || 0;
      shares[day] = cumulative / bucket.total;
    }
    curves.push(shares);
  });

  const result = {};
  for (let day = 1; day <= 31; day += 1) {
    const values = curves.map((curve) => curve[day]).filter((value) => value != null);
    if (values.length) {
      result[day] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }
  return { shares: result, monthCount: curves.length };
}

export function shareForDay(shares, day) {
  const goalDay = Number(day || 0);
  if (!shares || !goalDay) return null;
  for (let cursor = goalDay; cursor >= 1; cursor -= 1) {
    const value = shares[cursor];
    if (value != null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function expectedPacePercent(asOfDate, paceShares = null) {
  const date = String(asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const historical = shareForDay(paceShares, Number(date.slice(8, 10)));
  if (historical != null) return Math.min(100, Math.max(0, historical * 100));
  return ksaWorkdayProgressRatio(date) * 100;
}

export function achievementPercent(actual, target) {
  const goal = Number(target || 0);
  if (!(goal > 0)) return null;
  return (Number(actual || 0) / goal) * 100;
}

export function kpiStatus({
  actual,
  target,
  reportDate,
  todayIso,
  paceShares = null,
} = {}) {
  const achievement = achievementPercent(actual, target);
  if (achievement == null) {
    return {
      key: "no_target",
      label: "No target",
      tone: "neutral",
      expected: null,
      gap: null,
    };
  }

  const paceDate = resolveKpiPaceDate(reportDate, todayIso || reportDate);
  const expected = expectedPacePercent(paceDate, paceShares);
  const gap = achievement - expected;

  if (achievement >= 100) {
    return {
      key: "achieved",
      label: "Achieved",
      tone: "green",
      expected,
      gap,
    };
  }
  if (gap >= 1) {
    return {
      key: "ahead",
      label: `${gap.toFixed(1)}% ahead of pace`,
      tone: "orange",
      expected,
      gap,
    };
  }
  if (gap > -1) {
    return {
      key: "on_pace",
      label: "On pace",
      tone: "orange",
      expected,
      gap,
    };
  }
  return {
    key: "behind",
    label: `${Math.abs(gap).toFixed(1)}% behind pace`,
    tone: "red",
    expected,
    gap,
  };
}

export function emptyPerformanceActuals() {
  return {
    officeSupplies: 0,
    otherSales: 0,
    totalSales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function emptyPerformanceTargets() {
  return {
    officeSupplies: 0,
    otherSales: 0,
    totalSales: 0,
    collection: 0,
    newCustomers: 0,
    repeatCustomers: 0,
  };
}

export function withTotalSales(values = {}) {
  const officeSupplies = Number(values.officeSupplies || 0) || 0;
  const otherSales = Number(values.otherSales || 0) || 0;
  return {
    ...values,
    officeSupplies,
    otherSales,
    totalSales: officeSupplies + otherSales,
  };
}

export function normalizePerformanceTargets(row = {}) {
  const splitOffice = firstPresentNumber(row, TARGET_FIELD_ALIASES.officeSupplies);
  const splitOther = firstPresentNumber(row, TARGET_FIELD_ALIASES.otherSales);
  const hasSplitSales = splitOffice != null || splitOther != null;
  const officeSupplies = hasSplitSales ? (splitOffice || 0) : 0;
  const otherSales = hasSplitSales ? (splitOther || 0) : 0;
  const splitTotal = officeSupplies + otherSales;

  return {
    officeSupplies,
    otherSales,
    totalSales: splitTotal > 0 ? splitTotal : (Number(row.totalSales ?? row.sales ?? row.sales_target ?? 0) || 0),
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
  todayIso,
  paceShares = null,
} = {}) {
  const achievement = achievementPercent(actual, target);
  const status = kpiStatus({ actual, target, reportDate, todayIso, paceShares });
  return {
    key,
    label: PERFORMANCE_KPI_LABELS[key] || key,
    actual: Number(actual || 0) || 0,
    target: Number(target || 0) || 0,
    achievement,
    expected: status.expected,
    paceGap: status.gap,
    status,
  };
}

export const TEAM_PERFORMANCE_VIEW = "TEAM";

export function consolidatePerformanceSnapshots(snapshots = [], {
  reportDate,
  salesmanName = "Team",
  todayIso,
  paceShares = null,
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
      todayIso: todayIso || rows[0]?.todayIso,
      paceShares: paceShares || rows[0]?.paceShares || null,
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
  todayIso,
  paceShares = null,
} = {}) {
  const normalizedTargets = normalizePerformanceTargets(targets);
  const normalizedActuals = withTotalSales({
    ...emptyPerformanceActuals(),
    ...actuals,
  });
  const kpis = PERFORMANCE_DISPLAY_KPI_KEYS.map((key) => buildPerformanceKpi(key, {
    actual: normalizedActuals[key],
    target: normalizedTargets[key],
    reportDate,
    todayIso,
    paceShares,
  }));
  const componentScored = kpis.filter((kpi) => kpi.key !== "totalSales" && kpi.achievement != null);
  const scored = componentScored.length
    ? componentScored
    : kpis.filter((kpi) => kpi.achievement != null);
  const hasTargets = kpis.some((kpi) => kpi.target > 0);
  const overall = scored.reduce((sum, kpi) => sum + Number(kpi.achievement || 0), 0)
    / Math.max(1, scored.length || 1);

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
    todayIso: todayIso || null,
    paceShares: paceShares || null,
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
    timeZone: KSA_TIMEZONE,
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
