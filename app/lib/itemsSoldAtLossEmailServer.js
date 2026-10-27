import { randomUUID } from "node:crypto";
import {
  ITEMS_SOLD_AT_LOSS_EMAIL_KEY_PREFIX,
  buildItemsSoldAtLossEmail,
  itemsSoldAtLossEmailRecipients,
} from "./itemsSoldAtLossEmail.js";
import { loadItemsSoldAtLossReport } from "./itemsSoldAtLossServer.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  addKsaCalendarDays,
  getKsaDateString,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeReportDate(value, now = new Date()) {
  const explicit = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return addKsaCalendarDays(getKsaDateString(now), -1);
}

export function resolveItemsSoldAtLossEmailSchedule(now = new Date(), {
  date = "",
  force = false,
} = {}) {
  const reportDate = normalizeReportDate(date, now);
  if (force || String(date || "").trim()) {
    return { date: reportDate, skipped: false, reason: "" };
  }
  const weekday = getKsaWeekdayIndexForDateString(getKsaDateString(now));
  if (weekday === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }
  return { date: reportDate, skipped: false, reason: "" };
}

export function resolveItemsSoldAtLossRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

export async function claimItemsSoldAtLossEmail(admin, date) {
  const settingKey = `${ITEMS_SOLD_AT_LOSS_EMAIL_KEY_PREFIX}${date}`;
  const claim = JSON.stringify({
    status: "sending",
    token: randomUUID(),
    claimedAt: new Date().toISOString(),
  });
  const { error } = await admin.from("system_settings").insert({
    setting_key: settingKey,
    setting_value: claim,
  });
  if (error?.code === "23505") return null;
  if (error) throw error;
  return { settingKey, claim };
}

export async function finishItemsSoldAtLossEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        lineCount: counts.lineCount || 0,
        profitAmount: counts.profitAmount || 0,
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseItemsSoldAtLossEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runItemsSoldAtLossEmailCycle(admin, {
  date = "",
  now = new Date(),
  env = process.env,
  force = false,
  trigger = "cron",
  send = sendEmail,
  loadReport = loadItemsSoldAtLossReport,
  claimSend = claimItemsSoldAtLossEmail,
  finishSend = finishItemsSoldAtLossEmail,
  releaseSend = releaseItemsSoldAtLossEmail,
} = {}) {
  const forceSend = truthyFlag(force) || truthyFlag(env.ITEMS_SOLD_AT_LOSS_EMAIL_FORCE);
  const schedule = resolveItemsSoldAtLossEmailSchedule(now, { date, force: forceSend });
  if (schedule.skipped && !forceSend) {
    return {
      date: schedule.date,
      skipped: true,
      reason: schedule.reason,
      sentCount: 0,
      lineCount: 0,
      trigger,
    };
  }

  const reportDate = schedule.date;
  const isTestSend = Boolean(String(env.ITEMS_SOLD_AT_LOSS_EMAIL_TEST_TO || "").trim());
  const to = itemsSoldAtLossEmailRecipients(env);
  if (!to.length) {
    return { date: reportDate, skipped: true, reason: "no_recipients", sentCount: 0, lineCount: 0, trigger };
  }
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, lineCount: 0, trigger };
  }

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, reportDate);
    if (!claim) {
      return {
        date: reportDate,
        skipped: true,
        reason: "already_claimed_or_sent",
        sentCount: 0,
        lineCount: 0,
        trigger,
      };
    }
  }

  try {
    const report = await loadReport(admin, { dateFrom: reportDate, dateTo: reportDate });
    const message = buildItemsSoldAtLossEmail({
      date: reportDate,
      rows: report.rows || [],
      env,
    });
    const subject = isTestSend || forceSend ? `[TEST] ${message.subject}` : message.subject;
    await send({
      to,
      subject,
      html: message.html,
      text: message.text,
    }, env);

    if (claim) {
      await finishSend(admin, claim, {
        lineCount: message.lineCount,
        profitAmount: message.totals?.profitAmount || 0,
      });
    }

    return {
      date: reportDate,
      skipped: false,
      sentCount: 1,
      lineCount: message.lineCount,
      profitAmount: message.totals?.profitAmount || 0,
      truncated: Boolean(message.truncated),
      to,
      trigger,
    };
  } catch (error) {
    if (claim) {
      try {
        await releaseSend(admin, claim);
      } catch (releaseError) {
        console.error("Failed to release items-sold-at-loss email claim:", releaseError);
      }
    }
    throw error;
  }
}
