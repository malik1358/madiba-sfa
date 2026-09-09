import { resolveReportingChain } from "./salesHierarchy.js";
import {
  INACTIVITY_EMAIL_TYPE,
  LATE_LOGIN_EMAIL_TYPE,
  attachInactivityEmailSendGaps,
  buildInactivityAlertEmail,
  buildLateLoginReminderEmail,
  inactivityEmailDisplayName,
  inactivityEmailReferenceKey,
  lateLoginEmailReferenceKey,
  resolveAppOrigin,
  resolveInactivityEmailRecipients,
  shouldRecordInactivityEmailCheck,
} from "./inactivityEmail.js";
import {
  loadActiveFieldUsers,
  loadUserActivity,
  loadUsersPendingMorningLogin,
} from "./workdayActivityLoaders.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { isMissingRelationError } from "./schemaGuards.js";
import { resolveUserReportEmail } from "./dailyVisitReportEmail.js";
import {
  describeInactivityEmailState,
  getKsaDateString,
  inactivityEmailReminderSlot,
  ksaDayBounds,
  lateLoginReminderSlot,
  logEventTimestamp,
  shouldSendLateLoginReminder,
} from "./workdayActivity.js";

export { INACTIVITY_EMAIL_TYPE, LATE_LOGIN_EMAIL_TYPE };

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
  notificationType = INACTIVITY_EMAIL_TYPE,
  title,
  body,
  successCount,
  failureCount,
  referenceKey,
}) {
  const { error } = await admin.from("push_notification_log").insert({
    user_id: userId,
    notification_type: notificationType,
    title,
    body,
    success_count: successCount,
    failure_count: failureCount,
    reference_key: referenceKey,
  });

  if (error) throw error;
}

function compactInactivityCheck(row) {
  return {
    userId: row.userId,
    kind: row.kind || "inactivity",
    status: row.status,
    reason: row.reason || null,
    slot: Number.isFinite(Number(row.slot)) ? Number(row.slot) : null,
    idleMinutes: Number.isFinite(Number(row.idleMinutes)) ? Number(row.idleMinutes) : null,
    idleSince: row.idleSince || null,
    to: Array.isArray(row.to) ? row.to : [],
    error: row.error || null,
  };
}

async function persistInactivityEmailCycleLog(admin, {
  now,
  reportDate,
  checked = 0,
  sent = 0,
  loginRemindersSent = 0,
  skipped = false,
  reason = null,
  details = [],
}) {
  if (!admin?.from) return;

  const { error } = await admin.from("inactivity_email_cycle_log").insert({
    ran_at: now instanceof Date ? now.toISOString() : new Date().toISOString(),
    report_date: reportDate,
    checked,
    sent,
    login_reminders_sent: loginRemindersSent,
    skipped,
    skip_reason: reason || null,
    details: (details || []).map(compactInactivityCheck),
  });

  if (error && !isMissingRelationError(error)) throw error;
}

export async function loadInactivityEmailLog(admin, {
  reportDate,
  userId = "",
} = {}) {
  const date = String(reportDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }

  const filterUserId = String(userId || "").trim();
  const { startIso, endIso } = ksaDayBounds(date);

  let sendQuery = admin
    .from("push_notification_log")
    .select("id,user_id,notification_type,title,body,success_count,failure_count,sent_at,reference_key")
    .in("notification_type", [INACTIVITY_EMAIL_TYPE, LATE_LOGIN_EMAIL_TYPE])
    .gte("sent_at", startIso)
    .lte("sent_at", endIso)
    .order("sent_at", { ascending: true });

  if (filterUserId) sendQuery = sendQuery.eq("user_id", filterUserId);

  const sendResult = await sendQuery;
  if (sendResult.error && !isMissingRelationError(sendResult.error)) throw sendResult.error;

  const cycleResult = await admin
    .from("inactivity_email_cycle_log")
    .select("id,ran_at,report_date,checked,sent,login_reminders_sent,skipped,skip_reason,details")
    .eq("report_date", date)
    .order("ran_at", { ascending: true });

  if (cycleResult.error && !isMissingRelationError(cycleResult.error)) throw cycleResult.error;

  const sendRows = sendResult.data || [];
  const userIds = [...new Set([
    ...sendRows.map((row) => row.user_id),
    ...(cycleResult.data || []).flatMap((row) => (row.details || []).map((item) => item.userId)),
  ].filter(Boolean))];
  const profileById = await loadProfilesById(admin, userIds);

  const sends = attachInactivityEmailSendGaps(sendRows.map((row) => {
    const profile = profileById.get(row.user_id) || {};
    return {
      id: row.id,
      userId: row.user_id,
      userName: inactivityEmailDisplayName({
        salesmanName: profile.salesman_name,
        salesmanCode: profile.salesman_code,
      }),
      type: row.notification_type,
      title: row.title || "",
      sentAt: row.sent_at,
      successCount: Number(row.success_count || 0),
      failureCount: Number(row.failure_count || 0),
      referenceKey: row.reference_key || "",
    };
  }));

  const cycles = (cycleResult.data || []).map((row) => {
    const details = (row.details || [])
      .filter((item) => !filterUserId || item.userId === filterUserId)
      .map((item) => {
        const profile = profileById.get(item.userId) || {};
        return {
          ...compactInactivityCheck(item),
          ranAt: row.ran_at,
          userName: inactivityEmailDisplayName({
            salesmanName: profile.salesman_name,
            salesmanCode: profile.salesman_code,
          }),
        };
      });
    return {
      id: row.id,
      ranAt: row.ran_at,
      reportDate: row.report_date,
      checked: Number(row.checked || 0),
      sent: Number(row.sent || 0),
      loginRemindersSent: Number(row.login_reminders_sent || 0),
      skipped: Boolean(row.skipped),
      skipReason: row.skip_reason || null,
      details,
    };
  });

  return {
    reportDate: date,
    sends,
    cycles,
    checks: cycles.flatMap((cycle) => cycle.details),
  };
}

async function sendHierarchyAlert({
  admin,
  userId,
  resolveChain,
  message,
  referenceKey,
  notificationType,
  send,
  env,
}) {
  if (await hasSentInactivityEmail(admin, referenceKey)) {
    return { userId, status: "skipped", reason: "already_sent" };
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
    return { userId, status: "skipped", reason: "no_recipients" };
  }

  try {
    const result = await send({ ...message, to }, env);
    await logInactivityEmail(admin, {
      userId,
      notificationType,
      title: message.subject,
      body: message.text,
      successCount: 1,
      failureCount: 0,
      referenceKey,
    });
    return {
      userId,
      status: "sent",
      to,
      provider: result?.provider || null,
    };
  } catch (error) {
    return {
      userId,
      status: "failed",
      to,
      error: error.message || "Unable to send inactivity email",
    };
  }
}

export async function runInactivityEmailCycle(admin, {
  now = new Date(),
  env = process.env,
  send = sendEmail,
  resolveChain = resolveReportingChain,
  loadActiveUsers = loadActiveFieldUsers,
  loadActivity = loadUserActivity,
  loadPendingLoginUsers = loadUsersPendingMorningLogin,
} = {}) {
  const reportDate = getKsaDateString(now);

  if (!isEmailConfigured(getMailerConfig(env))) {
    const skippedResult = {
      ok: true,
      skipped: true,
      reason: "email_not_configured",
      checked: 0,
      sent: 0,
      loginRemindersSent: 0,
      reportDate,
      details: [],
    };
    await persistInactivityEmailCycleLog(admin, { now, ...skippedResult });
    return skippedResult;
  }

  const appOrigin = resolveAppOrigin(env);
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const activeUsers = await loadActiveUsers(admin, reportDate);

  let checked = 0;
  let sent = 0;
  let loginRemindersSent = 0;
  const details = [];

  const pendingLoginUsers = shouldSendLateLoginReminder({ loginAt: null, now })
    ? await loadPendingLoginUsers(admin, reportDate)
    : [];
  const loginSlot = lateLoginReminderSlot(now);
  for (const { userId } of pendingLoginUsers) {
    const userProfilePlaceholder = await loadProfilesById(admin, [userId]);
    const pendingProfile = userProfilePlaceholder.get(userId) || {};
    const userName = inactivityEmailDisplayName({
      salesmanName: pendingProfile.salesman_name,
      salesmanCode: pendingProfile.salesman_code,
    });
    const message = buildLateLoginReminderEmail({
      date: reportDate,
      userName,
      reminderTime: now,
      userId,
      origin: appOrigin,
    });
    const outcome = await sendHierarchyAlert({
      admin,
      userId,
      resolveChain,
      message,
      referenceKey: lateLoginEmailReferenceKey({ userId, reportDate, slot: loginSlot }),
      notificationType: LATE_LOGIN_EMAIL_TYPE,
      send,
      env,
    });
    details.push({ ...outcome, kind: "late_login" });
    if (outcome.status === "sent") loginRemindersSent += 1;
  }

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

    const state = describeInactivityEmailState({
      loginAt,
      logoutAt,
      userLogs: logs,
      collections,
      orders,
      now,
    });

    if (!state.eligible) {
      if (shouldRecordInactivityEmailCheck(state)) {
        details.push({
          userId,
          kind: "inactivity",
          status: "skipped",
          reason: state.reason,
          slot: state.slot,
          idleMinutes: state.idleMinutes,
          idleSince: state.idleSinceTs ? new Date(state.idleSinceTs).toISOString() : null,
        });
      }
      continue;
    }

    const profileById = await loadProfilesById(admin, [userId]);
    const userProfile = profileById.get(userId) || {};
    const userName = inactivityEmailDisplayName({
      salesmanName: userProfile.salesman_name,
      salesmanCode: userProfile.salesman_code,
    });
    const message = buildInactivityAlertEmail({
      date: reportDate,
      userName,
      idleMinutes: state.idleMinutes,
      lastActivityAt: new Date(state.idleSinceTs).toISOString(),
      loginAt,
      userId,
      origin: appOrigin,
    });
    const outcome = await sendHierarchyAlert({
      admin,
      userId,
      resolveChain,
      message,
      referenceKey: inactivityEmailReferenceKey({
        userId,
        reportDate,
        idleSinceTs: state.idleSinceTs,
        slot: inactivityEmailReminderSlot(state.idleSinceTs, now),
      }),
      notificationType: INACTIVITY_EMAIL_TYPE,
      send,
      env,
    });
    details.push({
      ...outcome,
      kind: "inactivity",
      slot: state.slot,
      idleMinutes: state.idleMinutes,
      idleSince: new Date(state.idleSinceTs).toISOString(),
      reason: outcome.reason || (outcome.status === "sent" ? "sent" : null),
    });
    if (outcome.status === "sent") sent += 1;
  }

  const result = {
    ok: true,
    skipped: false,
    checked,
    sent,
    loginRemindersSent,
    reportDate,
    details,
  };
  await persistInactivityEmailCycleLog(admin, { now, ...result });
  return result;
}
