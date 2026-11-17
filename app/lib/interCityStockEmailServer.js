import { randomUUID } from "node:crypto";
import {
  INTER_CITY_STOCK_EMAIL_KEY_PREFIX,
  buildInterCityStockEmail,
  interCityStockEmailCc,
  interCityStockEmailClaimKey,
  interCityStockEmailRecipients,
} from "./interCityStockEmail.js";
import { loadInterCityStockTransferReport } from "./interCityStockTransferServer.js";
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

export function resolveInterCityStockEmailSchedule(now = new Date(), {
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

export function resolveInterCityStockEmailRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

export async function claimInterCityStockEmail(admin, date) {
  const settingKey = interCityStockEmailClaimKey(date);
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

export async function finishInterCityStockEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        dammamToRiyadhItems: counts.dammamToRiyadhItems || 0,
        riyadhToDammamItems: counts.riyadhToDammamItems || 0,
        riyadhToStoreItems: counts.riyadhToStoreItems || 0,
        storeStockItems: counts.storeStockItems || 0,
        stockDate: counts.stockDate || "",
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseInterCityStockEmailClaim(admin, claim) {
  if (!claim?.settingKey) return;
  await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
}

export async function runInterCityStockEmailCycle(admin, {
  force = false,
  date = "",
  env = process.env,
  now = new Date(),
  send = sendEmail,
  loadReport = loadInterCityStockTransferReport,
} = {}) {
  const schedule = resolveInterCityStockEmailSchedule(now, { date, force });
  if (schedule.skipped) {
    return { skipped: true, reason: schedule.reason, date: schedule.date, sentCount: 0 };
  }

  const forceSend = truthyFlag(force) || truthyFlag(env.INTER_CITY_STOCK_EMAIL_FORCE);
  const isTestSend = Boolean(String(env.INTER_CITY_STOCK_EMAIL_TEST_TO || "").trim());
  const recipients = interCityStockEmailRecipients(env);
  const cc = interCityStockEmailCc(env).filter((email) => !recipients.includes(email));
  if (!recipients.length) throw new Error("No inter-city stock email recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) {
    throw new Error("Email is not configured on the server.");
  }

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimInterCityStockEmail(admin, schedule.date);
    if (!claim) {
      return {
        skipped: true,
        reason: "already_claimed_or_sent",
        date: schedule.date,
        claimKey: interCityStockEmailClaimKey(schedule.date),
        sentCount: 0,
      };
    }
  }

  try {
    const report = await loadReport(admin, { now: now instanceof Date ? now : new Date(now) });
    const mail = buildInterCityStockEmail(report, { date: schedule.date, env });
    if (forceSend || isTestSend) mail.subject = `[TEST] ${mail.subject}`;
    await send({
      to: recipients,
      ...(cc.length ? { cc } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }, env);
    if (claim) await finishInterCityStockEmail(admin, claim, mail.counts);
    return {
      skipped: false,
      date: schedule.date,
      sentCount: 1,
      to: recipients,
      cc,
      forced: forceSend || isTestSend,
      ...mail.counts,
    };
  } catch (error) {
    if (claim) await releaseInterCityStockEmailClaim(admin, claim);
    throw error;
  }
}

export { INTER_CITY_STOCK_EMAIL_KEY_PREFIX };
