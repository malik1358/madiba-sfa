import { compareKpiActualToPriorMonth } from "./kpiTargetsTable.js";
import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  addKsaCalendarDays,
  getKsaDateString,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

export const EXPECTED_STOCKED_SALES_EMAIL_KEY_PREFIX = "expected_stocked_sales_email:";
export const EXPECTED_STOCKED_SALES_EMAIL_SNAPSHOT_KEY = "expected_stocked_sales_email_snapshot_v1";
export const DEFAULT_EXPECTED_STOCKED_SALES_EMAIL_TO = "malik@pinasz.com";

const UP_COLOR = "#198754";
const DOWN_COLOR = "#dc3545";
const FLAT_COLOR = "#6c757d";
const HEADER_BG = "#0f4c5c";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  if (value == null || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function formatSignedMoney(value) {
  const amount = Number(value || 0);
  const abs = formatMoney(Math.abs(amount));
  if (amount > 0) return `+${abs}`;
  if (amount < 0) return `-${abs}`;
  return abs;
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const amount = Number(value);
  const abs = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (amount > 0) return `+${abs}%`;
  if (amount < 0) return `-${abs}%`;
  return `${abs}%`;
}

export function expectedStockedSalesEmailRecipients(env = {}) {
  const testTo = String(env.EXPECTED_STOCKED_SALES_EMAIL_TEST_TO || "").trim();
  const override = String(env.EXPECTED_STOCKED_SALES_EMAIL_TO || "").trim();
  const list = parseEmailList(testTo || override || DEFAULT_EXPECTED_STOCKED_SALES_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

export function expectedStockedSalesEmailCc(env = {}, to = []) {
  if (String(env.EXPECTED_STOCKED_SALES_EMAIL_TEST_TO || "").trim()) return [];
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return [...new Set(parseEmailList(env.EXPECTED_STOCKED_SALES_EMAIL_CC))]
    .filter((email) => isLikelyEmail(email) && !recipients.has(String(email).toLowerCase()));
}

export function buildExpectedStockedSalesReportUrl(env = process.env) {
  return `${resolveAppOrigin(env)}/management/expected-stocked-sales`;
}

/** Monday (KSA) of the week containing `date` — used as the weekly claim suffix. */
export function expectedStockedSalesEmailWeekMonday(dateInput = new Date()) {
  const dateStr = typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput
    : getKsaDateString(dateInput instanceof Date ? dateInput : new Date(dateInput));
  const weekday = getKsaWeekdayIndexForDateString(dateStr); // 0=Sun … 6=Sat
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return addKsaCalendarDays(dateStr, -daysSinceMonday);
}

export function expectedStockedSalesEmailClaimKey(dateInput = new Date()) {
  return `${EXPECTED_STOCKED_SALES_EMAIL_KEY_PREFIX}${expectedStockedSalesEmailWeekMonday(dateInput)}`;
}

export function summarizeExpectedStockedCohort(summary = {}) {
  return {
    itemCount: Number(summary.itemCount || 0) || 0,
    expectedSales: Number(summary.expectedSales || 0) || 0,
    expectedProfit: Number(summary.expectedProfit || 0) || 0,
    expectedGpPercent: summary.expectedGpPercent == null
      ? null
      : Number(summary.expectedGpPercent),
  };
}

export function compareExpectedStockedMetric(current, previous) {
  return compareKpiActualToPriorMonth(current, previous);
}

export function buildExpectedStockedTrendLabel(comparison) {
  if (!comparison || comparison.priorActual == null || comparison.delta == null) {
    return { text: "No prior week", direction: "flat", color: FLAT_COLOR };
  }
  const direction = comparison.direction || "flat";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "→";
  const word = direction === "up" ? "Up" : direction === "down" ? "Down" : "Flat";
  const pct = formatSignedPercent(comparison.percent);
  const parts = [
    word,
    formatSignedMoney(comparison.delta),
    pct ? `(${pct})` : null,
  ].filter(Boolean);
  return {
    text: `${arrow} ${parts.join(" ")}`,
    direction,
    color: direction === "up" ? UP_COLOR : direction === "down" ? DOWN_COLOR : FLAT_COLOR,
  };
}

function metricRow({ label, current, previous, kind = "money" }) {
  const comparison = compareExpectedStockedMetric(current, previous);
  const trend = buildExpectedStockedTrendLabel(comparison);
  const currentText = kind === "percent"
    ? formatPercent(current)
    : kind === "count"
      ? formatCount(current)
      : formatMoney(current);
  const previousText = previous == null || previous === ""
    ? "—"
    : kind === "percent"
      ? formatPercent(previous)
      : kind === "count"
        ? formatCount(previous)
        : formatMoney(previous);
  return {
    label,
    currentText,
    previousText,
    trendText: trend.text,
    trendColor: trend.color,
    direction: trend.direction,
  };
}

export function buildExpectedStockedCohortTrendRows(current = {}, previous = null) {
  const cur = summarizeExpectedStockedCohort(current);
  const prev = previous ? summarizeExpectedStockedCohort(previous) : null;
  return [
    metricRow({
      label: "Expected sales SAR",
      current: cur.expectedSales,
      previous: prev?.expectedSales,
      kind: "money",
    }),
    metricRow({
      label: "Expected GP SAR",
      current: cur.expectedProfit,
      previous: prev?.expectedProfit,
      kind: "money",
    }),
    metricRow({
      label: "Expected margin %",
      current: cur.expectedGpPercent,
      previous: prev?.expectedGpPercent,
      kind: "percent",
    }),
    metricRow({
      label: "Items",
      current: cur.itemCount,
      previous: prev?.itemCount,
      kind: "count",
    }),
  ];
}

function cohortHeadlineDirection(rows = []) {
  const salesRow = rows.find((row) => row.label === "Expected sales SAR");
  return salesRow?.direction || "flat";
}

function directionWord(direction) {
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  return "flat";
}

function trendTable(title, rows = []) {
  const body = (rows || []).map((row, index) => {
    const background = index % 2 === 0 ? "#ffffff" : "#f3fbfb";
    return `<tr style="background:${background};">
      <td style="padding:8px;border:1px solid #d7e3ea;">${escapeHtml(row.label)}</td>
      <td style="padding:8px;border:1px solid #d7e3ea;text-align:right;font-weight:700;">${escapeHtml(row.currentText)}</td>
      <td style="padding:8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(row.previousText)}</td>
      <td style="padding:8px;border:1px solid #d7e3ea;text-align:right;color:${escapeHtml(row.trendColor)};font-weight:700;">${escapeHtml(row.trendText)}</td>
    </tr>`;
  }).join("");

  return `<h3 style="margin:18px 0 8px;color:${HEADER_BG};font-size:15px;">${escapeHtml(title)}</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 8px;">
    <thead>
      <tr style="background:${HEADER_BG};color:#fff;">
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:left;">Metric</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">This week</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Last email</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Change</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function categoryTable(categoryRows = [], limit = 12) {
  const rows = (categoryRows || []).slice(0, limit);
  const body = rows.map((row, index) => {
    const background = index % 2 === 0 ? "#ffffff" : "#f3fbfb";
    return `<tr style="background:${background};">
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.category || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatCount(row.itemCount))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.expectedSales))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.expectedProfit))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatPercent(row.expectedGpPercent))}</td>
    </tr>`;
  }).join("");

  return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:0 0 12px;">
    <thead>
      <tr style="background:${HEADER_BG};color:#fff;">
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:left;">Category</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Items</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Expected SAR</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Expected GP</th>
        <th style="padding:8px;border:1px solid ${HEADER_BG};text-align:right;">Margin %</th>
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="5" style="padding:10px;border:1px solid #d7e3ea;">No categories.</td></tr>`}</tbody>
  </table>`;
}

export function buildExpectedStockedSalesEmail({
  date = "",
  report = {},
  previous = null,
  env = {},
} = {}) {
  const asOf = String(date || report.asOfDate || "").trim();
  const gp10Rows = buildExpectedStockedCohortTrendRows(report.summary, previous?.gp10);
  const gp0Rows = buildExpectedStockedCohortTrendRows(report.profitableSummary, previous?.gp0);
  const gp10Direction = cohortHeadlineDirection(gp10Rows);
  const gp0Direction = cohortHeadlineDirection(gp0Rows);
  const seasonMonths = (report.season?.calendarMonths || []).join(", ") || "none";
  const reportUrl = buildExpectedStockedSalesReportUrl(env);
  const prevDate = previous?.asOfDate ? formatDate(previous.asOfDate) : "none";

  const subject = `Expected Stocked Sales weekly (${formatDate(asOf)}): GP>10% ${directionWord(gp10Direction)}, all profitable ${directionWord(gp0Direction)}`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#102a43;line-height:1.45;max-width:760px;">
  <h2 style="margin:0 0 8px;color:${HEADER_BG};">Expected Stocked Sales — weekly</h2>
  <p style="margin:0 0 12px;">As of <strong>${escapeHtml(formatDate(asOf))}</strong> (KSA). Compared with last email (${escapeHtml(prevDate)}). Seasonal months excluded: <strong>${escapeHtml(seasonMonths)}</strong>.</p>
  <p style="margin:0 0 16px;"><a href="${escapeHtml(reportUrl)}">Open report</a></p>
  ${trendTable("GP > 10% (main view)", gp10Rows)}
  ${categoryTable(report.categoryRows || [])}
  ${trendTable("GP > 0% (all profitable items)", gp0Rows)}
  ${categoryTable(report.profitableCategoryRows || [])}
  <p style="margin:16px 0 0;font-size:12px;color:#627d98;">Estimate = second-highest completed non-seasonal month per item if fully stocked. LP* local products excluded. Replacement codes merged.</p>
</div>`;

  const textLines = [
    `Expected Stocked Sales weekly — ${formatDate(asOf)} (KSA)`,
    `Compared with last email: ${prevDate}`,
    `Seasonal months excluded: ${seasonMonths}`,
    "",
    "GP > 10%:",
    ...gp10Rows.map((row) => `- ${row.label}: ${row.currentText} (was ${row.previousText}) ${row.trendText}`),
    "",
    "GP > 0% (all profitable):",
    ...gp0Rows.map((row) => `- ${row.label}: ${row.currentText} (was ${row.previousText}) ${row.trendText}`),
    "",
    reportUrl,
  ];

  return {
    subject,
    html,
    text: textLines.join("\n"),
    asOfDate: asOf,
    gp10Direction,
    gp0Direction,
    gp10: summarizeExpectedStockedCohort(report.summary),
    gp0: summarizeExpectedStockedCohort(report.profitableSummary),
  };
}
