import { randomUUID } from "node:crypto";
import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import { loadAcceptedGpsChanges, parseGpsReportDate } from "./customerGpsReport.js";
import { addKsaCalendarDays, formatKsaDateTime, getKsaDateString } from "./workdayActivity.js";

export const GPS_CHANGE_EMAIL_KEY_PREFIX = "customer_gps_change_email:";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function coordinates(latitude, longitude) {
  return `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
}

export function buildGpsChangeEmail(date, rows) {
  const headers = ["Customer", "Accepted by", "Saved at (KSA)", "Previous GPS", "New GPS", "Distance (m)"];
  const body = rows.map((row, index) => {
    const cells = [
      escapeHtml(`${row.customer_code} ${row.customer_name || ""}`.trim()),
      escapeHtml(row.updated_by_name || row.updated_by || "Unknown user"),
      escapeHtml(formatKsaDateTime(row.created_at)),
      `<a href="${escapeHtml(row.old_map_url)}">${escapeHtml(coordinates(row.previous_latitude, row.previous_longitude))}</a>`,
      `<a href="${escapeHtml(row.new_map_url)}">${escapeHtml(coordinates(row.latitude, row.longitude))}</a>`,
      escapeHtml(Number(row.distance_meters).toFixed(1)),
    ];
    return `<tr style="background:${index % 2 ? "#ecfdf5" : "#ffffff"}">${cells.map((cell) => `<td style="padding:8px;border:1px solid #a7d8d5">${cell}</td>`).join("")}</tr>`;
  }).join("");
  return {
    subject: `Salesman-accepted GPS changes - ${date} (${rows.length})`,
    html: `<div style="font-family:Arial,sans-serif"><h2>Customer GPS changes - ${escapeHtml(date)}</h2><p>${rows.length} location changes accepted by salesmen.</p><table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#0f4c5c;color:#ffffff">${headers.map((header) => `<th style="padding:10px;text-align:left">${header}</th>`).join("")}</tr></thead><tbody>${body || '<tr><td colspan="6" style="padding:12px">No salesman-accepted GPS changes for this day.</td></tr>'}</tbody><tfoot><tr style="background:#0f4c5c;color:white"><th colspan="5" style="padding:10px;text-align:left">Total changes</th><td style="padding:10px">${rows.length}</td></tr></tfoot></table><p>Distances are straight-line displacement. Times are Asia/Riyadh. Offline changes appear on the day they sync successfully.</p></div>`,
    text: [
      `Customer GPS changes - ${date}: ${rows.length}`,
      headers.join(" | "),
      ...rows.map((row) => [row.customer_code, row.customer_name || "", row.updated_by_name || row.updated_by, formatKsaDateTime(row.created_at), coordinates(row.previous_latitude, row.previous_longitude), coordinates(row.latitude, row.longitude), `${Number(row.distance_meters).toFixed(1)} m`, row.old_map_url, row.new_map_url].join(" | ")),
      ...(rows.length ? [] : ["No salesman-accepted GPS changes for this day."]),
    ].join("\n"),
  };
}

export async function claimGpsChangeEmail(admin, date) {
  const settingKey = `${GPS_CHANGE_EMAIL_KEY_PREFIX}${date}`;
  const claim = JSON.stringify({ status: "sending", token: randomUUID(), claimedAt: new Date().toISOString() });
  const { error } = await admin.from("system_settings").insert({ setting_key: settingKey, setting_value: claim });
  if (error?.code === "23505") return null;
  if (error) throw error;
  return { settingKey, claim };
}

export async function finishGpsChangeEmail(admin, claim, count) {
  const { error } = await admin.from("system_settings")
    .update({ setting_value: JSON.stringify({ status: "sent", sentAt: new Date().toISOString(), changeCount: count }) })
    .eq("setting_key", claim.settingKey).eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseGpsChangeEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey).eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runGpsChangeEmailCycle(admin, {
  date = "", now = new Date(), env = process.env,
  send = sendEmail, loadRows = loadAcceptedGpsChanges,
  claimSend = claimGpsChangeEmail, finishSend = finishGpsChangeEmail, releaseSend = releaseGpsChangeEmail,
} = {}) {
  const reportDate = parseGpsReportDate(date || addKsaCalendarDays(getKsaDateString(now), -1));
  if (reportDate >= getKsaDateString(now)) throw new Error("GPS digest requires a completed KSA calendar day.");
  const to = [...new Set(parseEmailList(env.CUSTOMER_GPS_CHANGE_EMAIL_TO || "malik@pinasz.com"))];
  if (!to.length) throw new Error("No GPS digest recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) throw new Error("Email is not configured on the server.");
  const claim = await claimSend(admin, reportDate);
  if (!claim) return { date: reportDate, skipped: true, reason: "already_claimed_or_sent", sentCount: 0 };
  let delivered = false;
  try {
    const rows = await loadRows(admin, reportDate);
    await send({ ...buildGpsChangeEmail(reportDate, rows), to }, env);
    delivered = true;
    await finishSend(admin, claim, rows.length);
    return { date: reportDate, sentCount: 1, changeCount: rows.length };
  } catch (error) {
    if (!delivered) await releaseSend(admin, claim);
    throw error;
  }
}