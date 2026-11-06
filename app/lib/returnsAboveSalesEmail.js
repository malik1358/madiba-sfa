import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";

export const RETURNS_ABOVE_SALES_EMAIL_KEY_PREFIX = "returns_above_sales_email:";
export const RETURNS_ABOVE_SALES_EMAIL_ROW_LIMIT = 200;
export const DEFAULT_RETURNS_ABOVE_SALES_EMAIL_TO = [
  "vinit.kulkarni@noorshukran.com",
  "badrish.thapliyal@noorshukran.com",
  "malik@pinasz.com",
];

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

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function clip(value, max = 280) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function returnsAboveSalesEmailRecipients(env = {}) {
  const testTo = String(env.RETURNS_ABOVE_SALES_EMAIL_TEST_TO || "").trim();
  const override = String(env.RETURNS_ABOVE_SALES_EMAIL_TO || "").trim();
  const source = testTo || override;
  const list = (source ? parseEmailList(source) : DEFAULT_RETURNS_ABOVE_SALES_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

export function returnsAboveSalesEmailCc(env = {}, to = []) {
  if (String(env.RETURNS_ABOVE_SALES_EMAIL_TEST_TO || "").trim()) return [];
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return [...new Set(parseEmailList(env.RETURNS_ABOVE_SALES_EMAIL_CC))]
    .filter((email) => isLikelyEmail(email) && !recipients.has(String(email).toLowerCase()));
}

export function buildReturnsAboveSalesReportUrl(env = process.env) {
  return `${resolveAppOrigin(env)}/management/returns-above-sales`;
}

function reportTable(rows = []) {
  const body = (rows || []).map((row, index) => {
    const background = index % 2 === 0 ? "#ffffff" : "#f3fbfb";
    return `<tr style="background:${background};">
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.customerName || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.customerCode || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.itemName || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.itemCode || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.salesAmount))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;background:#fee2e2;color:#b91c1c;font-weight:700;">${escapeHtml(formatMoney(row.returnAmount))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(clip(row.salesVouchers) || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(clip(row.returnVouchers) || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;background:#fee2e2;color:#b91c1c;font-weight:700;">${escapeHtml(formatMoney(row.excessAmount))}</td>
    </tr>`;
  }).join("");

  return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:0 0 12px;">
    <thead>
      <tr style="background:#0f4c5c;color:#fff;">
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Customer</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Code</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Item</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Item code</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Sales SAR</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Return SAR</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Sales vouchers</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Return vouchers</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Excess SAR</th>
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="9" style="padding:10px;border:1px solid #d7e3ea;">No customer and item has return value above sales value.</td></tr>`}</tbody>
  </table>`;
}

export function buildReturnsAboveSalesEmail({
  date = "",
  report = {},
  env = {},
  rowLimit = RETURNS_ABOVE_SALES_EMAIL_ROW_LIMIT,
} = {}) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const summary = report?.summary || {};
  const limit = Math.max(0, Number(rowLimit) || RETURNS_ABOVE_SALES_EMAIL_ROW_LIMIT);
  const limited = rows.slice(0, limit);
  const truncated = rows.length > limited.length;
  const reportUrl = buildReturnsAboveSalesReportUrl(env);
  const dateLabel = formatDate(date);
  const itemCount = Number(summary.itemCount ?? rows.length) || 0;
  const customerCount = Number(summary.customerCount) || 0;
  const excessAmount = Number(summary.excessAmount) || 0;
  const span = report?.span?.firstDate
    ? `${formatDate(report.span.firstDate)} to ${formatDate(report.span.lastDate || report.span.firstDate)}`
    : "all imported sales";

  const subject = itemCount
    ? `Returns above sales · ${dateLabel} · ${itemCount} items · excess ${formatMoney(excessAmount)}`
    : `Returns above sales · ${dateLabel} · none`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;">
    <h1 style="font-size:20px;margin:0 0 8px;color:#0f4c5c;">Returns above sales</h1>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;">
      Customer and item pairs where credit-note value is higher than sales value (${escapeHtml(span)}).
      Comparison is by value. Open the report:
      <a href="${escapeHtml(reportUrl)}">Returns Above Sales</a>.
    </p>
    <p style="margin:0 0 14px;font-size:13px;">
      <strong>${itemCount}</strong> items ·
      <strong>${customerCount}</strong> customers ·
      Excess <strong>${escapeHtml(formatMoney(excessAmount))}</strong>
    </p>
    ${reportTable(limited)}
    ${truncated ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b;">Showing the first ${limited.length} of ${rows.length} items, largest excess first.</p>` : ""}
  </div>`;

  return {
    subject,
    html,
    text: [
      "Returns above sales",
      `Date: ${dateLabel}`,
      `History: ${span}`,
      `Items: ${itemCount}`,
      `Customers: ${customerCount}`,
      `Excess: ${formatMoney(excessAmount)}`,
      `Open: ${reportUrl}`,
    ].join("\n"),
    totals: {
      itemCount,
      customerCount,
      excessAmount,
    },
  };
}
