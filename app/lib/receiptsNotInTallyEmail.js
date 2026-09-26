import { isLikelyEmail, parseEmailList } from "./mailer.js";

export const RECEIPTS_NOT_IN_TALLY_EMAIL_LAST_SENT_KEY = "receipts_not_in_tally_email_last_sent";

export const DEFAULT_RECEIPTS_NOT_IN_TALLY_EMAIL_TO = [
  "vinit.kulkarni@noorshukran.com",
  "badrish.thapliyal@noorshukran.com",
  "prem.shah@noorshukran.com",
  "malik@pinasz.com",
];

const DEFAULT_APP_ORIGIN = "https://madiba-sfa.vercel.app";

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

export function resolveReceiptsNotInTallyEmailRecipients(env = process.env) {
  return mergeEmailList(DEFAULT_RECEIPTS_NOT_IN_TALLY_EMAIL_TO, env.RECEIPTS_NOT_IN_TALLY_EMAIL_TO);
}

export function resolveReceiptsNotInTallyEmailCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList([], env.RECEIPTS_NOT_IN_TALLY_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function formatReceiptsNotInTallyMoney(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatReceiptsNotInTallyDate(iso) {
  const text = String(iso || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

export function buildReceiptsNotInTallyReportUrl(env = process.env, { from = "", to = "" } = {}) {
  const base = resolveReportOrigin(env).replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return `${base}/management/receipts-not-in-tally${query ? `?${query}` : ""}`;
}

export function parseReceiptsNotInTallyLastSent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const lastSentAt = String(value.lastSentAt || value.asOf || "").trim();
    const date = String(value.date || value.lastSentDate || "").trim();
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      lastSentAt: Number.isFinite(Date.parse(lastSentAt)) ? new Date(lastSentAt).toISOString() : "",
    };
  }

  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, lastSentAt: "" };
  }
  if (Number.isFinite(Date.parse(raw))) {
    return { date: "", lastSentAt: new Date(raw).toISOString() };
  }
  return { date: "", lastSentAt: "" };
}

function tableHeader() {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c5c);background-color:#0f4c5c;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Visit date</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Customer</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Amount</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Mode</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Status</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Collected by</th>
  </tr>`;
}

function tableRow(row, index) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  const customer = [
    String(row.customerName || "").trim(),
    String(row.customerCode || "").trim(),
  ].filter(Boolean).join(" — ") || "-";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatReceiptsNotInTallyDate(row.visitDate))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c5c;">${escapeHtml(customer)}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#b91c1c;">${escapeHtml(formatReceiptsNotInTallyMoney(row.amountReceived))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(String(row.receiptMode || "-").replace(/_/g, " "))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(String(row.paymentStatus || "-").replace(/_/g, " "))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.collectorName || "-")}</td>
  </tr>`;
}

function totalRow(count, total) {
  return `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="2">Open total (${count})</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#0f766e;">${escapeHtml(formatReceiptsNotInTallyMoney(total))}</td>
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="3"></td>
  </tr>`;
}

function renderTable(rows) {
  const total = (rows || []).reduce((sum, row) => sum + Number(row.amountReceived || 0), 0);
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index)).join("")
    : `<tr><td colspan="6" style="border:1px solid #99f6e4;padding:12px;background:#f0fdf4;color:#166534;">No open app receipts missing from Tally.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
    <thead>${tableHeader()}</thead>
    <tbody>${body}${rows.length ? totalRow(rows.length, total) : ""}</tbody>
  </table>`;
}

function summaryCards({ count, total, ignoredCount }) {
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 0;margin:0 0 16px;">
  <tr>
    <td style="width:33%;padding:0 6px 0 0;vertical-align:top;">
      <div style="background:#fff1f2;border:1px solid #fda4af;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#be123c;text-transform:uppercase;letter-spacing:0.04em;">Open missing</div>
        <div style="font-size:22px;font-weight:800;color:#9f1239;margin-top:4px;">${escapeHtml(String(count))}</div>
      </div>
    </td>
    <td style="width:34%;padding:0 6px;vertical-align:top;">
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:0.04em;">Open amount</div>
        <div style="font-size:22px;font-weight:800;color:#991b1b;margin-top:4px;">${escapeHtml(formatReceiptsNotInTallyMoney(total))}</div>
      </div>
    </td>
    <td style="width:33%;padding:0 0 0 6px;vertical-align:top;">
      <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#0e7490;text-transform:uppercase;letter-spacing:0.04em;">Marked mistakes</div>
        <div style="font-size:22px;font-weight:800;color:#155e75;margin-top:4px;">${escapeHtml(String(ignoredCount || 0))}</div>
      </div>
    </td>
  </tr>
</table>`;
}

export function buildReceiptsNotInTallyEmail({
  date,
  from,
  to,
  windowDays = 5,
  rows = [],
  ignoredCount = 0,
  reportUrl = "",
} = {}) {
  const openRows = Array.isArray(rows) ? rows : [];
  const total = openRows.reduce((sum, row) => sum + Number(row.amountReceived || 0), 0);
  const subject = openRows.length
    ? `Receipts not in Tally ${date} — ${openRows.length} open (${formatReceiptsNotInTallyMoney(total)})`
    : `Receipts not in Tally ${date} — none open`;
  const link = String(reportUrl || "").trim();
  const rangeLabel = from && to ? `${formatReceiptsNotInTallyDate(from)} – ${formatReceiptsNotInTallyDate(to)}` : date;
  const intro = `Open app collection receipts (Funds Received) that do not match the Tally receipt register upload for ${rangeLabel} (±${windowDays} day window). Rows marked as mistake are excluded.`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,76,92,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c5c 55%,#155e75 100%);background-color:#0f4c5c;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Receipts not in Tally</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)} · open list</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      ${summaryCards({ count: openRows.length, total, ignoredCount })}
      ${renderTable(openRows)}
      ${link ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(link)}" style="color:#0f766e;font-weight:700;">Open Receipts Not in Tally report</a></p>` : ""}
      <p style="margin:16px 0 0; color: #64748b; font-size: 12px;">Mistakes marked in the report stay off this daily digest until restored.</p>
    </div>
  </div>
</div>`;

  const text = [
    `Receipts not in Tally — ${date}`,
    intro,
    `Open: ${openRows.length} · Amount: ${formatReceiptsNotInTallyMoney(total)} · Mistakes ignored: ${ignoredCount || 0}`,
    "",
    "Visit date | Customer | Amount | Mode | Status | Collected by",
    ...openRows.map((row) => [
      formatReceiptsNotInTallyDate(row.visitDate),
      [row.customerName, row.customerCode].filter(Boolean).join(" — ") || "-",
      formatReceiptsNotInTallyMoney(row.amountReceived),
      String(row.receiptMode || "-").replace(/_/g, " "),
      String(row.paymentStatus || "-").replace(/_/g, " "),
      row.collectorName || "-",
    ].join(" | ")),
    link ? `Report: ${link}` : "",
  ].filter(Boolean).join("\n");

  return { subject, text, html, openCount: openRows.length, total, ignoredCount };
}
