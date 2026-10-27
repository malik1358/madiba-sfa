import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  groupItemsSoldAtLossBySalesman,
  summarizeItemsSoldAtLoss,
} from "./itemsSoldAtLoss.js";

export const ITEMS_SOLD_AT_LOSS_EMAIL_KEY_PREFIX = "items_sold_at_loss_email:";
export const DEFAULT_ITEMS_SOLD_AT_LOSS_EMAIL_TO = "malik@pinasz.com";
export const ITEMS_SOLD_AT_LOSS_EMAIL_ROW_LIMIT = 400;

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

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

export function itemsSoldAtLossEmailRecipients(env = {}) {
  const testTo = String(env.ITEMS_SOLD_AT_LOSS_EMAIL_TEST_TO || "").trim();
  const override = String(env.ITEMS_SOLD_AT_LOSS_EMAIL_TO || "").trim();
  const list = parseEmailList(testTo || override || DEFAULT_ITEMS_SOLD_AT_LOSS_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

export function buildItemsSoldAtLossReportUrl(env = process.env) {
  return `${resolveAppOrigin(env)}/management/business-dashboard`;
}

function lossTable(rows = []) {
  const body = (rows || []).map((row) => `<tr>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(formatDate(row.transactionDate))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(row.voucherNumber || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(`${row.salesmanCode || ""} ${row.salesmanName || ""}`.trim() || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(`${row.customerCode || ""} ${row.customerName || ""}`.trim() || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;">${escapeHtml(`${row.itemCode || ""} ${row.itemName || ""}`.trim() || "-")}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatQty(row.quantity))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.rate))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;">${escapeHtml(formatMoney(row.salesAmount))}</td>
      <td style="padding:6px 8px;border:1px solid #d7e3ea;text-align:right;color:#b91c1c;font-weight:600;">${escapeHtml(formatMoney(row.profitAmount))}</td>
    </tr>`).join("");

  return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:0 0 12px;">
    <thead>
      <tr style="background:#0f4c5c;color:#fff;">
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Date</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Voucher</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Salesman</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Customer</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:left;">Item</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Qty</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Price</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Sales</th>
        <th style="padding:8px;border:1px solid #0f4c5c;text-align:right;">Loss (GP)</th>
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="9" style="padding:10px;border:1px solid #d7e3ea;">No loss lines.</td></tr>`}</tbody>
  </table>`;
}

export function buildItemsSoldAtLossEmail({
  date = "",
  rows = [],
  env = {},
  rowLimit = ITEMS_SOLD_AT_LOSS_EMAIL_ROW_LIMIT,
} = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const totals = summarizeItemsSoldAtLoss(allRows);
  const limited = allRows.slice(0, Math.max(0, Number(rowLimit) || ITEMS_SOLD_AT_LOSS_EMAIL_ROW_LIMIT));
  const truncated = allRows.length > limited.length;
  const groups = groupItemsSoldAtLossBySalesman(limited);
  const reportUrl = buildItemsSoldAtLossReportUrl(env);
  const dateLabel = formatDate(date);

  const groupHtml = groups.length
    ? groups.map((group) => `<div style="margin:16px 0 8px;">
        <h3 style="margin:0 0 8px;font-size:14px;color:#0f4c5c;">
          ${escapeHtml(group.salesman)} (${group.totals.lineCount}) · Loss ${escapeHtml(formatMoney(group.totals.profitAmount))}
        </h3>
        ${lossTable(group.rows)}
      </div>`).join("")
    : `<p style="margin:12px 0;">No items were sold at a loss on ${escapeHtml(dateLabel)} (KSA).</p>`;

  const subject = allRows.length
    ? `Items sold at loss · ${dateLabel} · ${totals.lineCount} lines · ${formatMoney(totals.profitAmount)} SAR`
    : `Items sold at loss · ${dateLabel} · none`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;">
    <h1 style="font-size:20px;margin:0 0 8px;color:#0f4c5c;">Items sold at loss</h1>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;">
      Active sales lines with negative imported GP for ${escapeHtml(dateLabel)} (KSA).
      Admin report: Business Intelligence → Items sold at loss.
    </p>
    <p style="margin:0 0 14px;font-size:13px;">
      <strong>${totals.lineCount}</strong> lines ·
      Qty <strong>${escapeHtml(formatQty(totals.quantity))}</strong> ·
      Sales <strong>${escapeHtml(formatMoney(totals.salesAmount))}</strong> ·
      Loss <strong style="color:#b91c1c;">${escapeHtml(formatMoney(totals.profitAmount))}</strong>
    </p>
    ${truncated ? `<p style="margin:0 0 12px;font-size:12px;color:#b45309;">Showing the first ${limited.length} of ${allRows.length} lines. Open the BI report for the full list.</p>` : ""}
    ${groupHtml}
    <p style="margin:18px 0 0;font-size:12px;">
      <a href="${escapeHtml(reportUrl)}">Open Business Intelligence</a>
    </p>
  </div>`;

  const textLines = [
    `Items sold at loss — ${dateLabel} (KSA)`,
    `${totals.lineCount} lines · Qty ${formatQty(totals.quantity)} · Sales ${formatMoney(totals.salesAmount)} · Loss ${formatMoney(totals.profitAmount)}`,
    truncated ? `Showing first ${limited.length} of ${allRows.length} lines.` : "",
    "Date | Voucher | Salesman | Customer | Item | Qty | Price | Sales | Loss (GP)",
    ...limited.map((row) => [
      formatDate(row.transactionDate),
      row.voucherNumber || "-",
      `${row.salesmanCode || ""} ${row.salesmanName || ""}`.trim() || "-",
      `${row.customerCode || ""} ${row.customerName || ""}`.trim() || "-",
      `${row.itemCode || ""} ${row.itemName || ""}`.trim() || "-",
      formatQty(row.quantity),
      formatMoney(row.rate),
      formatMoney(row.salesAmount),
      formatMoney(row.profitAmount),
    ].join(" | ")),
    reportUrl,
  ].filter(Boolean);

  return {
    subject,
    html,
    text: textLines.join("\n"),
    lineCount: totals.lineCount,
    totals,
    truncated,
  };
}
