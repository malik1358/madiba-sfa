import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, normalizeDeliverableEmail, parseEmailList } from "./mailer.js";
import { formatSalesmanDisplay } from "./outstandingNoGps.js";

export const OUTSTANDING_NO_GPS_EMAIL_LAST_SENT_KEY = "outstanding_no_gps_email_last_sent";

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

export function resolveOutstandingNoGpsDigestRecipients(env = process.env) {
  return mergeEmailList([], env.OUTSTANDING_NO_GPS_EMAIL_TO);
}

export function resolveOutstandingNoGpsDigestCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList([], env.OUTSTANDING_NO_GPS_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function outstandingNoGpsGroupKey(row = {}) {
  const code = String(row?.current_salesman_code || row?.salesman_code || "").trim().toUpperCase();
  if (code) return `code:${code}`;
  const name = String(row?.salesman_name || row?.outstanding_salesman || row?.salesman_display || "")
    .trim()
    .toUpperCase();
  if (name) return `name:${name}`;
  return "unknown";
}

export function outstandingNoGpsSalesmanDisplay(row = {}, profile = null) {
  const code = String(profile?.salesman_code || row?.current_salesman_code || row?.salesman_code || "").trim();
  const name = String(
    profile?.salesman_name
    || row?.salesman_name
    || row?.outstanding_salesman
    || "",
  ).trim();
  return formatSalesmanDisplay(code, name) || "Unknown salesman";
}

export function groupOutstandingNoGpsBySalesman(rows = [], profiles = []) {
  const profileByCode = new Map();
  (profiles || []).forEach((profile) => {
    const code = String(profile?.salesman_code || "").trim().toUpperCase();
    if (code && !profileByCode.has(code)) profileByCode.set(code, profile);
  });

  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = outstandingNoGpsGroupKey(row);
    const code = String(row?.current_salesman_code || row?.salesman_code || "").trim().toUpperCase();
    const profile = profileByCode.get(code) || null;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        profile,
        salesmanName: outstandingNoGpsSalesmanDisplay(row, profile),
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });

  return [...groups.values()].sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
}

export function formatOutstandingMoney(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildOutstandingNoGpsEmailRow(row = {}, extra = {}) {
  const code = String(row?.customer_code || "").trim();
  const name = String(row?.customer_name || "").trim();
  const customer = code && name ? `${code} — ${name}` : (code || name || "-");
  return {
    customer,
    customerCode: code || "-",
    customerName: name || "-",
    city: String(row?.city || "").trim() || "-",
    area: String(row?.area || "").trim() || "-",
    salesman: outstandingNoGpsSalesmanDisplay(row, extra.profile || null),
    outstanding: Number(row?.total_outstanding || 0) || 0,
    lastInvoiceDate: String(row?.last_invoice_date || "").trim() || "-",
    lastVisitDate: String(row?.last_visit_date || "").trim() || "-",
  };
}

export function summarizeOutstandingNoGpsRows(rows = []) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.customers += 1;
      totals.outstanding += Number(row?.outstanding || 0);
      return totals;
    },
    { customers: 0, outstanding: 0 },
  );
}

function tableHeader(includeSalesman) {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c5c);background-color:#0f4c5c;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Customer</th>
    ${includeSalesman ? '<th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Salesman</th>' : ""}
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">City</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Area</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last invoice</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last visit</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Outstanding</th>
  </tr>`;
}

function tableRow(row, index, includeSalesman) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c5c;">${escapeHtml(row.customer)}</td>
    ${includeSalesman ? `<td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.salesman)}</td>` : ""}
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.city)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.area)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.lastInvoiceDate)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.lastVisitDate)}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f766e;">${escapeHtml(formatOutstandingMoney(row.outstanding))}</td>
  </tr>`;
}

function totalRow(totals, includeSalesman) {
  const span = includeSalesman ? 6 : 5;
  return `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="${span}">Total (${totals.customers} customer${totals.customers === 1 ? "" : "s"})</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#0f766e;">${escapeHtml(formatOutstandingMoney(totals.outstanding))}</td>
  </tr>`;
}

function renderTable(rows, { includeSalesman = false } = {}) {
  const totals = summarizeOutstandingNoGpsRows(rows);
  const colCount = includeSalesman ? 7 : 6;
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index, includeSalesman)).join("")
    : `<tr><td colspan="${colCount}" style="border:1px solid #99f6e4;padding:12px;background:#fff7ed;color:#9a3412;">No outstanding customers without GPS.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
    <thead>${tableHeader(includeSalesman)}</thead>
    <tbody>${body}${rows.length ? totalRow(totals, includeSalesman) : ""}</tbody>
  </table>`;
}

function summaryCards(totals) {
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 0;margin:0 0 16px;">
  <tr>
    <td style="width:50%;padding:0 6px 0 0;vertical-align:top;">
      <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#0e7490;text-transform:uppercase;letter-spacing:0.04em;">Customers</div>
        <div style="font-size:22px;font-weight:800;color:#155e75;margin-top:4px;">${escapeHtml(String(totals.customers))}</div>
      </div>
    </td>
    <td style="width:50%;padding:0 0 0 6px;vertical-align:top;">
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;">Outstanding</div>
        <div style="font-size:22px;font-weight:800;color:#14532d;margin-top:4px;">${escapeHtml(formatOutstandingMoney(totals.outstanding))}</div>
      </div>
    </td>
  </tr>
</table>`;
}

function textTable(rows, includeSalesman) {
  const header = includeSalesman
    ? "Customer | Salesman | City | Area | Last invoice | Last visit | Outstanding"
    : "Customer | City | Area | Last invoice | Last visit | Outstanding";
  const totals = summarizeOutstandingNoGpsRows(rows);
  return [
    header,
    ...rows.map((row) => [
      row.customer,
      ...(includeSalesman ? [row.salesman] : []),
      row.city,
      row.area,
      row.lastInvoiceDate,
      row.lastVisitDate,
      formatOutstandingMoney(row.outstanding),
    ].join(" | ")),
    `Total | ${totals.customers} customers | ${formatOutstandingMoney(totals.outstanding)}`,
  ].join("\n");
}

export function buildOutstandingNoGpsReportUrl(env = process.env) {
  const base = resolveAppOrigin(env).replace(/\/+$/, "");
  return `${base}/management/outstanding-no-gps`;
}

export function buildOutstandingNoGpsEmail({
  date,
  salesmanName = "",
  rows = [],
  includeSalesman = false,
  reportUrl = "",
  audience = "",
} = {}) {
  const totals = summarizeOutstandingNoGpsRows(rows);
  const who = String(salesmanName || "").trim();
  const normalizedAudience = String(audience || "").trim().toLowerCase()
    || (includeSalesman ? (who ? "boss" : "digest") : "salesman");
  const subject = who
    ? `Outstanding without GPS ${date} — ${who} (${totals.customers})`
    : `Outstanding without GPS ${date} — all salesmen (${totals.customers})`;
  const link = String(reportUrl || "").trim();
  const intro = normalizedAudience === "salesman"
    ? `Please visit these customers who have an outstanding balance and no saved GPS on the customer master. Collect what you can and update their GPS from Customer Master.`
    : normalizedAudience === "boss"
      ? `Customers with an outstanding balance and no saved GPS across your subordinates. Review and follow up with the team so each customer is visited and the master GPS is updated.`
      : `Customers with an outstanding balance and no saved GPS on the customer master, grouped by salesman. Zia, Asrar Ahmed, and legal transfers are excluded.`;
  const footer = normalizedAudience === "salesman"
    ? "Visit each customer, handle the outstanding balance, and save GPS from Customer Master so the location sticks on the master record. Bosses receive a separate consolidated team email."
    : normalizedAudience === "boss"
      ? "This team digest groups all included subordinate customers in one email so bosses do not need to track repeated CC copies."
      : "This digest groups all included customers in one email by salesman.";

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,76,92,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c5c 55%,#155e75 100%);background-color:#0f4c5c;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Outstanding without GPS</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)}</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      ${who ? `<p style="margin:0 0 16px;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ecfeff;border:1px solid #67e8f9;color:#0e7490;font-weight:800;">${escapeHtml(who)}</span></p>` : ""}
      ${summaryCards(totals)}
      ${renderTable(rows, { includeSalesman })}
      ${link ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(link)}" style="color:#0f766e;font-weight:700;">Open Outstanding Without GPS report</a></p>` : ""}
      <p style="margin:16px 0 0; color: #64748b; font-size: 12px;">${escapeHtml(footer)}</p>
    </div>
  </div>
</div>`;

  const text = [
    `Outstanding without GPS — ${date}`,
    intro,
    who,
    "",
    textTable(rows, includeSalesman),
    link ? `Report: ${link}` : "",
  ].filter(Boolean).join("\n");

  return { subject, text, html, customerCount: totals.customers, totals };
}

export function parseOutstandingNoGpsLastSent(value) {
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

export function salesmanOutstandingNoGpsRecipients({ reportEmail, email, chainEmails = [] } = {}) {
  const user = normalizeDeliverableEmail(reportEmail) || normalizeDeliverableEmail(email);
  const to = [];
  const cc = [];
  if (user) to.push(user);
  parseEmailList(Array.isArray(chainEmails) ? chainEmails.join(",") : chainEmails).forEach((address) => {
    const normalized = normalizeDeliverableEmail(address) || address;
    if (!normalized) return;
    if (to.includes(normalized) || cc.includes(normalized)) return;
    cc.push(normalized);
  });
  return { to, cc };
}
