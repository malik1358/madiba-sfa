import { isLikelyEmail, parseEmailList } from "./mailer.js";

export const DEFAULT_OUTSTANDING_RECONCILE_EMAIL_TO = [
  "vinit.kulkarni@noorshukran.com",
  "badrish.thapliyal@noorshukran.com",
  "prem.shah@noorshukran.com",
  "malik@pinasz.com",
];

const DEFAULT_APP_ORIGIN = "https://madiba-sfa.vercel.app";
const MAX_EMAIL_ROWS = 200;

function resolveReportOrigin(env = process.env) {
  const configured = String(env.APP_ORIGIN || env.NEXT_PUBLIC_APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  return DEFAULT_APP_ORIGIN;
}

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
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

export function resolveOutstandingReconcileEmailRecipients(env = process.env) {
  return mergeEmailList(DEFAULT_OUTSTANDING_RECONCILE_EMAIL_TO, env.OUTSTANDING_RECONCILE_EMAIL_TO);
}

export function resolveOutstandingReconcileEmailCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList([], env.OUTSTANDING_RECONCILE_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function formatReconcileMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatReconcileDelta(value) {
  const number = Number(value || 0);
  if (Math.abs(number) <= 0.009) return "0.00";
  return `${number > 0 ? "+" : ""}${formatReconcileMoney(number)}`;
}

export function buildOutstandingReconcileReportUrl(env = process.env) {
  return `${resolveReportOrigin(env).replace(/\/+$/, "")}/management/outstanding-compare`;
}

function settlementUrl(env, customerCode) {
  const base = resolveReportOrigin(env).replace(/\/+$/, "");
  return `${base}/management/payment-settlement?customer_code=${encodeURIComponent(customerCode || "")}#invoices-settlement`;
}

function tableHeader() {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c5c);background-color:#0f4c5c;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Code</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Customer</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Salesman</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Tally</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">SFA</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Difference</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Invoice gaps</th>
  </tr>`;
}

function tableRow(row, index, env) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  const difference = Number(row.difference || 0);
  const diffColor = difference > 0.02 ? "#b91c1c" : difference < -0.02 ? "#0f766e" : "#334155";
  const link = settlementUrl(env, row.customer_code);
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.customer_code || "-")}</td>
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c5c;"><a href="${escapeHtml(link)}" style="color:#0f4c5c;">${escapeHtml(row.customer_name || row.customer_code || "-")}</a></td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.salesman_name || "-")}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatReconcileMoney(row.tally_outstanding))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatReconcileMoney(row.sfa_outstanding))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:${diffColor};">${escapeHtml(formatReconcileDelta(difference))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(String(row.invoice_gap_count || 0))}</td>
  </tr>`;
}

function totalRow(summary) {
  return `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="3">Total (${escapeHtml(String(summary.customer_count || 0))} customers)</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">${escapeHtml(formatReconcileMoney(summary.tally_outstanding))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">${escapeHtml(formatReconcileMoney(summary.sfa_outstanding))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#0f766e;">${escapeHtml(formatReconcileDelta(summary.difference))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">${escapeHtml(String(summary.invoice_gap_count || 0))}</td>
  </tr>`;
}

export function buildOutstandingReconcileEmail({
  rows = [],
  summary = {},
  builtAt = "",
  trigger = "",
  env = process.env,
} = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const shownRows = allRows.slice(0, MAX_EMAIL_ROWS);
  const hiddenCount = allRows.length - shownRows.length;
  const reportUrl = buildOutstandingReconcileReportUrl(env);
  const triggerLabel = String(trigger || "").replace(/[-_]/g, " ").trim();

  const subject = allRows.length
    ? `Tally vs SFA outstanding — ${allRows.length} customer(s) differ (${formatReconcileDelta(summary.difference)})`
    : "Tally vs SFA outstanding — no differences";

  const intro = allRows.length
    ? `Customers where SFA computed outstanding (cash FIFO + credit notes) does not match the Tally outstanding upload, or where an individual invoice still has an open gap. Only differing customers are listed.`
    : "SFA computed outstanding matches the Tally outstanding upload for every customer.";

  const body = shownRows.length
    ? shownRows.map((row, index) => tableRow(row, index, env)).join("")
    : `<tr><td colspan="7" style="border:1px solid #99f6e4;padding:12px;background:#f0fdf4;color:#166534;">No differences.</td></tr>`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:980px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,76,92,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c5c 55%,#155e75 100%);background-color:#0f4c5c;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Tally vs SFA outstanding — differences</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(builtAt ? builtAt.slice(0, 19).replace("T", " ") : "")}${triggerLabel ? ` · after ${escapeHtml(triggerLabel)}` : ""}</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      <table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
        <thead>${tableHeader()}</thead>
        <tbody>${body}${allRows.length ? totalRow({ ...summary, customer_count: allRows.length }) : ""}</tbody>
      </table>
      ${hiddenCount > 0 ? `<p style="margin:12px 0 0;color:#b45309;font-size:12px;">${escapeHtml(String(hiddenCount))} more customer(s) not shown — open the report for the full list.</p>` : ""}
      <p style="margin:16px 0 0;"><a href="${escapeHtml(reportUrl)}" style="color:#0f766e;font-weight:700;">Open Outstanding Compare</a></p>
      <p style="margin:12px 0 0; color: #64748b; font-size: 12px;">Customer names link to Invoices &amp; Settlement for that customer.</p>
    </div>
  </div>
</div>`;

  const text = [
    "Tally vs SFA outstanding — differences",
    intro,
    "",
    ...shownRows.map((row) => [
      row.customer_code || "-",
      row.customer_name || "-",
      `Tally ${formatReconcileMoney(row.tally_outstanding)}`,
      `SFA ${formatReconcileMoney(row.sfa_outstanding)}`,
      `Diff ${formatReconcileDelta(row.difference)}`,
      `gaps ${row.invoice_gap_count || 0}`,
    ].join(" | ")),
    hiddenCount > 0 ? `${hiddenCount} more customer(s) not shown.` : "",
    "",
    reportUrl,
  ].filter(Boolean).join("\n");

  return { subject, html, text, rowCount: allRows.length };
}
