import { escapeHtml, formatReportTime, resolveUserReportEmail } from "./dailyVisitReportEmail.js";
import { parseEmailList } from "./mailer.js";
import { formatIdleDuration } from "./collectionDaySummary.js";
import { INACTIVITY_EMAIL_MS } from "./workdayActivity.js";

export const INACTIVITY_EMAIL_TYPE = "inactivity_email";
export const LATE_LOGIN_EMAIL_TYPE = "late_login_email";
export const INACTIVITY_EMAIL_MINUTES = Math.round(INACTIVITY_EMAIL_MS / 60000);
export const DEFAULT_APP_ORIGIN = "https://madiba-sfa.vercel.app";
export const STAGING_APP_ORIGIN = "https://madiba-sfa-staging.vercel.app";

function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function isStableAppOrigin(value) {
  const host = normalizeOrigin(value).replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  if (!host) return false;
  // Unique Vercel deployment hosts, e.g. madiba-orgalroyz-maliks-projects-c6b39514.vercel.app
  if (/-projects-[a-z0-9]+\.vercel\.app$/i.test(host)) return false;
  if (host.includes("-git-") && host.endsWith(".vercel.app")) return false;
  return true;
}

export function resolveAppOrigin(env = process.env) {
  const configured = normalizeOrigin(
    env.APP_ORIGIN || env.NEXT_PUBLIC_APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || "",
  );
  if (configured && isStableAppOrigin(configured)) {
    return configured;
  }

  const productionAlias = normalizeOrigin(env.VERCEL_PROJECT_PRODUCTION_URL || "");
  if (productionAlias && isStableAppOrigin(productionAlias)) {
    return productionAlias;
  }

  const vercel = normalizeOrigin(env.VERCEL_URL || "");
  if (vercel && isStableAppOrigin(vercel)) {
    return vercel;
  }

  if (String(env.NEXT_PUBLIC_APP_ENV || "").trim().toLowerCase() === "staging") {
    return STAGING_APP_ORIGIN;
  }

  return DEFAULT_APP_ORIGIN;
}

export function buildDailyVisitReportPageUrl({ date, userId, origin } = {}) {
  const base = String(origin || DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (date) params.set("date", String(date));
  if (userId) params.set("userId", String(userId));
  const query = params.toString();
  return `${base}/management/daily-visit-report${query ? `?${query}` : ""}`;
}

export function inactivityEmailDisplayName({ salesmanName = "", salesmanCode = "" } = {}) {
  const name = String(salesmanName || "").trim() || "Field user";
  const code = String(salesmanCode || "").trim();
  return code ? `${name} (${code})` : name;
}

export function resolveInactivityEmailRecipients({
  userEmail,
  reportEmail,
  chainEmails,
} = {}) {
  const user = resolveUserReportEmail({ reportEmail, email: userEmail });
  const chain = parseEmailList(
    Array.isArray(chainEmails) ? chainEmails.join(",") : chainEmails,
  );
  const to = [];

  if (user) to.push(user);
  chain.forEach((address) => {
    if (!to.includes(address)) to.push(address);
  });

  return { to, userEmail: user || "", chainEmails: chain };
}

export function inactivityEmailReferenceKey({ userId, reportDate, idleSinceTs, slot } = {}) {
  return `inactivity_email:${String(userId || "").trim()}:${String(reportDate || "").trim()}:${Number(idleSinceTs) || 0}:${Number(slot) || 0}`;
}

export function attachInactivityEmailSendGaps(sends = []) {
  const lastByUser = new Map();
  return (sends || []).map((row) => {
    const userId = String(row?.userId || "").trim();
    const sentTs = Date.parse(String(row?.sentAt || ""));
    const previous = lastByUser.get(userId);
    const previousTs = Date.parse(String(previous?.sentAt || ""));
    const gapMinutes = userId && Number.isFinite(sentTs) && Number.isFinite(previousTs)
      ? Math.round((sentTs - previousTs) / 60000)
      : null;
    if (userId && Number.isFinite(sentTs)) lastByUser.set(userId, row);
    return { ...row, gapMinutes };
  });
}

export function shouldRecordInactivityEmailCheck(state = {}) {
  if (state?.eligible) return true;
  if (Number(state?.idleMinutes || 0) >= INACTIVITY_EMAIL_MINUTES) return true;
  return ["lunch_break", "already_sent", "no_recipients", "failed"].includes(String(state?.reason || ""));
}

export function lateLoginEmailReferenceKey({ userId, reportDate, slot } = {}) {
  return `late_login_email:${String(userId || "").trim()}:${String(reportDate || "").trim()}:${Number(slot) || 0}`;
}

export function buildInactivityAlertEmail({
  date,
  userName,
  idleMinutes,
  lastActivityAt,
  loginAt,
  userId,
  origin,
} = {}) {
  const who = inactivityEmailDisplayName({ salesmanName: userName });
  const minutes = Math.max(
    INACTIVITY_EMAIL_MINUTES,
    Math.round(Number(idleMinutes) || INACTIVITY_EMAIL_MINUTES),
  );
  const idleLabel = formatIdleDuration(minutes);
  const lastActivity = formatReportTime(lastActivityAt);
  const loginTime = formatReportTime(loginAt);
  const subject = `No activity for ${idleLabel} — ${who} — ${date}`;
  const reportUrl = userId
    ? buildDailyVisitReportPageUrl({ date, userId, origin })
    : "";

  const text = [
    `${who} has no visit, order, or collection logged for ${idleLabel}.`,
    `Date (KSA): ${date}`,
    `Login: ${loginTime}`,
    `Idle since: ${lastActivity}`,
    `Idle time starts at login or lunch in, then resets only on a visit, submitted order, or collection. Background order updates are ignored.`,
    `This alert is sent every ${INACTIVITY_EMAIL_MINUTES} minutes until 10:00 PM KSA or the next visit, order, or collection, and is skipped during lunch break.`,
    reportUrl ? `Daily Visit Report: ${reportUrl}` : "",
  ].filter(Boolean).join("\n");

  const html = `<div style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
  <h2 style="margin: 0 0 12px;">No activity logged</h2>
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(who)}</strong> has no visit, order, or collection logged for <strong>${escapeHtml(idleLabel)}</strong>.</p>
  <table style="border-collapse: collapse; font-size: 14px;">
    <tr><td style="padding: 4px 12px 4px 0; color: #52616b;">Date (KSA)</td><td>${escapeHtml(date || "-")}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #52616b;">Login</td><td>${escapeHtml(loginTime)}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #52616b;">Idle since</td><td>${escapeHtml(lastActivity)}</td></tr>
  </table>
  <p style="margin: 16px 0 0; color: #52616b; font-size: 13px;">An email is sent every ${INACTIVITY_EMAIL_MINUTES} minutes until 10:00 PM KSA to the user and bosses in the reporting hierarchy until the next visit, order, or collection. Lunch break is excluded.</p>
  ${reportUrl ? `<p style="margin: 16px 0 0;"><a href="${escapeHtml(reportUrl)}" style="color: #0b5cab; font-weight: 600;">Open Daily Visit Report</a></p>` : ""}
</div>`;

  return { subject, text, html, reportUrl };
}

export function buildLateLoginReminderEmail({
  date,
  userName,
  reminderTime,
  userId,
  origin,
} = {}) {
  const who = inactivityEmailDisplayName({ salesmanName: userName });
  const checkedAt = formatReportTime(reminderTime);
  const subject = `Not logged in by 11:00 — ${who} — ${date}`;
  const reportUrl = userId
    ? buildDailyVisitReportPageUrl({ date, userId, origin })
    : "";

  const text = [
    `${who} has not logged morning attendance by 11:00 KSA.`,
    `Date (KSA): ${date}`,
    `Checked at: ${checkedAt}`,
    "This reminder is sent every 30 minutes until the user logs in, to the user and bosses in the reporting hierarchy.",
    reportUrl ? `Daily Visit Report: ${reportUrl}` : "",
  ].filter(Boolean).join("\n");

  const html = `<div style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
  <h2 style="margin: 0 0 12px;">Not logged in by 11:00</h2>
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(who)}</strong> has not logged morning attendance by <strong>11:00 KSA</strong>.</p>
  <table style="border-collapse: collapse; font-size: 14px;">
    <tr><td style="padding: 4px 12px 4px 0; color: #52616b;">Date (KSA)</td><td>${escapeHtml(date || "-")}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #52616b;">Checked at</td><td>${escapeHtml(checkedAt)}</td></tr>
  </table>
  <p style="margin: 16px 0 0; color: #52616b; font-size: 13px;">A reminder is sent every 30 minutes until login, to the user and bosses in the reporting hierarchy.</p>
  ${reportUrl ? `<p style="margin: 16px 0 0;"><a href="${escapeHtml(reportUrl)}" style="color: #0b5cab; font-weight: 600;">Open Daily Visit Report</a></p>` : ""}
</div>`;

  return { subject, text, html, reportUrl };
}
