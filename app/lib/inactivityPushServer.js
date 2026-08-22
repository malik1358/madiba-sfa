import { shouldRequireTransactionGps } from "./moduleAccess.js";
import { isFcmConfigured, sendPushToUser } from "./fcm.js";
import {
  getKsaDateString,
  getInactivityAlertMessage,
  getLunchBreakReminderMessage,
  ksaDayBounds,
  logEventTimestamp,
  shouldSendLunchBreakReminder,
  shouldWarnInactivity,
  getOpenLunchBreakOutTimestamp,
  INACTIVITY_ALERT_REPEAT_MS,
} from "./workdayActivity.js";

export const INACTIVITY_PUSH_TYPE = "inactivity";
export const LUNCH_BREAK_REMINDER_PUSH_TYPE = "lunch_break_reminder";

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadRecentPushSentAt(admin, userId, notificationType) {
  const cutoff = new Date(Date.now() - INACTIVITY_ALERT_REPEAT_MS).toISOString();
  const { data, error } = await admin
    .from("push_notification_log")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("notification_type", notificationType)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.sent_at ? Date.parse(data.sent_at) : 0;
}

async function logPushAttempt(admin, {
  userId,
  notificationType,
  title,
  body,
  successCount,
  failureCount,
  referenceKey = null,
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

async function hasSentPushReference(admin, referenceKey) {
  if (!referenceKey) return false;

  const { count, error } = await admin
    .from("push_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("reference_key", referenceKey);

  if (error) throw error;
  return Number(count || 0) > 0;
}

async function loadActiveFieldUsers(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);

  const [{ data: morningRows, error: morningError }, { data: endRows, error: endError }] = await Promise.all([
    admin
      .from("daily_activity_logs")
      .select("user_id,note,created_at")
      .eq("entry_type", "MORNING_ATTENDANCE")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("daily_activity_logs")
      .select("user_id")
      .eq("entry_type", "END_OF_DAY")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  if (morningError) throw morningError;
  if (endError) throw endError;

  const endedUserIds = new Set((endRows || []).map((row) => row.user_id));
  const loginByUserId = new Map();

  (morningRows || []).forEach((row) => {
    if (!row?.user_id || endedUserIds.has(row.user_id)) return;
    if (loginByUserId.has(row.user_id)) return;
    loginByUserId.set(row.user_id, row);
  });

  const userIds = [...loginByUserId.keys()];
  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,role,preferred_language")
    .in("id", userIds);

  if (profileError) throw profileError;

  const profileByUserId = new Map((profiles || []).map((row) => [row.id, row]));

  return userIds
    .filter((userId) => shouldRequireTransactionGps(normalizeRole(profileByUserId.get(userId)?.role)))
    .map((userId) => ({
      userId,
      loginLog: loginByUserId.get(userId),
      preferredLanguage: profileByUserId.get(userId)?.preferred_language || "en",
    }));
}

async function loadUserActivity(admin, userId, startIso, endIso) {
  const [{ data: logs, error: logsError }, { data: collections, error: collectionsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      admin
        .from("daily_activity_logs")
        .select("entry_type,note,created_at")
        .eq("user_id", userId)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true }),
      admin
        .from("collection_visits")
        .select("saved_at")
        .eq("created_by", userId)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso),
      admin
        .from("sales_orders")
        .select("created_at,updated_at,submitted_at")
        .eq("created_by", userId)
        .gte("updated_at", startIso)
        .lte("updated_at", endIso),
    ]);

  if (logsError) throw logsError;
  if (collectionsError) throw collectionsError;
  if (ordersError) throw ordersError;

  return {
    logs: logs || [],
    collections: collections || [],
    orders: orders || [],
  };
}

export async function runInactivityPushCycle(admin, now = new Date()) {
  if (!isFcmConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "fcm_not_configured",
      checked: 0,
      sent: 0,
    };
  }

  const reportDate = getKsaDateString(now);
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const activeUsers = await loadActiveFieldUsers(admin, reportDate);

  let checked = 0;
  let sent = 0;
  let lunchRemindersSent = 0;
  const details = [];

  for (const { userId, loginLog, preferredLanguage } of activeUsers) {
    checked += 1;

    const loginAt = loginLog
      ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString()
      : null;

    const { logs, collections, orders } = await loadUserActivity(admin, userId, startIso, endIso);
    const logoutLog = [...logs].reverse().find((row) => row.entry_type === "END_OF_DAY");
    const logoutAt = logoutLog
      ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString()
      : null;

    if (shouldSendLunchBreakReminder(logs, now)) {
      const lunchOutTs = getOpenLunchBreakOutTimestamp(logs, now.getTime());
      const lunchReferenceKey = `lunch_reminder:${userId}:${lunchOutTs}`;

      if (!await hasSentPushReference(admin, lunchReferenceKey)) {
        const { title, body } = getLunchBreakReminderMessage(preferredLanguage);
        const lunchResult = await sendPushToUser(admin, userId, {
          title,
          body,
          data: {
            type: LUNCH_BREAK_REMINDER_PUSH_TYPE,
            reportDate,
          },
        });

        await logPushAttempt(admin, {
          userId,
          notificationType: LUNCH_BREAK_REMINDER_PUSH_TYPE,
          title,
          body,
          successCount: lunchResult.successCount,
          failureCount: lunchResult.failureCount,
          referenceKey: lunchReferenceKey,
        });

        if (lunchResult.successCount > 0) {
          lunchRemindersSent += 1;
        }
      }
    }

    if (!shouldWarnInactivity({
      loginAt,
      logoutAt,
      userLogs: logs,
      collections,
      orders,
      now,
    })) {
      continue;
    }

    const recentPushTs = await loadRecentPushSentAt(admin, userId, INACTIVITY_PUSH_TYPE);
    if (recentPushTs && now.getTime() - recentPushTs < INACTIVITY_ALERT_REPEAT_MS) {
      continue;
    }

    const { title, body } = getInactivityAlertMessage(preferredLanguage);

    const result = await sendPushToUser(admin, userId, {
      title,
      body,
      data: {
        type: INACTIVITY_PUSH_TYPE,
        reportDate,
      },
    });

    await logPushAttempt(admin, {
      userId,
      notificationType: INACTIVITY_PUSH_TYPE,
      title,
      body,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });

    if (result.successCount > 0) {
      sent += 1;
    }

    details.push({
      userId,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }

  return {
    ok: true,
    checked,
    sent,
    lunchRemindersSent,
    reportDate,
    details,
  };
}
