import { formatDurationMinutes, buildGoogleMapsPointUrl } from "./geo.js";
import { parseEmailList, isLikelyEmail } from "./mailer.js";
import {
  formatAchievementPercent,
  formatPerformanceKpiLine,
  formatPerformanceKpiValue,
  performanceUpdatedStatusLabel,
} from "./performanceKpis.js";
import { KSA_TIMEZONE } from "./workdayActivity.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatReportTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", {
    timeZone: KSA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatKm(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(digits)} km`;
}

export function resolveVisitReportRecipients({
  userEmail,
  managerEmails,
  sendToUser = true,
} = {}) {
  const managers = parseEmailList(
    Array.isArray(managerEmails) ? managerEmails.join(",") : managerEmails,
  );
  const user = sendToUser && isLikelyEmail(userEmail) ? parseEmailList(userEmail)[0] : "";
  const to = [];

  if (user) to.push(user);
  managers.forEach((email) => {
    if (!to.includes(email)) to.push(email);
  });

  return { to, userEmail: user || "", managerEmails: managers };
}

function distanceFromCustomerLabel(entry) {
  if (!entry?.hasEntryGps) return "No entry GPS";
  if (!entry?.hasCustomerLocation) return "No customer location";
  return formatKm(entry.distanceFromCustomerKm);
}

function transactionLabel(entry) {
  const parts = [entry?.transactionLabel || entry?.transactionType || "-"];
  if (entry?.logoutAutoClosed) parts.push("Auto-closed");
  if (entry?.isFarFromCustomer) parts.push("Far");
  return parts.join(" · ");
}

function customerLabel(entry) {
  if (entry?.customerName && entry?.customerCode) {
    return `${entry.customerName} (${entry.customerCode})`;
  }
  return entry?.customerName || entry?.customerCode || "-";
}

export function buildUserVisitReportEmail({ date, user, thresholdKm = 0.5 } = {}) {
  const userName = String(user?.userName || "User").trim() || "User";
  const subject = `Daily Visit Report — ${userName} — ${date}`;
  const lines = Array.isArray(user?.daySummary?.lines) ? user.daySummary.lines : [];
  const entries = Array.isArray(user?.entries) ? user.entries : [];
  const performance = user?.performance || null;
  const kpis = Array.isArray(performance?.kpis) ? performance.kpis : [];

  const kpiText = kpis.length
    ? [
      "Monthly KPI status:",
      ...kpis.map((kpi) => `- ${formatPerformanceKpiLine(kpi)}`),
      performanceUpdatedStatusLabel(performance),
      "",
    ]
    : [];

  const kpiHtml = kpis.length
    ? `<h2 style="font-size: 16px;">Monthly KPI status</h2>
      <p style="color:#52616b; font-size: 13px;">${escapeHtml(performanceUpdatedStatusLabel(performance))}</p>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 12px; width: 100%; margin: 0 0 16px;">
        <thead style="background: #f4f7fb;">
          <tr>
            <th>KPI</th><th>Actual</th><th>Target</th><th>Achievement</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${kpis.map((kpi) => `<tr>
            <td>${escapeHtml(kpi.label)}</td>
            <td>${escapeHtml(formatPerformanceKpiValue(kpi.key, kpi.actual))}</td>
            <td>${escapeHtml(kpi.target > 0 ? formatPerformanceKpiValue(kpi.key, kpi.target) : "—")}</td>
            <td>${escapeHtml(formatAchievementPercent(kpi.achievement))}</td>
            <td>${escapeHtml(kpi.status?.label || "No target")}</td>
          </tr>`).join("")}
        </tbody>
      </table>`
    : "";

  const summaryText = [
    `Daily visit report for ${userName}`,
    `Date: ${date} (KSA)`,
    `Entries: ${user?.visitCount || 0}`,
    `Far from customer: ${user?.farFromCustomerCount || 0}`,
    `Route total: ${formatKm(user?.totalRouteDistanceKm)}`,
    "",
    ...kpiText,
    ...(lines.length ? ["Summary:", ...lines, ""] : []),
    ...entries.map((entry) => {
      const waiting = entry.waitingMinutesFromPrevious == null
        ? "-"
        : formatDurationMinutes(entry.waitingMinutesFromPrevious);
      return [
        `${entry.visitSequence || "-"} ${formatReportTime(entry.savedAt)}`,
        transactionLabel(entry),
        customerLabel(entry),
        `From customer: ${distanceFromCustomerLabel(entry)}`,
        `From previous: ${entry.distanceFromPreviousKm == null ? "-" : formatKm(entry.distanceFromPreviousKm)}`,
        `Area: ${entry.area || "-"}`,
        `Waiting: ${waiting}`,
      ].join(" | ");
    }),
  ].join("\n");

  const summaryHtml = lines.length
    ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "<p>No visit summary lines for this day.</p>";

  const rowsHtml = entries.length
    ? entries.map((entry) => {
      const waiting = entry.waitingMinutesFromPrevious == null
        ? "-"
        : formatDurationMinutes(entry.waitingMinutesFromPrevious);
      const mapUrl = entry.hasEntryGps
        ? buildGoogleMapsPointUrl(entry.entryLatitude, entry.entryLongitude)
        : "";
      return `<tr>
        <td>${escapeHtml(entry.visitSequence || "-")}</td>
        <td>${escapeHtml(formatReportTime(entry.savedAt))}</td>
        <td>${escapeHtml(customerLabel(entry))}</td>
        <td>${escapeHtml(transactionLabel(entry))}</td>
        <td>${escapeHtml(distanceFromCustomerLabel(entry))}</td>
        <td>${escapeHtml(entry.distanceFromPreviousKm == null ? "-" : formatKm(entry.distanceFromPreviousKm))}</td>
        <td>${escapeHtml(entry.area || "-")}</td>
        <td>${escapeHtml(entry.street || "-")}</td>
        <td>${escapeHtml(entry.speedKmh == null ? "-" : `${Number(entry.speedKmh).toFixed(1)} km/h`)}</td>
        <td>${escapeHtml(waiting)}</td>
        <td>${escapeHtml(entry.capturePlatformLabel || "-")}</td>
        <td>${mapUrl ? `<a href="${escapeHtml(mapUrl)}">Open</a>` : "-"}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="12">No visits or orders found for this date.</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #12263f; line-height: 1.4;">
  <h1 style="font-size: 20px; margin-bottom: 8px;">Daily Visit Report</h1>
  <p style="margin: 0 0 16px;">${escapeHtml(userName)} · ${escapeHtml(date)} (KSA)</p>
  <p>
    Entries: <strong>${Number(user?.visitCount || 0)}</strong>
    · Far from customer: <strong>${Number(user?.farFromCustomerCount || 0)}</strong>
    · Route total: <strong>${escapeHtml(formatKm(user?.totalRouteDistanceKm))}</strong>
  </p>
  <p style="color:#52616b; font-size: 13px;">Entries more than ${escapeHtml(String(thresholdKm))} km from the saved customer location are marked far from customer.</p>
  ${kpiHtml}
  <h2 style="font-size: 16px;">Daily visit summary</h2>
  ${summaryHtml}
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 12px; width: 100%;">
    <thead style="background: #f4f7fb;">
      <tr>
        <th>#</th><th>Time</th><th>Customer</th><th>Transaction</th>
        <th>Distance from customer</th><th>Distance from previous</th>
        <th>Area</th><th>Street</th><th>Speed</th><th>Est. waiting</th>
        <th>Platform</th><th>Map</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

  return { subject, html, text: summaryText };
}
