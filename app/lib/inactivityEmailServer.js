import { resolveReportingChain } from "./salesHierarchy.js";
import {
  INACTIVITY_EMAIL_TYPE,
  buildInactivityAlertEmail,
  inactivityEmailDisplayName,
  inactivityEmailReferenceKey,
  resolveInactivityEmailRecipients,
} from "./inactivityEmail.js";
import { loadActiveFieldUsers, loadUserActivity } from "./workdayActivityLoaders.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { resolveUserReportEmail } from "./dailyVisitReportEmail.js";
import {
  getKsaDateString,
  inactivityReferenceTimestamp,
  ksaDayBounds,
  logEventTimestamp,
  shouldEmailInactivity,
} from "./workdayActivity.js";

export { INACTIVITY_EMAIL_TYPE };

function profileEmail(profile) {
  return resolveUserReportEmail({
    reportEmail: profile?.report_email,
    email: profile?.email,
  });
}

async function loadProfilesById(admin, userIds) {
  const ids = [...new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const full = "id,salesman_code,salesman_name,email,report_email";
  const fallback = "id,salesman_code,salesman_name,email";
  let result = await admin.from("profiles").select(full).in("id", ids);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback).in("id", ids);
  }
  if (result.error) throw result.error;

  return new Map((result.data || []).map((row) => [row.id, row]));
}

async function hasSentInactivityEmail(admin, referenceKey) {
  if (!referenceKey) return false;

  const { count, error } = await admin
    .from("push_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("reference_key", referenceKey);

  if (error) throw error;
  return Number(count || 0) > 0;
}

async function logInactivityEmail(admin, {
  userId,
  title,
  body,
  successCount,
  failureCount,
  referenceKey,
}) {
  const { error } = await admin.from("push_notification_log").insert({
    user_id: userId,
    notification_type: INACTIVITY_EMAIL_TYPE,
    title,
    body,
    success_count: successCount,
    failure_count: failureCount,
    reference_key: referenceKey,
  });

  if (error) throw error;
}

export async function runInactivityEmailCycle(admin, {
  now = new Date(),
  env = process.env,
  send = sendEmail,
  resolveChain = resolveReportingChain,
  loadActiveUsers = loadActiveFieldUsers,
  loadActivity = loadUserActivity,
} = {}) {
  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      ok: true,
      skipped: true,
      reason: "email_not_configured",
      checked: 0,
      sent: 0,
    };
  }

  const reportDate = getKsaDateString(now);
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const activeUsers = await loadActiveUsers(admin, reportDate);

  let checked = 0;
  let sent = 0;
  const details = [];

  for (const { userId, loginLog } of activeUsers) {
    checked += 1;

    const loginAt = loginLog
      ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString()
      : null;

    const { logs, collections, orders } = await loadActivity(admin, userId, startIso, endIso);
    const logoutLog = [...logs].reverse().find((row) => row.entry_type === "END_OF_DAY");
    const logoutAt = logoutLog
      ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString()
      : null;

    if (!shouldEmailInactivity({
      loginAt,
      logoutAt,
      userLogs: logs,
      collections,
      orders,
      now,
    })) {
      continue;
    }

    const idleSinceTs = inactivityReferenceTimestamp({
      loginAt,
      userLogs: logs,
      collections,
      orders,
    });
    const referenceKey = inactivityEmailReferenceKey({
      userId,
      reportDate,
      idleSinceTs,
    });

    if (await hasSentInactivityEmail(admin, referenceKey)) {
      details.push({ userId, status: "skipped", reason: "already_sent" });
      continue;
    }

    const chain = await resolveChain(admin, userId);
    const profileById = await loadProfilesById(admin, [userId, ...(chain || []).map((boss) => boss.id)]);
    const userProfile = profileById.get(userId) || {};
    const chainEmails = (chain || [])
      .map((boss) => profileEmail(profileById.get(boss.id) || boss))
      .filter(Boolean);
    const { to } = resolveInactivityEmailRecipients({
      reportEmail: userProfile.report_email,
      userEmail: userProfile.email,
      chainEmails,
    });

    if (!to.length) {
      details.push({ userId, status: "skipped", reason: "no_recipients" });
      continue;
    }

    const userName = inactivityEmailDisplayName({
      salesmanName: userProfile.salesman_name,
      salesmanCode: userProfile.salesman_code,
    });
    const idleMinutes = Math.round((now.getTime() - idleSinceTs) / 60000);
    const message = buildInactivityAlertEmail({
      date: reportDate,
      userName,
      idleMinutes,
      lastActivityAt: new Date(idleSinceTs).toISOString(),
      loginAt,
    });

    try {
      const result = await send({ ...message, to }, env);
      await logInactivityEmail(admin, {
        userId,
        title: message.subject,
        body: message.text,
        successCount: 1,
        failureCount: 0,
        referenceKey,
      });
      sent += 1;
      details.push({
        userId,
        status: "sent",
        to,
        provider: result?.provider || null,
      });
    } catch (error) {
      details.push({
        userId,
        status: "failed",
        to,
        error: error.message || "Unable to send inactivity email",
      });
    }
  }

  return {
    ok: true,
    skipped: false,
    checked,
    sent,
    reportDate,
    details,
  };
}
