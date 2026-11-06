import { randomUUID } from "node:crypto";
import {
  RETURNS_ABOVE_SALES_EMAIL_KEY_PREFIX,
  buildReturnsAboveSalesEmail,
  returnsAboveSalesEmailCc,
  returnsAboveSalesEmailRecipients,
} from "./returnsAboveSalesEmail.js";
import { loadReturnsAboveSalesReport } from "./returnsAboveSalesServer.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import { getKsaDateString, getKsaWeekdayIndex } from "./workdayActivity.js";

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeReportDate(value, now = new Date()) {
  const explicit = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return getKsaDateString(now);
}

export function resolveReturnsAboveSalesEmailSchedule(now = new Date(), {
  date = "",
  force = false,
} = {}) {
  const reportDate = normalizeReportDate(date, now);
  if (force || String(date || "").trim()) {
    return { date: reportDate, skipped: false, reason: "" };
  }
  if (getKsaWeekdayIndex(now) === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }
  return { date: reportDate, skipped: false, reason: "" };
}

export function resolveReturnsAboveSalesRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

export async function claimReturnsAboveSalesEmail(admin, date) {
  const settingKey = `${RETURNS_ABOVE_SALES_EMAIL_KEY_PREFIX}${date}`;
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

export async function finishReturnsAboveSalesEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        itemCount: counts.itemCount || 0,
        excessAmount: counts.excessAmount || 0,
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseReturnsAboveSalesEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runReturnsAboveSalesEmailCycle(admin, {
  date = "",
  now = new Date(),
  env = process.env,
  force = false,
  trigger = "cron",
  send = sendEmail,
  loadReport = loadReturnsAboveSalesReport,
  claimSend = claimReturnsAboveSalesEmail,
  finishSend = finishReturnsAboveSalesEmail,
  releaseSend = releaseReturnsAboveSalesEmail,
} = {}) {
  const forceSend = truthyFlag(force) || truthyFlag(env.RETURNS_ABOVE_SALES_EMAIL_FORCE);
  const schedule = resolveReturnsAboveSalesEmailSchedule(now, { date, force: forceSend });
  if (schedule.skipped && !forceSend) {
    return {
      date: schedule.date,
      skipped: true,
      reason: schedule.reason,
      sentCount: 0,
      itemCount: 0,
      trigger,
    };
  }

  const reportDate = schedule.date;
  const isTestSend = Boolean(String(env.RETURNS_ABOVE_SALES_EMAIL_TEST_TO || "").trim());
  const to = returnsAboveSalesEmailRecipients(env);
  const cc = returnsAboveSalesEmailCc(env, to);
  if (!to.length) {
    return { date: reportDate, skipped: true, reason: "no_recipients", sentCount: 0, itemCount: 0, trigger };
  }
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, itemCount: 0, trigger };
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
        itemCount: 0,
        trigger,
      };
    }
  }

  try {
    const report = await loadReport(admin);
    const message = buildReturnsAboveSalesEmail({ date: reportDate, report, env });
    const subject = isTestSend ? `[TEST] ${message.subject}` : message.subject;
    await send({
      to,
      cc,
      subject,
      html: message.html,
      text: message.text,
    }, env);

    if (claim) {
      await finishSend(admin, claim, message.totals);
    }

    return {
      date: reportDate,
      skipped: false,
      reason: "",
      sentCount: to.length,
      to,
      cc,
      itemCount: message.totals.itemCount,
      customerCount: message.totals.customerCount,
      excessAmount: message.totals.excessAmount,
      trigger,
    };
  } catch (error) {
    if (claim) {
      try {
        await releaseSend(admin, claim);
      } catch (releaseError) {
        console.error("Returns above sales email claim release failed:", releaseError?.message || releaseError);
      }
    }
    throw error;
  }
}
