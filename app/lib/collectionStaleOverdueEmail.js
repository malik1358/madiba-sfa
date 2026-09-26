import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import { getCollectionSalesmanLabel } from "./paymentCollections.js";
import { addKsaCalendarDays, getKsaDateString } from "./workdayActivity.js";

export const COLLECTION_STALE_OVERDUE_EMAIL_LAST_SENT_KEY = "collection_stale_overdue_email_last_sent";
export const DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_TO = "malik@pinasz.com";
export const COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS = 7;
export const COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS = 10;

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

export function resolveCollectionStaleOverdueDigestRecipients(env = process.env) {
  const configured = mergeEmailList([], env.COLLECTION_STALE_OVERDUE_EMAIL_TO);
  if (configured.length) return configured;
  return [DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_TO];
}

export function resolveCollectionStaleOverdueDigestCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList([], env.COLLECTION_STALE_OVERDUE_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function overdueOver60Amount(row = {}) {
  return Number(row?.outstanding_61_90 || 0)
    + Number(row?.outstanding_91_120 || 0)
    + Number(row?.outstanding_above_120 || 0);
}

export function resolveLastCollectionVisitDateKey(row = {}) {
  const savedAt = row?.latest_collection?.saved_at;
  if (!savedAt) return "";
  const parsed = new Date(savedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

export function isCollectionVisitOlderThanDays(row = {}, {
  todayKey = "",
  minAgeDays = COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
} = {}) {
  const today = String(todayKey || "").trim() || getKsaDateString();
  const visitKey = resolveLastCollectionVisitDateKey(row);
  if (!visitKey) return true;
  const cutoff = addKsaCalendarDays(today, -Math.max(1, Number(minAgeDays) || 7));
  return visitKey < cutoff;
}

export function isCollectionStaleOverdueRow(row = {}, {
  todayKey = "",
  minVisitAgeDays = COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
} = {}) {
  if (overdueOver60Amount(row) <= 0) return false;
  if (Number(row?.received_last_10_days || 0) > 0) return false;
  return isCollectionVisitOlderThanDays(row, { todayKey, minAgeDays: minVisitAgeDays });
}

export function filterCollectionStaleOverdueRows(rows = [], options = {}) {
  return (rows || []).filter((row) => isCollectionStaleOverdueRow(row, options));
}

export function collectionStaleOverdueGroupKey(row = {}) {
  const code = String(row?.salesman_code || row?.current_salesman_code || "").trim().toUpperCase();
  if (code) return `code:${code}`;
  const name = String(getCollectionSalesmanLabel(row) || "").trim().toUpperCase();
  if (name) return `name:${name}`;
  return "unknown";
}

export function collectionStaleOverdueSalesmanDisplay(row = {}) {
  return String(getCollectionSalesmanLabel(row) || "").trim() || "Unknown salesman";
}

export function groupCollectionStaleOverdueBySalesman(rows = []) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = collectionStaleOverdueGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        salesmanName: collectionStaleOverdueSalesmanDisplay(row),
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => (
        overdueOver60Amount(right) - overdueOver60Amount(left)
        || Number(right?.total_due_amount || 0) - Number(left?.total_due_amount || 0)
        || String(left?.customer_name || "").localeCompare(String(right?.customer_name || ""))
      )),
    }))
    .sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
}

export function formatCollectionMoney(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildCollectionStaleOverdueEmailRow(row = {}) {
  const code = String(row?.customer_code || "").trim();
  const name = String(row?.customer_name || "").trim();
  const customer = code && name ? `${code} — ${name}` : (code || name || "-");
  const visitKey = resolveLastCollectionVisitDateKey(row);
  return {
    customer,
    customerCode: code || "-",
    customerName: name || "-",
    city: String(row?.city || "").trim() || "-",
    area: String(row?.area || "").trim() || "-",
    salesman: collectionStaleOverdueSalesmanDisplay(row),
    dueAmount: Number(row?.total_due_amount || 0) || 0,
    over60Amount: overdueOver60Amount(row),
    maxOverdueDays: Number(row?.max_overdue_days || 0) || 0,
    receivedLast10Days: Number(row?.received_last_10_days || 0) || 0,
    lastVisitDate: visitKey || "Never",
    lastOutcome: String(
      row?.latest_collection?.visit_outcome
      || row?.latest_collection?.payment_status
      || "",
    ).trim() || "-",
  };
}

export function summarizeCollectionStaleOverdueRows(rows = []) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.customers += 1;
      totals.dueAmount += Number(row?.dueAmount || 0);
      totals.over60Amount += Number(row?.over60Amount || 0);
      return totals;
    },
    { customers: 0, dueAmount: 0, over60Amount: 0 },
  );
}

function tableHeader() {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c5c);background-color:#0f4c5c;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Customer</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">City / Area</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Due</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Over 60</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Max overdue</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Recv 10d</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last visit</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last outcome</th>
  </tr>`;
}

function tableRow(row, index) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c5c;">${escapeHtml(row.customer)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(`${row.city} / ${row.area}`)}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatCollectionMoney(row.dueAmount))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#b91c1c;">${escapeHtml(formatCollectionMoney(row.over60Amount))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(String(row.maxOverdueDays))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatCollectionMoney(row.receivedLast10Days))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.lastVisitDate)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.lastOutcome)}</td>
  </tr>`;
}

function totalRow(totals) {
  return `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="2">Total (${totals.customers} customer${totals.customers === 1 ? "" : "s"})</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#0f766e;">${escapeHtml(formatCollectionMoney(totals.dueAmount))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#b91c1c;">${escapeHtml(formatCollectionMoney(totals.over60Amount))}</td>
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="4"></td>
  </tr>`;
}

function renderTable(rows) {
  const totals = summarizeCollectionStaleOverdueRows(rows);
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index)).join("")
    : `<tr><td colspan="8" style="border:1px solid #99f6e4;padding:12px;background:#fff7ed;color:#9a3412;">No matching customers.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
    <thead>${tableHeader()}</thead>
    <tbody>${body}${rows.length ? totalRow(totals) : ""}</tbody>
  </table>`;
}

function summaryCards(totals, groupCount) {
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 0;margin:0 0 16px;">
  <tr>
    <td style="width:25%;padding:0 6px 0 0;vertical-align:top;">
      <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#0e7490;text-transform:uppercase;letter-spacing:0.04em;">Customers</div>
        <div style="font-size:22px;font-weight:800;color:#155e75;margin-top:4px;">${escapeHtml(String(totals.customers))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 6px;vertical-align:top;">
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#a16207;text-transform:uppercase;letter-spacing:0.04em;">Salesmen</div>
        <div style="font-size:22px;font-weight:800;color:#854d0e;margin-top:4px;">${escapeHtml(String(groupCount))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 6px;vertical-align:top;">
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;">Due amount</div>
        <div style="font-size:18px;font-weight:800;color:#14532d;margin-top:4px;">${escapeHtml(formatCollectionMoney(totals.dueAmount))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 0 0 6px;vertical-align:top;">
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:0.04em;">Over 60 days</div>
        <div style="font-size:18px;font-weight:800;color:#7f1d1d;margin-top:4px;">${escapeHtml(formatCollectionMoney(totals.over60Amount))}</div>
      </div>
    </td>
  </tr>
</table>`;
}

function renderSalesmanSections(groups) {
  if (!groups.length) {
    return `<div style="padding:14px;border:1px solid #fed7aa;background:#fff7ed;border-radius:10px;color:#9a3412;">No customers match the stale overdue filters today.</div>`;
  }

  return groups.map((group) => {
    const rows = (group.rows || []).map((row) => buildCollectionStaleOverdueEmailRow(row));
    const totals = summarizeCollectionStaleOverdueRows(rows);
    return `<div style="margin:0 0 22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;">
        <h3 style="margin:0;font-size:16px;color:#0f4c5c;">${escapeHtml(group.salesmanName)}</h3>
        <span style="font-size:12px;font-weight:700;color:#0e7490;background:#ecfeff;border:1px solid #67e8f9;border-radius:999px;padding:4px 10px;">
          ${escapeHtml(String(totals.customers))} · Over 60 ${escapeHtml(formatCollectionMoney(totals.over60Amount))}
        </span>
      </div>
      ${renderTable(rows)}
    </div>`;
  }).join("");
}

function textSections(groups) {
  if (!groups.length) return "No customers match the stale overdue filters today.";
  return groups.map((group) => {
    const rows = (group.rows || []).map((row) => buildCollectionStaleOverdueEmailRow(row));
    const totals = summarizeCollectionStaleOverdueRows(rows);
    return [
      `## ${group.salesmanName}`,
      "Customer | City/Area | Due | Over 60 | Max overdue | Recv 10d | Last visit | Last outcome",
      ...rows.map((row) => [
        row.customer,
        `${row.city} / ${row.area}`,
        formatCollectionMoney(row.dueAmount),
        formatCollectionMoney(row.over60Amount),
        row.maxOverdueDays,
        formatCollectionMoney(row.receivedLast10Days),
        row.lastVisitDate,
        row.lastOutcome,
      ].join(" | ")),
      `Total | ${totals.customers} customers | ${formatCollectionMoney(totals.dueAmount)} | ${formatCollectionMoney(totals.over60Amount)}`,
      "",
    ].join("\n");
  }).join("\n");
}

export function buildCollectionStaleOverdueReportUrl(env = process.env) {
  const base = resolveAppOrigin(env).replace(/\/+$/, "");
  return `${base}/management/payment-collections`;
}

export function buildCollectionStaleOverdueEmail({
  date,
  groups = [],
  reportUrl = "",
} = {}) {
  const allRows = groups.flatMap((group) => (
    (group.rows || []).map((row) => buildCollectionStaleOverdueEmailRow(row))
  ));
  const totals = summarizeCollectionStaleOverdueRows(allRows);
  const subject = `Stale overdue collections ${date} — ${totals.customers} customers / ${groups.length} salesmen`;
  const link = String(reportUrl || "").trim();
  const intro = `Customers with outstanding older than 60 days, no receipt in the last ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS} days, and no collection visit in the last ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS} days (or never visited). One table per salesman.`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,76,92,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c5c 55%,#155e75 100%);background-color:#0f4c5c;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Stale overdue collections</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)}</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      ${summaryCards(totals, groups.length)}
      ${renderSalesmanSections(groups)}
      ${link ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(link)}" style="color:#0f766e;font-weight:700;">Open Payment Collections</a></p>` : ""}
      <p style="margin:16px 0 0; color: #64748b; font-size: 12px;">Daily digest for credit follow-up. Filters: over-60 outstanding &gt; 0, received last 10 days = 0, last collection visit older than 7 days.</p>
    </div>
  </div>
</div>`;

  const text = [
    `Stale overdue collections — ${date}`,
    intro,
    "",
    textSections(groups),
    link ? `Report: ${link}` : "",
  ].filter(Boolean).join("\n");

  return { subject, text, html, customerCount: totals.customers, totals, groupCount: groups.length };
}

export function parseCollectionStaleOverdueLastSent(value) {
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
