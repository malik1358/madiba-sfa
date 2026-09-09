import { getFcmConfigurationStatus, sendPushToUser } from "./fcm.js";
import { loadActiveFieldUsers, loadUserActivity } from "./workdayActivityLoaders.js";
import {
  getKsaDateString,
  getInactivityAlertMessage,
  getLunchBreakReminderMessage,
  getLunchPunchNoonReminderMessage,
  getLunchPunchProgress,
  ksaDayBounds,
  logEventTimestamp,
  shouldRemindLunchPunchNoon,
  shouldSendLunchBreakReminder,
  shouldWarnInactivity,
  getOpenLunchBreakOutTimestamp,
  INACTIVITY_ALERT_REPEAT_MS,
} from "./workdayActivity.js";

export { loadActiveFieldUsers, loadUserActivity };

export const INACTIVITY_PUSH_TYPE = "inactivity";
export const LUNCH_BREAK_REMINDER_PUSH_TYPE = "lunch_break_reminder";
export const LUNCH_PUNCH_NOON_PUSH_TYPE = "lunch_punch_noon";

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

export async function runInactivityPushCycle(admin, now = new Date()) {
  const fcmStatus = getFcmConfigurationStatus();
  if (!fcmStatus.configured) {
    return {
      ok: false,
      skipped: true,
      reason: fcmStatus.reason || "fcm_not_configured",
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
  let lunchPunchNoonRemindersSent = 0;
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

    if (shouldRemindLunchPunchNoon({
      loginAt,
      logoutAt,
      userLogs: logs,
      now,
    })) {
      const noonReferenceKey = `lunch_punch_noon:${userId}:${reportDate}`;

      if (!await hasSentPushReference(admin, noonReferenceKey)) {
        const { title, body } = getLunchPunchNoonReminderMessage({
          hasLunchOut: getLunchPunchProgress(logs).lunchOut,
        });
        const noonResult = await sendPushToUser(admin, userId, {
          title,
          body,
          data: {
            type: LUNCH_PUNCH_NOON_PUSH_TYPE,
            reportDate,
          },
        });

        await logPushAttempt(admin, {
          userId,
          notificationType: LUNCH_PUNCH_NOON_PUSH_TYPE,
          title,
          body,
          successCount: noonResult.successCount,
          failureCount: noonResult.failureCount,
          referenceKey: noonReferenceKey,
        });

        if (noonResult.successCount > 0) {
          lunchPunchNoonRemindersSent += 1;
        }
      }
    }

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
    lunchPunchNoonRemindersSent,
    reportDate,
    details,
  };
}
