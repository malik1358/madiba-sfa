import {
  PERFORMANCE_KPI_LABELS,
  buildPerformanceKpi,
  formatAchievementPercent,
  formatPerformanceKpiValue,
} from "./performanceKpis.js";
import {
  compareKpiEstimateToPriorMonth,
  sumFilteredKpiColumns,
  sumFilteredKpiEstimateVsPriorMonth,
  sumFilteredKpiPaceEstimates,
} from "./kpiTargetsTable.js";
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
  paceEstimate: "Estimate at current pace",
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

export const KPI_UPLOAD_SUMMARY_PENDING_KEY = "kpi_upload_summary_email_pending_v1";
export const KPI_UPLOAD_SUMMARY_LAST_SENT_KEY = "kpi_upload_summary_email_last_sent";

/** Wait after the last sales/receipt upload before sending (debounce window). */
export const KPI_UPLOAD_SUMMARY_DEBOUNCE_MS = 18 * 60 * 1000;

export const DEFAULT_KPI_UPLOAD_SUMMARY_EMAIL_TO = "malik@pinasz.com";

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
  return mergeEmailList("", env.KPI_UPLOAD_SUMMARY_EMAIL_CC)
    .filter((email) => !recipients.has(email.toLowerCase()));
}

export function buildKpiUploadSummaryReportUrl(env = process.env) {
  return `${resolveAppOrigin(env).replace(/\/+$/, "")}/management/kpi-targets`;
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
 * Build the three KPI Targets footer summaries, then transpose so those row
 * labels become email columns (one email row per KPI).
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
    const liveKpi = buildPerformanceKpi(key, {
      actual: total.actual,
      target: total.target,
      reportDate,
      todayIso,
      salesAsOfDate,
      receiptAsOfDate,
    });
    const estimate = estimates[key] || { estimate: null, target: 0, achievement: null };
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

function formatSignedMoney(key, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const abs = formatPerformanceKpiValue(key, Math.abs(number));
  if (number > 0) return `+${abs}`;
  if (number < 0) return `−${abs}`;
  return abs;
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const abs = `${Math.abs(number).toFixed(0)}%`;
  if (number > 0) return `+${abs}`;
  if (number < 0) return `−${abs}`;
  return abs;
}

function totalFilteredHtml(row) {
  const cell = row.totalFiltered || {};
  const actual = formatPerformanceKpiValue(row.key, cell.actual);
  const hasTarget = Number(cell.target) > 0;
  const target = hasTarget
    ? formatPerformanceKpiValue(row.key, cell.target)
    : "—";
  const achievement = formatAchievementPercent(cell.achievement);
  const status = String(cell.statusLabel || "No target");
  return `
    <div style="font-weight:700;font-size:15px;color:#0f4c5c;">${escapeHtml(actual)}</div>
    ${hasTarget ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">Target ${escapeHtml(target)}</div>
    <div style="margin-top:4px;">${escapeHtml(achievement)} of target</div>` : `<div style="color:#64748b;font-size:12px;margin-top:2px;">Information only</div>`}
    <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:#fee2e2;color:${toneColor(cell.statusTone)};font-size:11px;font-weight:600;">
      ${escapeHtml(status)}
    </div>
  `;
}

function paceEstimateHtml(row) {
  const cell = row.paceEstimate || {};
  if (cell.estimate == null) {
    return `<div style="color:#94a3b8;">—</div>`;
  }
  const estimate = formatPerformanceKpiValue(row.key, cell.estimate);
  const hasTarget = Number(cell.target) > 0;
  const achievement = formatAchievementPercent(cell.achievement);
  return `
    <div style="font-weight:700;font-size:15px;color:#0f4c5c;">${escapeHtml(estimate)}</div>
    ${hasTarget ? `<div style="margin-top:4px;">${escapeHtml(achievement)} of target</div>` : ""}
    <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:999px;background:#ffedd5;color:#c2410c;font-size:11px;font-weight:600;">
      Estimate at current pace
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
  const directionLabel = cell.direction === "up"
    ? "higher than last month"
    : (cell.direction === "down" ? "lower than last month" : "same as last month");
  const priorLabel = priorMonth ? ` (${escapeHtml(priorMonth)})` : "";
  return `
    <div style="font-weight:700;font-size:15px;color:${color};">${escapeHtml(formatSignedMoney(row.key, cell.delta))}</div>
    <div style="color:#64748b;font-size:12px;margin-top:2px;">
      last month${priorLabel}: ${escapeHtml(formatPerformanceKpiValue(row.key, cell.priorActual))}
    </div>
    <div style="margin-top:4px;font-weight:700;color:${color};">${escapeHtml(formatSignedPercent(cell.percent))}</div>
    <div style="color:#64748b;font-size:12px;">${escapeHtml(directionLabel)}</div>
  `;
}

function totalFilteredText(row) {
  const cell = row.totalFiltered || {};
  const hasTarget = Number(cell.target) > 0;
  return [
    formatPerformanceKpiValue(row.key, cell.actual),
    hasTarget
      ? `target ${formatPerformanceKpiValue(row.key, cell.target)}`
      : "information only",
    hasTarget ? `${formatAchievementPercent(cell.achievement)} of target` : null,
    cell.statusLabel || "No target",
  ].filter(Boolean).join("; ");
}

function paceEstimateText(row) {
  const cell = row.paceEstimate || {};
  if (cell.estimate == null) return "—";
  const hasTarget = Number(cell.target) > 0;
  return [
    formatPerformanceKpiValue(row.key, cell.estimate),
    hasTarget ? `${formatAchievementPercent(cell.achievement)} of target` : null,
    "Estimate at current pace",
  ].filter(Boolean).join("; ");
}

function vsLastMonthText(row, priorMonth) {
  const cell = row.vsLastMonth;
  if (!cell) return "—";
  const directionLabel = cell.direction === "up"
    ? "higher than last month"
    : (cell.direction === "down" ? "lower than last month" : "same as last month");
  return [
    formatSignedMoney(row.key, cell.delta),
    `last month${priorMonth ? ` (${priorMonth})` : ""}: ${formatPerformanceKpiValue(row.key, cell.priorActual)}`,
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
    <p style="margin:0 0 14px;font-size:13px;">Footer rows from KPI Targets, transposed so Total / Estimate / vs last month are columns.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr style="background:#0f4c5c;color:#ffffff;">${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="4" style="padding:12px;border:1px solid #d7e3ea;">No KPI rows.</td></tr>`}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:12px;"><a href="${escapeHtml(reportUrl)}" style="color:#0f4c5c;">Open KPI Targets</a></p>
  </div>
</body></html>`;

  const textRows = (summary?.rows || []).map((row) => [
    row.label,
    `  Total (filtered): ${totalFilteredText(row)}`,
    `  Estimate at current pace: ${paceEstimateText(row)}`,
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
    ].join("\n"),
  };
}
