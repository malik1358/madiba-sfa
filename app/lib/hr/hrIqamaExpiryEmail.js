import { isLikelyEmail, parseEmailList } from "../mailer.js";
import { addKsaCalendarDays, getKsaDateString } from "../workdayActivity.js";

export const HR_IQAMA_EXPIRY_EMAIL_KEY_PREFIX = "hr_iqama_expiry_email:";
export const HR_IQAMA_WARNING_DAYS = 30;
export const DEFAULT_HR_IQAMA_EXPIRY_EMAIL_TO = [
  "soyeb@noorshukran.com",
  "sohail.budhiya@noorshukran.com",
  "malik@pinasz.com",
].join(",");

const HEADER_BG = "#0f4c5c";
const ZEBRA = "#f4f8f9";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

/** Whole calendar days from asOf (YYYY-MM-DD) until target; negative when overdue. */
export function daysUntilIqamaExpiry(expiryDate, asOfDate) {
  const expiry = String(expiryDate || "").trim().slice(0, 10);
  const asOf = String(asOfDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const a = Date.parse(`${asOf}T12:00:00Z`);
  const b = Date.parse(`${expiry}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Active staff whose iqama_expiry is on or before asOf + warningDays (includes overdue).
 * Sorted: soonest/overdue first.
 */
export function listIqamaExpiringWithinDays(employees = [], {
  asOfDate = "",
  warningDays = HR_IQAMA_WARNING_DAYS,
  now = new Date(),
} = {}) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || "").trim())
    ? String(asOfDate).trim().slice(0, 10)
    : getKsaDateString(now);
  const horizon = addKsaCalendarDays(asOf, Number(warningDays) || HR_IQAMA_WARNING_DAYS);
  const rows = [];
  for (const employee of employees || []) {
    if (String(employee.status || "").toUpperCase() !== "ACTIVE") continue;
    const expiry = String(employee.iqamaExpiry || employee.iqama_expiry || "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    if (expiry > horizon) continue;
    const daysLeft = daysUntilIqamaExpiry(expiry, asOf);
    rows.push({
      employeeCode: employee.employeeCode || employee.employee_code || "",
      fullName: employee.fullName || employee.full_name || "",
      iqamaNo: employee.iqamaNo || employee.iqama_no || "",
      iqamaExpiry: expiry,
      daysLeft,
      overdue: Number.isFinite(daysLeft) ? daysLeft < 0 : false,
    });
  }
  rows.sort((a, b) => {
    if (a.iqamaExpiry !== b.iqamaExpiry) return a.iqamaExpiry < b.iqamaExpiry ? -1 : 1;
    return String(a.employeeCode).localeCompare(String(b.employeeCode));
  });
  return { asOf, horizon, warningDays: Number(warningDays) || HR_IQAMA_WARNING_DAYS, rows };
}

export function hrIqamaExpiryEmailClaimKey(date) {
  return `${HR_IQAMA_EXPIRY_EMAIL_KEY_PREFIX}${String(date || "").trim().slice(0, 10)}`;
}

export function hrIqamaExpiryEmailRecipients(env = {}) {
  const testTo = String(env.HR_IQAMA_EXPIRY_EMAIL_TEST_TO || "").trim();
  const override = String(env.HR_IQAMA_EXPIRY_EMAIL_TO || "").trim();
  const list = parseEmailList(testTo || override || DEFAULT_HR_IQAMA_EXPIRY_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

function statusLabel(row) {
  if (row.overdue) return `Overdue ${Math.abs(row.daysLeft)} day(s)`;
  if (row.daysLeft === 0) return "Expires today";
  return `${row.daysLeft} day(s) left`;
}

export function buildHrIqamaExpiryEmail(report = {}, { env = process.env } = {}) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const asOf = report.asOf || "";
  const warningDays = report.warningDays || HR_IQAMA_WARNING_DAYS;
  const overdueCount = rows.filter((row) => row.overdue).length;
  const subject = rows.length
    ? `HR Iqama expiry warning · ${rows.length} staff within ${warningDays} days (${asOf})`
    : `HR Iqama expiry warning · none within ${warningDays} days (${asOf})`;

  const bodyRows = rows.map((row, index) => {
    const bg = index % 2 === 1 ? ZEBRA : "#ffffff";
    const tone = row.overdue || row.daysLeft <= 7 ? "#b91c1c" : "#0f4c5c";
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 8px;border:1px solid #dbe4ea;font-family:ui-monospace,monospace;">${escapeHtml(row.employeeCode)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;">${escapeHtml(row.fullName)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;">${escapeHtml(row.iqamaNo || "-")}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;">${escapeHtml(formatDate(row.iqamaExpiry))}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;font-weight:600;color:${tone};">${escapeHtml(statusLabel(row))}</td>
      </tr>
    `;
  }).join("");

  const table = rows.length
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:${HEADER_BG};color:#ffffff;">
            <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Code</th>
            <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Name</th>
            <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Iqama / ID</th>
            <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Expiry</th>
            <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Status</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `
    : `<p style="margin:0;color:#64748b;">No active staff with Iqama expiry on or before ${escapeHtml(formatDate(report.horizon))}.</p>`;

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;">
      <h1 style="margin:0 0 8px;font-size:18px;color:${HEADER_BG};">Iqama expiry warning</h1>
      <p style="margin:0 0 16px;color:#475569;font-size:13px;">
        KSA as-of ${escapeHtml(formatDate(asOf))}. Active staff whose Iqama expires within ${escapeHtml(String(warningDays))} days
        (or already overdue). Overdue: ${escapeHtml(String(overdueCount))} · Total: ${escapeHtml(String(rows.length))}.
      </p>
      ${table}
      <p style="margin:16px 0 0;color:#64748b;font-size:12px;">
        Default To: Soyeb, Sohail, Malik. Update expiry on HR Employees. Recipients override: HR_IQAMA_EXPIRY_EMAIL_TO.
      </p>
    </div>
  `;

  const textLines = [
    `Iqama expiry warning (${asOf})`,
    `Within ${warningDays} days or overdue: ${rows.length} (overdue ${overdueCount})`,
    "",
    ...rows.map((row) => (
      `${row.employeeCode}\t${row.fullName}\t${row.iqamaNo || "-"}\t${row.iqamaExpiry}\t${statusLabel(row)}`
    )),
  ];

  return {
    subject,
    html,
    text: textLines.join("\n"),
    counts: {
      total: rows.length,
      overdue: overdueCount,
      warningDays,
      asOf,
      to: hrIqamaExpiryEmailRecipients(env),
    },
  };
}
