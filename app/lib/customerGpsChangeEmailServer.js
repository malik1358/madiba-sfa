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

function countCell(value) {
  return Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : "0";
}

export function buildGpsChangeEmail(date, rows) {
  const headers = ["Customer", "Accepted by", "Saved at (KSA)", "Previous GPS", "New GPS", "Distance (m)", "Times today", "Total times"];
  const body = rows.map((row, index) => {
    const timesToday = Number(row.times_today) || 0;
    const repeatStyle = timesToday > 1 ? "font-weight:700;color:#9f1239" : "";
    const cells = [
      escapeHtml(`${row.customer_code} ${row.customer_name || ""}`.trim()),
      escapeHtml(row.updated_by_name || row.updated_by || "Unknown user"),
      escapeHtml(formatKsaDateTime(row.created_at)),
      `<a href="${escapeHtml(row.old_map_url)}">${escapeHtml(coordinates(row.previous_latitude, row.previous_longitude))}</a>`,
      `<a href="${escapeHtml(row.new_map_url)}">${escapeHtml(coordinates(row.latitude, row.longitude))}</a>`,
      escapeHtml(Number(row.distance_meters).toFixed(1)),
      `<span style="${repeatStyle}">${escapeHtml(countCell(row.times_today))}</span>`,
      escapeHtml(countCell(row.times_total)),
    ];
    return `<tr style="background:${index % 2 ? "#ecfdf5" : "#ffffff"}">${cells.map((cell) => `<td style="padding:8px;border:1px solid #a7d8d5">${cell}</td>`).join("")}</tr>`;
  }).join("");
  return {
    subject: `Salesman-accepted GPS changes - ${date} (${rows.length})`,
    html: `<div style="font-family:Arial,sans-serif"><h2>Customer GPS changes - ${escapeHtml(date)}</h2><p>${rows.length} location changes accepted by salesmen.</p><table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#0f4c5c;color:#ffffff">${headers.map((header) => `<th style="padding:10px;text-align:left">${header}</th>`).join("")}</tr></thead><tbody>${body || '<tr><td colspan="8" style="padding:12px">No salesman-accepted GPS changes for this day.</td></tr>'}</tbody><tfoot><tr style="background:#0f4c5c;color:white"><th colspan="7" style="padding:10px;text-align:left">Total changes</th><td style="padding:10px">${rows.length}</td></tr></tfoot></table><p>Distances are straight-line displacement. Times today = salesman-accepted changes for that customer on this report day. Total times = all salesman-accepted GPS updates for that customer (lifetime). Times are Asia/Riyadh. Offline changes appear on the day they sync successfully.</p></div>`,
    text: [
      `Customer GPS changes - ${date}: ${rows.length}`,
      headers.join(" | "),
      ...rows.map((row) => [row.customer_code, row.customer_name || "", row.updated_by_name || row.updated_by, formatKsaDateTime(row.created_at), coordinates(row.previous_latitude, row.previous_longitude), coordinates(row.latitude, row.longitude), `${Number(row.distance_meters).toFixed(1)} m`, `today ${countCell(row.times_today)}`, `total ${countCell(row.times_total)}`, row.old_map_url, row.new_map_url].join(" | ")),
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

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function runGpsChangeEmailCycle(admin, {
  date = "", now = new Date(), env = process.env, force = false,
  send = sendEmail, loadRows = loadAcceptedGpsChanges,
  claimSend = claimGpsChangeEmail, finishSend = finishGpsChangeEmail, releaseSend = releaseGpsChangeEmail,
} = {}) {
  const reportDate = parseGpsReportDate(date || addKsaCalendarDays(getKsaDateString(now), -1));
  if (reportDate >= getKsaDateString(now)) throw new Error("GPS digest requires a completed KSA calendar day.");
  const forceSend = truthyFlag(force) || truthyFlag(env.CUSTOMER_GPS_CHANGE_EMAIL_FORCE);
  const testTo = parseEmailList(env.CUSTOMER_GPS_CHANGE_EMAIL_TEST_TO || "");
  const isTestSend = testTo.length > 0;
  const to = [...new Set(isTestSend ? testTo : parseEmailList(env.CUSTOMER_GPS_CHANGE_EMAIL_TO || "malik@pinasz.com"))];
  if (!to.length) throw new Error("No GPS digest recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) throw new Error("Email is not configured on the server.");
  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, reportDate);
    if (!claim) return { date: reportDate, skipped: true, reason: "already_claimed_or_sent", sentCount: 0 };
  }
  let delivered = false;
  try {
    const rows = await loadRows(admin, reportDate);
    const message = buildGpsChangeEmail(reportDate, rows);
    if (forceSend || isTestSend) {
      message.subject = `[TEST] ${message.subject}`;
    }
    await send({ ...message, to }, env);
    delivered = true;
    if (claim) await finishSend(admin, claim, rows.length);
    return {
      date: reportDate,
      sentCount: 1,
      changeCount: rows.length,
      forced: forceSend || isTestSend,
      to,
    };
  } catch (error) {
    if (claim && !delivered) await releaseSend(admin, claim);
    throw error;
  }
}
