import {
  PERFORMANCE_KPI_LABELS,
  formatAchievementPercent,
  formatPerformanceKpiValue,
} from "./performanceKpis.js";
import {
  buildFilteredPerformanceKpi,
  compareKpiActualToPriorMonth,
  compareKpiEstimateToPriorMonth,
  sumFilteredKpiColumns,
  sumFilteredKpiEstimateVsPriorMonth,
  sumFilteredKpiPaceEstimates,
} from "./kpiTargetsTable.js";
import { previousMonthKey } from "./categoryGrowth.js";
import { receivableDaysChangeTone } from "./receivableDays.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import { resolveAppOrigin } from "./inactivityEmail.js";

/** Footer rows from KPI Targets, emailed as columns after sales/receipt uploads. */
export const KPI_UPLOAD_SUMMARY_ROW_KEYS = [
  "totalFiltered",
  "paceEstimate",
  "vsLastMonth",
];

export const KPI_UPLOAD_SUMMARY_ROW_LABELS = {
  totalFiltered: "Total (filtered)",
  paceEstimate: "Estimated month-end sales",
  vsLastMonth: "vs last month",
};

/**
 * Match the KPI Targets footer columns the live page uses for upload summary:
 * Total sales, Collection (has a target), and Total cash collected (Collection + cash info).
 */
export const KPI_UPLOAD_SUMMARY_KPI_KEYS = [
  "totalSales",
  "collection",
  "totalCashCollected",
];

/** Company-wide DSO rows appended after the salesman KPI footer rows (same three views as BI). */
export const KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_KEY = "averageCollectionDays";
export const KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_LABEL = "Avg collection days (YTD)";
export const KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_VARIANTS = [
  {
    key: "averageCollectionDays",
    label: "Avg collection days (YTD)",
    field: "receivable_days",
    previousField: "previous_receivable_days",
    statusLabel: "Lower is better · YTD DSO",
  },
  {
    key: "averageCollectionDays3m",
    label: "Avg collection days (Rolling 3m)",
    field: "receivable_days_3m",
    previousField: "receivable_days_3m",
    usePriorMonthRow: true,
    statusLabel: "Lower is better · Rolling 3m DSO",
  },
  {
    key: "averageCollectionDays12m",
    label: "Avg collection days (Rolling 12m)",
    field: "receivable_days_12m",
    previousField: "receivable_days_12m",
    usePriorMonthRow: true,
    statusLabel: "Lower is better · Rolling 12m DSO",
  },
];

const COLLECTION_DAYS_KEYS = new Set(
  KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_VARIANTS.map((variant) => variant.key),
);

/** Company rolling 4-month active customers with MoM vs the prior complete month. */
export const KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_KEY = "activeCustomers";
export const KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_LABEL = "Active customers";

/** Trailing 120-day net sales in the Active Customers window vs end of last month. */
export const KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_KEY = "activeCustomersSales";
export const KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_LABEL = "Active customers sales (120d)";

export const KPI_UPLOAD_SUMMARY_PENDING_KEY = "kpi_upload_summary_email_pending_v1";
export const KPI_UPLOAD_SUMMARY_LAST_SENT_KEY = "kpi_upload_summary_email_last_sent";

/** Wait after the last sales/receipt upload before sending (debounce window). */
export const KPI_UPLOAD_SUMMARY_DEBOUNCE_MS = 18 * 60 * 1000;

export const DEFAULT_KPI_UPLOAD_SUMMARY_EMAIL_TO = "malik@pinasz.com";
export const DEFAULT_KPI_UPLOAD_SUMMARY_EMAIL_CC = "fazlur.rahiman@noorshukran.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = parseEmailList(defaults).filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras].filter((email) => isLikelyEmail(email)))];
}

export function resolveKpiUploadSummaryEmailRecipients(env = process.env) {
  const testTo = String(env.KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO || "").trim();
  if (testTo) return parseEmailList(testTo).filter((email) => isLikelyEmail(email));
  return mergeEmailList(
    DEFAULT_KPI_UPLOAD_SUMMARY_EMAIL_TO,
    env.KPI_UPLOAD_SUMMARY_EMAIL_TO,
  );
}

export function resolveKpiUploadSummaryEmailCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList(
    DEFAULT_KPI_UPLOAD_SUMMARY_EMAIL_CC,
    env.KPI_UPLOAD_SUMMARY_EMAIL_CC,
  ).filter((email) => !recipients.has(email.toLowerCase()));
}

export function buildKpiUploadSummaryReportUrl(env = process.env) {
  return `${resolveAppOrigin(env).replace(/\/+$/, "")}/management/kpi-targets`;
}

export function buildKpiUploadSummaryActiveCustomersReportUrl(env = process.env) {
  return `${resolveAppOrigin(env).replace(/\/+$/, "")}/management/active-customers`;
}

export function nextKpiUploadSummarySendAfter(now = new Date(), debounceMs = KPI_UPLOAD_SUMMARY_DEBOUNCE_MS) {
  const base = now instanceof Date ? now : new Date(now);
  const ms = Math.max(60_000, Number(debounceMs) || KPI_UPLOAD_SUMMARY_DEBOUNCE_MS);
  return new Date(base.getTime() + ms).toISOString();
}

export function mergeKpiUploadSummaryPending(previous = {}, {
  trigger = "",
  now = new Date(),
  debounceMs = KPI_UPLOAD_SUMMARY_DEBOUNCE_MS,
} = {}) {
  const triggers = [...new Set([
    ...(Array.isArray(previous?.triggers) ? previous.triggers : []),
    String(trigger || "").trim(),
  ].filter(Boolean))];
  const uploadedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    pending: true,
    lastUploadAt: uploadedAt,
    sendAfter: nextKpiUploadSummarySendAfter(now, debounceMs),
    triggers,
  };
}

export function isKpiUploadSummaryDue(pending, now = new Date()) {
  if (!pending || pending.pending !== true) return false;
  const sendAfter = Date.parse(String(pending.sendAfter || ""));
  if (!Number.isFinite(sendAfter)) return false;
  const when = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return when >= sendAfter;
}

/**
 * KPI Targets page stores targets as flat row fields; API snapshots keep them
 * under `targets`. Normalize so footer totals match the on-screen table.
 */
export function withFlatKpiTargets(row = {}) {
  const targets = row?.targets && typeof row.targets === "object" ? row.targets : {};
  const pick = (key) => (
    row?.[key] != null && row[key] !== ""
      ? row[key]
      : (targets[key] ?? 0)
  );
  return {
    ...row,
    officeSupplies: pick("officeSupplies"),
    localItemSales: pick("localItemSales"),
    otherSales: pick("otherSales"),
    totalSales: pick("totalSales"),
    collection: pick("collection"),
    newCustomers: pick("newCustomers"),
    repeatCustomers: pick("repeatCustomers"),
  };
}

/**
 * MoM comparison for average collection days (YTD DSO).
 * Lower days is improvement: direction "up" = improving (green), "down" = getting worse.
 */
export function compareAverageCollectionDaysToPriorMonth(currentDays, previousDays) {
  if (currentDays == null || currentDays === "") return null;
  const value = Number(currentDays);
  if (!Number.isFinite(value)) return null;
  if (previousDays == null || previousDays === "") {
    return {
      estimate: value,
      priorActual: null,
      delta: null,
      percent: null,
      direction: "flat",
      polarity: "lower-is-better",
    };
  }
  const prior = Number(previousDays);
  if (!Number.isFinite(prior)) {
    return {
      estimate: value,
      priorActual: null,
      delta: null,
      percent: null,
      direction: "flat",
      polarity: "lower-is-better",
    };
  }
  const delta = Math.round((value - prior) * 10) / 10;
  const percent = prior > 0
    ? (delta / prior) * 100
    : (value === 0 ? 0 : null);
  const tone = receivableDaysChangeTone(value, prior);
  return {
    estimate: value,
    priorActual: prior,
    delta,
    percent,
    direction: tone === "up" || tone === "down" ? tone : "flat",
    polarity: "lower-is-better",
  };
}

function latestReceivableMonthRow(report = null) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return [...rows].reverse().find((row) => (
    row?.receivable_days != null
    || row?.receivable_days_3m != null
    || row?.receivable_days_12m != null
  )) || null;
}

function priorReceivableMonthRow(report = null, monthKey = "") {
  const priorMonth = previousMonthKey(monthKey);
  if (!priorMonth) return null;
  const monthly = report?.monthly && typeof report.monthly === "object" ? report.monthly : null;
  if (monthly?.[priorMonth]) return monthly[priorMonth];
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.find((row) => String(row?.month || "").slice(0, 7) === priorMonth) || null;
}

/**
 * Build one company Avg collection days email row (YTD / 3m / 12m) from the BI report.
 */
export function buildAverageCollectionDaysSummaryRow(report = null, variant = KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_VARIANTS[0]) {
  const config = variant && typeof variant === "object"
    ? variant
    : KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_VARIANTS[0];
  const latest = latestReceivableMonthRow(report);
  if (!latest) return null;
  const currentRaw = latest[config.field];
  if (currentRaw == null || currentRaw === "") return null;
  const currentDays = Number(currentRaw);
  if (!Number.isFinite(currentDays)) return null;

  let previousDays = null;
  if (config.usePriorMonthRow) {
    const priorRow = priorReceivableMonthRow(report, latest.month);
    const priorRaw = priorRow?.[config.previousField];
    previousDays = priorRaw == null || priorRaw === "" ? null : priorRaw;
  } else if (Object.prototype.hasOwnProperty.call(latest, config.previousField)) {
    previousDays = latest[config.previousField];
  }

  return {
    key: config.key,
    label: config.label,
    kind: "collectionDays",
    month: String(latest.month || "").slice(0, 7),
    totalFiltered: {
      actual: currentDays,
      target: 0,
      achievement: null,
      statusLabel: config.statusLabel,
      statusTone: "neutral",
    },
    paceEstimate: {
      estimate: null,
      target: 0,
      achievement: null,
    },
    vsLastMonth: compareAverageCollectionDaysToPriorMonth(currentDays, previousDays),
  };
}

/**
 * Build all three company Avg collection days rows (YTD, rolling 3m, rolling 12m).
 */
export function buildAverageCollectionDaysSummaryRows(report = null) {
  return KPI_UPLOAD_SUMMARY_COLLECTION_DAYS_VARIANTS
    .map((variant) => buildAverageCollectionDaysSummaryRow(report, variant))
    .filter(Boolean);
}

/**
 * MoM for active customers (rolling 4-month distinct buyers).
 * Higher count is better: direction "up" = growing (green).
 */
export function compareActiveCustomersToPriorMonth(currentCount, previousCount) {
  const comparison = compareKpiActualToPriorMonth(currentCount, previousCount);
  if (!comparison) return null;
  return {
    ...comparison,
    polarity: "higher-is-better",
  };
}

/**
 * Build the company Active customers email row from the Active Customers report.
 * Uses the latest complete KSA month vs the month before (same MoM as the report cards).
 */
export function buildActiveCustomersSummaryRow(report = null) {
  const company = report?.company;
  const latestCompleteMonth = String(report?.latestCompleteMonth || "").slice(0, 7);
  if (!company || !/^\d{4}-\d{2}$/.test(latestCompleteMonth)) return null;

  const currentCount = Number(
    company.monthValues?.[latestCompleteMonth] ?? company.latestCompleteCount ?? 0,
  );
  if (!Number.isFinite(currentCount)) return null;

  const priorCompleteMonth = String(report?.priorCompleteMonth || previousMonthKey(latestCompleteMonth) || "").slice(0, 7);
  const priorRaw = priorCompleteMonth
    ? company.monthValues?.[priorCompleteMonth]
    : null;
  const priorCount = priorRaw == null || priorRaw === ""
    ? null
    : Number(priorRaw);

  return {
    key: KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_KEY,
    label: KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_LABEL,
    kind: "activeCustomers",
    month: latestCompleteMonth,
    totalFiltered: {
      actual: currentCount,
      target: 0,
      achievement: null,
      statusLabel: "Higher is better · 4-month active",
      statusTone: "neutral",
    },
    paceEstimate: {
      estimate: null,
      target: 0,
      achievement: null,
    },
    vsLastMonth: compareActiveCustomersToPriorMonth(
      currentCount,
      Number.isFinite(priorCount) ? priorCount : null,
    ),
  };
}

/**
 * MoM for trailing 120-day Active Customers net sales.
 * Higher sales is better: direction "up" = growing (green).
 */
export function compareActiveCustomersSalesToPriorMonth(currentSales, previousSales) {
  const comparison = compareKpiActualToPriorMonth(currentSales, previousSales);
  if (!comparison) return null;
  return {
    ...comparison,
    polarity: "higher-is-better",
  };
}

/**
 * Build the company Active customers sales email row.
 * Total = trailing 120-day net sales as of today (open month).
 * vs last month = the same 120-day window ending on the last day of the previous complete month.
 */
export function buildActiveCustomersSalesSummaryRow(report = null) {
  const company = report?.company;
  const currentMonth = String(report?.currentMonth || "").slice(0, 7);
  const latestCompleteMonth = String(report?.latestCompleteMonth || "").slice(0, 7);
  if (!company || !/^\d{4}-\d{2}$/.test(latestCompleteMonth)) return null;

  const openMonth = /^\d{4}-\d{2}$/.test(currentMonth) ? currentMonth : latestCompleteMonth;
  const useOpenMonth = openMonth !== latestCompleteMonth;

  const currentSales = Number(
    useOpenMonth
      ? (company.currentSales ?? company.monthSales?.[openMonth] ?? 0)
      : (company.monthSales?.[latestCompleteMonth] ?? company.latestCompleteSales ?? 0),
  );
  if (!Number.isFinite(currentSales)) return null;

  const priorMonth = useOpenMonth
    ? latestCompleteMonth
    : String(report?.priorCompleteMonth || previousMonthKey(latestCompleteMonth) || "").slice(0, 7);
  const priorRaw = priorMonth
    ? (
      useOpenMonth
        ? (company.latestCompleteSales ?? company.monthSales?.[priorMonth])
        : company.monthSales?.[priorMonth]
    )
    : null;
  const priorSales = priorRaw == null || priorRaw === ""
    ? null
    : Number(priorRaw);

  return {
    key: KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_KEY,
    label: KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_LABEL,
    kind: "activeCustomersSales",
    month: openMonth,
    totalFiltered: {
      actual: currentSales,
      target: 0,
      achievement: null,
      statusLabel: "Higher is better · 120-day sales",
      statusTone: "neutral",
    },
    paceEstimate: {
      estimate: null,
      target: 0,
      achievement: null,
    },
    vsLastMonth: compareActiveCustomersSalesToPriorMonth(
      currentSales,
      Number.isFinite(priorSales) ? priorSales : null,
    ),
  };
}

/**
 * Active customers count + trailing 120-day sales rows for the KPI upload email.
 */
export function buildActiveCustomersSummaryRows(report = null) {
  return [
    buildActiveCustomersSummaryRow(report),
    buildActiveCustomersSalesSummaryRow(report),
  ].filter(Boolean);
}

/**
 * Build the three KPI Targets footer summaries, then transpose so those row
 * labels become email columns (one email row per KPI). Optionally append
 * company Avg collection days for YTD, rolling 3m, and rolling 12m DSO with
 * MoM improve/worsen on each, and company Active customers count + 120-day sales with MoM.
 */
export function buildKpiUploadSummaryTable({
  rows = [],
  columns = KPI_UPLOAD_SUMMARY_KPI_KEYS,
  reportDate,
  todayIso,
  salesAsOfDate,
  receiptAsOfDate,
  priorMonth = "",
  priorMonthActualsByCode = {},
  receivableDaysReport = null,
  activeCustomersReport = null,
} = {}) {
  const people = (rows || []).filter((row) => !row?.isTeam).map(withFlatKpiTargets);
  const totals = sumFilteredKpiColumns(people, columns);
  const estimates = sumFilteredKpiPaceEstimates(people, columns, {
    reportDate,
    todayIso,
    salesAsOfDate,
    receiptAsOfDate,
  });
  const vsPrior = sumFilteredKpiEstimateVsPriorMonth(
    people,
    columns,
    estimates,
    priorMonthActualsByCode,
  );

  const tableRows = (columns || []).map((key) => {
    const total = totals[key] || { actual: 0, target: 0, achievement: null };
    const estimate = estimates[key] || { estimate: null, target: 0, achievement: null };
    const liveKpi = buildFilteredPerformanceKpi(key, {
      actual: total.actual,
      target: total.target,
      estimate: estimate.estimate,
      reportDate,
      todayIso,
      salesAsOfDate,
      receiptAsOfDate,
    });
    const comparison = vsPrior[key] || compareKpiEstimateToPriorMonth(null, 0);
    return {
      key,
      label: PERFORMANCE_KPI_LABELS[key] || key,
      totalFiltered: {
        actual: total.actual,
        target: total.target,
        achievement: total.achievement,
        statusLabel: liveKpi.status?.label || "No target",
        statusTone: liveKpi.status?.tone || "neutral",
      },
      paceEstimate: {
        estimate: estimate.estimate,
        target: estimate.target,
        achievement: estimate.achievement,
      },
      vsLastMonth: comparison,
    };
  });

  tableRows.push(...buildAverageCollectionDaysSummaryRows(receivableDaysReport));
  tableRows.push(...buildActiveCustomersSummaryRows(activeCustomersReport));

  return {
    salesmanCount: people.length,
    priorMonth: String(priorMonth || "").slice(0, 7),
    reportDate: String(reportDate || "").slice(0, 10),
    salesAsOfDate: String(salesAsOfDate || "").slice(0, 10),
    receiptAsOfDate: String(receiptAsOfDate || "").slice(0, 10),
    columns: KPI_UPLOAD_SUMMARY_ROW_KEYS.map((key) => ({
      key,
      label: KPI_UPLOAD_SUMMARY_ROW_LABELS[key],
    })),
    rows: tableRows,
  };
}

export function kpiUploadSummarySignature(summary) {
  const parts = (summary?.rows || []).map((row) => {
    const total = row.totalFiltered || {};
    const pace = row.paceEstimate || {};
    const vs = row.vsLastMonth || {};
    return [
      row.key,
      Number(total.actual || 0).toFixed(2),
      Number(total.target || 0).toFixed(2),
      pace.estimate == null ? "" : Number(pace.estimate).toFixed(2),
      vs.delta == null ? "" : Number(vs.delta).toFixed(2),
    ].join(":");
  });
  return [
    String(summary?.reportDate || ""),
    String(summary?.salesmanCount || 0),
    ...parts,
  ].join("|");
}

function toneColor(tone) {
  if (tone === "green") return "#15803d";
  if (tone === "red") return "#b91c1c";
  if (tone === "orange") return "#c2410c";
  return "#475569";
}

function toneBackground(tone) {
  if (tone === "green") return "#dcfce7";
  if (tone === "red") return "#fee2e2";
  if (tone === "orange") return "#ffedd5";
  return "#e2e8f0";
}

function isCollectionDaysRow(row) {
  return COLLECTION_DAYS_KEYS.has(row?.key) || row?.kind === "collectionDays";
}

function isActiveCustomersRow(row) {
  return row?.key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_KEY || row?.kind === "activeCustomers";
}

function isActiveCustomersSalesRow(row) {
  return row?.key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_KEY || row?.kind === "activeCustomersSales";
}

function isActiveCustomersFamilyRow(row) {
  return isActiveCustomersRow(row) || isActiveCustomersSalesRow(row);
}

function isInfoOnlySummaryRow(row) {
  return isCollectionDaysRow(row) || isActiveCustomersFamilyRow(row);
}

function formatCollectionDaysValue(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const text = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return `${text} days`;
}

function formatActiveCustomersValue(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const count = Math.round(Number(value));
  const text = count.toLocaleString("en-SA");
  return `${text} customer${count === 1 ? "" : "s"}`;
}

function formatActiveCustomersSalesValue(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  return formatPerformanceKpiValue("totalSales", value);
}

function formatSignedMoney(key, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (COLLECTION_DAYS_KEYS.has(key)) {
    const abs = formatCollectionDaysValue(Math.abs(number));
    if (number > 0) return `+${abs}`;
    if (number < 0) return `−${abs}`;
    return abs;
  }
  if (key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_KEY) {
    const abs = formatActiveCustomersValue(Math.abs(number));
    if (number > 0) return `+${abs}`;
    if (number < 0) return `−${abs}`;
    return abs;
  }
  if (key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_KEY) {
    const abs = formatActiveCustomersSalesValue(Math.abs(number));
    if (number > 0) return `+${abs}`;
    if (number < 0) return `−${abs}`;
    return abs;
  }
  const abs = formatPerformanceKpiValue(key, Math.abs(number));
  if (number > 0) return `+${abs}`;
  if (number < 0) return `−${abs}`;
  return abs;
}

function formatKpiCellValue(key, value) {
  if (COLLECTION_DAYS_KEYS.has(key)) return formatCollectionDaysValue(value);
  if (key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_KEY) return formatActiveCustomersValue(value);
  if (key === KPI_UPLOAD_SUMMARY_ACTIVE_CUSTOMERS_SALES_KEY) return formatActiveCustomersSalesValue(value);
  return formatPerformanceKpiValue(key, value);
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const abs = `${Math.abs(number).toFixed(0)}%`;
  if (number > 0) return `+${abs}`;
  if (number < 0) return `−${abs}`;
  return abs;
}

function vsLastMonthDirectionLabel(cell) {
  if (!cell) return "same as last month";
  if (cell.polarity === "lower-is-better") {
    if (cell.direction === "up") return "improving vs last month";
    if (cell.direction === "down") return "getting worse vs last month";
    return "same as last month";
  }
  if (cell.polarity === "higher-is-better") {
    if (cell.direction === "up") return "growing vs last month";
    if (cell.direction === "down") return "shrinking vs last month";
    return "same as last month";
  }
  if (cell.direction === "up") return "higher than last month";
  if (cell.direction === "down") return "lower than last month";
  return "same as last month";
}

function infoOnlyAsOfLabel(row) {
  if (isCollectionDaysRow(row)) {
    return row.month ? `As of ${row.month}` : "Company YTD DSO";
  }
  if (isActiveCustomersRow(row)) {
    return row.month ? `As of ${row.month}` : "Rolling 4-month active";
  }
  if (isActiveCustomersSalesRow(row)) {
    return row.month ? `As of ${row.month}` : "Trailing 120-day sales";
  }
  return "Information only";
}

function totalFilteredHtml(row) {
  const cell = row.totalFiltered || {};
  const actual = formatKpiCellValue(row.key, cell.actual);
  const hasTarget = Number(cell.target) > 0;
  const target = hasTarget
    ? formatKpiCellValue(row.key, cell.target)
    : "—";
  const achievement = formatAchievementPercent(cell.achievement);
  const status = String(cell.statusLabel || "No target");
  const infoLine = escapeHtml(infoOnlyAsOfLabel(row));
  return `
    <div style="font-weight:700;font-size:15px;color:#0f4c5c;">${escapeHtml(actual)}</div>
    ${hasTarget ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">Target ${escapeHtml(target)}</div>
    <div style="margin-top:4px;">${escapeHtml(achievement)} of target</div>` : `<div style="color:#64748b;font-size:12px;margin-top:2px;">${infoLine}</div>`}
    <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:${toneBackground(cell.statusTone)};color:${toneColor(cell.statusTone)};font-size:11px;font-weight:600;">
      ${escapeHtml(status)}
    </div>
  `;
}

function paceEstimateHtml(row) {
  const cell = row.paceEstimate || {};
  if (isInfoOnlySummaryRow(row)) {
    return `
      <div style="color:#94a3b8;">—</div>
      <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:#e2e8f0;color:#475569;font-size:11px;font-weight:600;">
        No pace estimate
      </div>
    `;
  }
  if (cell.estimate == null) {
    return `<div style="color:#94a3b8;">—</div>`;
  }
  const estimate = formatKpiCellValue(row.key, cell.estimate);
  const hasTarget = Number(cell.target) > 0;
  const achievement = formatAchievementPercent(cell.achievement);
  return `
    <div style="font-weight:700;font-size:15px;color:#0f4c5c;">${escapeHtml(estimate)}</div>
    ${hasTarget ? `<div style="margin-top:4px;">${escapeHtml(achievement)} of target</div>` : ""}
    <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:#ffedd5;color:#c2410c;font-size:11px;font-weight:600;">
      Estimated month-end sales
    </div>
  `;
}

function vsLastMonthHtml(row, priorMonth) {
  const cell = row.vsLastMonth;
  if (!cell) {
    return `<div style="color:#94a3b8;">—</div>`;
  }
  const color = cell.direction === "up"
    ? "#15803d"
    : (cell.direction === "down" ? "#b91c1c" : "#475569");
  const directionLabel = vsLastMonthDirectionLabel(cell);
  const comparisonMonth = isInfoOnlySummaryRow(row) && row.month
    ? previousMonthKey(row.month)
    : priorMonth;
  const priorLabel = comparisonMonth ? ` (${escapeHtml(comparisonMonth)})` : "";
  const priorValue = cell.priorActual == null
    ? "—"
    : formatKpiCellValue(row.key, cell.priorActual);
  return `
    <div style="font-weight:700;font-size:15px;color:${color};">${escapeHtml(formatSignedMoney(row.key, cell.delta))}</div>
    <div style="color:#64748b;font-size:12px;margin-top:2px;">
      last month${priorLabel}: ${escapeHtml(priorValue)}
    </div>
    <div style="margin-top:4px;font-weight:700;color:${color};">${escapeHtml(formatSignedPercent(cell.percent))}</div>
    <div style="color:#64748b;font-size:12px;">${escapeHtml(directionLabel)}</div>
  `;
}

function totalFilteredText(row) {
  const cell = row.totalFiltered || {};
  const hasTarget = Number(cell.target) > 0;
  return [
    formatKpiCellValue(row.key, cell.actual),
    hasTarget
      ? `target ${formatKpiCellValue(row.key, cell.target)}`
      : infoOnlyAsOfLabel(row).toLowerCase(),
    hasTarget ? `${formatAchievementPercent(cell.achievement)} of target` : null,
    cell.statusLabel || "No target",
  ].filter(Boolean).join("; ");
}

function paceEstimateText(row) {
  if (isInfoOnlySummaryRow(row)) return "—; No pace estimate";
  const cell = row.paceEstimate || {};
  if (cell.estimate == null) return "—";
  const hasTarget = Number(cell.target) > 0;
  return [
    formatKpiCellValue(row.key, cell.estimate),
    hasTarget ? `${formatAchievementPercent(cell.achievement)} of target` : null,
    "Estimated month-end sales",
  ].filter(Boolean).join("; ");
}

function vsLastMonthText(row, priorMonth) {
  const cell = row.vsLastMonth;
  if (!cell) return "—";
  const directionLabel = vsLastMonthDirectionLabel(cell);
  const comparisonMonth = isInfoOnlySummaryRow(row) && row.month
    ? previousMonthKey(row.month)
    : priorMonth;
  const priorValue = cell.priorActual == null
    ? "—"
    : formatKpiCellValue(row.key, cell.priorActual);
  return [
    formatSignedMoney(row.key, cell.delta),
    `last month${comparisonMonth ? ` (${comparisonMonth})` : ""}: ${priorValue}`,
    formatSignedPercent(cell.percent),
    directionLabel,
  ].join("; ");
}

export function buildKpiUploadSummaryEmail({
  summary,
  trigger = "",
  triggers = [],
  env = process.env,
} = {}) {
  const month = String(summary?.reportDate || "").slice(0, 7);
  const reportUrl = buildKpiUploadSummaryReportUrl(env);
  const activeCustomersUrl = buildKpiUploadSummaryActiveCustomersReportUrl(env);
  const triggerList = [...new Set([
    ...(Array.isArray(triggers) ? triggers : []),
    String(trigger || "").trim(),
  ].filter(Boolean))];
  const subject = `KPI Targets summary — ${month || "current month"} — after upload`;

  const headerCells = [
    `<th style="padding:10px 8px;border:1px solid #0a3a45;text-align:left;">KPI</th>`,
    ...KPI_UPLOAD_SUMMARY_ROW_KEYS.map((key) => (
      `<th style="padding:10px 8px;border:1px solid #0a3a45;text-align:left;">${escapeHtml(KPI_UPLOAD_SUMMARY_ROW_LABELS[key])}</th>`
    )),
  ].join("");

  const bodyRows = (summary?.rows || []).map((row, index) => {
    const bg = index % 2 === 0 ? "#ffffff" : "#f0f7f8";
    return `<tr style="background:${bg};">
      <td style="padding:10px 8px;border:1px solid #d7e3ea;vertical-align:top;font-weight:700;color:#0f4c5c;">${escapeHtml(row.label)}</td>
      <td style="padding:10px 8px;border:1px solid #d7e3ea;vertical-align:top;">${totalFilteredHtml(row)}</td>
      <td style="padding:10px 8px;border:1px solid #d7e3ea;vertical-align:top;">${paceEstimateHtml(row)}</td>
      <td style="padding:10px 8px;border:1px solid #d7e3ea;vertical-align:top;">${vsLastMonthHtml(row, summary?.priorMonth)}</td>
    </tr>`;
  }).join("");

  const metaBits = [
    summary?.salesmanCount != null ? `${summary.salesmanCount} salesman` : "",
    summary?.salesAsOfDate ? `Last sales date ${summary.salesAsOfDate}` : "",
    summary?.receiptAsOfDate ? `Last receipt date ${summary.receiptAsOfDate}` : "",
    triggerList.length ? `Uploads: ${triggerList.join(", ")}` : "",
  ].filter(Boolean);

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#12263f;line-height:1.4;background:#f8fafc;padding:16px;">
  <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #d7e3ea;border-radius:12px;padding:18px;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#0f4c5c;">KPI Targets summary</h1>
    <p style="margin:0 0 12px;color:#475569;font-size:13px;">${escapeHtml(metaBits.join(" · "))}</p>
    <p style="margin:0 0 14px;font-size:13px;">Footer rows from KPI Targets (plus company Avg collection days: YTD, Rolling 3m, Rolling 12m, Active customers, and Active customers sales (120d)), transposed so Total / Estimate / vs last month are columns. Lower collection days is better; higher active customers and 120-day sales are better.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr style="background:#0f4c5c;color:#ffffff;">${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="4" style="padding:12px;border:1px solid #d7e3ea;">No KPI rows.</td></tr>`}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:12px;">
      <a href="${escapeHtml(reportUrl)}" style="color:#0f4c5c;">Open KPI Targets</a>
      ·
      <a href="${escapeHtml(activeCustomersUrl)}" style="color:#0f4c5c;">Open Active Customers</a>
    </p>
  </div>
</body></html>`;

  const textRows = (summary?.rows || []).map((row) => [
    row.label,
    `  Total (filtered): ${totalFilteredText(row)}`,
    `  Estimated month-end sales: ${paceEstimateText(row)}`,
    `  vs last month: ${vsLastMonthText(row, summary?.priorMonth)}`,
  ].join("\n"));

  return {
    subject,
    html,
    text: [
      `KPI Targets summary — ${month || "current month"}`,
      metaBits.join(" | "),
      "",
      ...textRows,
      "",
      reportUrl,
      activeCustomersUrl,
    ].join("\n"),
  };
}
