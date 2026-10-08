import { formatAchievementPercent, formatPerformanceKpiValue } from "./performanceKpis.js";
import { normalizeDeliverableEmail, parseEmailList } from "./mailer.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function changedKpiTargetKeys(previous = {}, next = {}) {
  const keys = ["officeSupplies", "otherSales", "collection", "newCustomers", "repeatCustomers"];
  return keys.filter((key) => Number(previous[key] || 0) !== Number(next[key] || 0));
}

export function resolveKpiTargetEmailRecipients({ reportEmail, email, chainEmails = [] } = {}) {
  const toEmail = normalizeDeliverableEmail(reportEmail) || normalizeDeliverableEmail(email);
  const to = toEmail ? [toEmail] : [];
  const cc = [...new Set(parseEmailList(Array.isArray(chainEmails) ? chainEmails.join(",") : chainEmails))]
    .filter((address) => !to.includes(address));
  return { to, cc };
}

export function buildKpiTargetsEmail({ snapshot, month, changedLabels = [] } = {}) {
  const name = String(snapshot?.salesmanName || snapshot?.salesmanCode || "Salesman").trim();
  const subject = `Updated KPIs — ${month} — ${name}`;
  const rows = (snapshot?.kpis || []).map((kpi) => ({
    label: String(kpi.label || kpi.key || "KPI"),
    actual: formatPerformanceKpiValue(kpi.key, kpi.actual),
    target: Number(kpi.target) > 0 ? formatPerformanceKpiValue(kpi.key, kpi.target) : "—",
    achievement: formatAchievementPercent(kpi.achievement),
    status: String(kpi.status?.label || "No target"),
  }));
  const changed = changedLabels.length ? `Updated KPIs: ${changedLabels.join(", ")}` : "Current monthly KPI status";
  const htmlRows = rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.actual)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.achievement)}</td><td>${escapeHtml(row.status)}</td></tr>`).join("");
  const textRows = rows.map((row) => `- ${row.label}: actual ${row.actual}, target ${row.target}, achievement ${row.achievement}, status ${row.status}`);
  return {
    subject,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#12263f;line-height:1.4"><h1 style="font-size:20px">Monthly KPIs — ${escapeHtml(month)}</h1><p>${escapeHtml(name)}</p><p>${escapeHtml(changed)}</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;width:100%"><thead style="background:#0f4c5c;color:#fff"><tr><th>KPI</th><th>Actual</th><th>Target</th><th>Achievement</th><th>Status</th></tr></thead><tbody>${htmlRows}</tbody></table></body></html>`,
    text: [`Monthly KPIs — ${month}`, name, changed, "", ...textRows].join("\n"),
  };
}