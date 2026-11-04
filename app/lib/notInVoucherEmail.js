import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  NOT_IN_VOUCHER_LABEL,
  summarizeNotInVoucherVouchers,
} from "./notInVoucherSales.js";

export const NOT_IN_VOUCHER_EMAIL_KEY_PREFIX = "not_in_voucher_email:";
export const DEFAULT_NOT_IN_VOUCHER_EMAIL_TO = "malik@pinasz.com";
export const NOT_IN_VOUCHER_EMAIL_ROW_LIMIT = 300;

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
    maximumFractionDigits: 0,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

export function notInVoucherEmailRecipients(env = {}) {
  const testTo = String(env.NOT_IN_VOUCHER_EMAIL_TEST_TO || "").trim();
  const override = String(env.NOT_IN_VOUCHER_EMAIL_TO || "").trim();
  const list = parseEmailList(testTo || override || DEFAULT_NOT_IN_VOUCHER_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

export function buildNotInVoucherReportUrl(env = process.env) {
  return `${resolveAppOrigin(env)}/management/mis`;
}

function voucherTable(rows = []) {
  const body = (rows || []).map((row) => `<tr>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(formatDate(row.transactionDate))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.voucherNumber || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.voucherType || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(`${row.customerCode || ""} ${row.customerName || ""}`.trim() || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml((row.categories || []).join(", ") || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(String(row.lineCount || 0))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.salesAmount))}</td>
    </tr>`).join("");

  return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:0 0 12px;">
    <thead>
      <tr style="background:#0f4c5c;color:#fff;">
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Date</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Voucher</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Type</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Customer</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Category</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Lines</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Sales</th>
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="7" style="padding:10px;border:1px solid #d7e3ea;">No vouchers.</td></tr>`}</tbody>
  </table>`;
}

export function buildNotInVoucherEmail({
  date = "",
  vouchers = [],
  env = {},
  rowLimit = NOT_IN_VOUCHER_EMAIL_ROW_LIMIT,
} = {}) {
  const all = Array.isArray(vouchers) ? vouchers : [];
  const totals = summarizeNotInVoucherVouchers(all);
  const limited = all.slice(0, Math.max(0, Number(rowLimit) || NOT_IN_VOUCHER_EMAIL_ROW_LIMIT));
  const truncated = all.length > limited.length;
  const reportUrl = buildNotInVoucherReportUrl(env);
  const dateLabel = formatDate(date);
  const dayRows = limited.filter((row) => String(row.transactionDate || "") === String(date || ""));
  const olderRows = limited.filter((row) => String(row.transactionDate || "") !== String(date || ""));

  const subject = all.length
    ? `${NOT_IN_VOUCHER_LABEL} vouchers · ${dateLabel} · ${totals.voucherCount} vouchers · ${formatMoney(totals.salesAmount)}`
    : `${NOT_IN_VOUCHER_LABEL} vouchers · ${dateLabel} · none`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;">
    <h1 style="font-size:20px;margin:0 0 8px;color:#0f4c5c;">${escapeHtml(NOT_IN_VOUCHER_LABEL)} sales vouchers</h1>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;">
      Active sales lines where salesman is <strong>${escapeHtml(NOT_IN_VOUCHER_LABEL)}</strong>.
      Assign the correct salesman on these Tally vouchers, then re-import sales.
      Report: <a href="${escapeHtml(reportUrl)}">Management MIS</a>.
    </p>
    <p style="margin:0 0 14px;font-size:13px;">
      <strong>${totals.voucherCount}</strong> vouchers ·
      <strong>${totals.lineCount}</strong> lines ·
      Sales <strong>${escapeHtml(formatMoney(totals.salesAmount))}</strong>
    </p>
    <h2 style="font-size:15px;margin:18px 0 8px;color:#0f4c5c;">On ${escapeHtml(dateLabel)} (KSA)</h2>
    ${dayRows.length
      ? voucherTable(dayRows)
      : `<p style="margin:0 0 12px;font-size:13px;">No ${escapeHtml(NOT_IN_VOUCHER_LABEL)} vouchers on ${escapeHtml(dateLabel)}.</p>`}
    ${olderRows.length ? `<h2 style="font-size:15px;margin:18px 0 8px;color:#0f4c5c;">Still open (other dates)</h2>${voucherTable(olderRows)}` : ""}
    ${truncated ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b;">Showing first ${limited.length} of ${all.length} vouchers.</p>` : ""}
  </div>`;

  return {
    subject,
    html,
    text: [
      `${NOT_IN_VOUCHER_LABEL} sales vouchers`,
      `Date focus: ${dateLabel}`,
      `Vouchers: ${totals.voucherCount}`,
      `Lines: ${totals.lineCount}`,
      `Sales: ${formatMoney(totals.salesAmount)}`,
      `Open: ${reportUrl}`,
    ].join("\n"),
    totals,
  };
}
