import { randomUUID } from "node:crypto";
import {
  EXPECTED_STOCKED_SALES_EMAIL_KEY_PREFIX,
  EXPECTED_STOCKED_SALES_EMAIL_SNAPSHOT_KEY,
  buildExpectedStockedSalesEmail,
  expectedStockedSalesEmailCc,
  expectedStockedSalesEmailClaimKey,
  expectedStockedSalesEmailRecipients,
  expectedStockedSalesEmailWeekMonday,
  summarizeExpectedStockedCohort,
} from "./expectedStockedSalesEmail.js";
import { loadExpectedStockedSalesReport } from "./expectedStockedSalesServer.js";
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

export function resolveExpectedStockedSalesEmailSchedule(now = new Date(), {
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

export function resolveExpectedStockedSalesEmailRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

function parseSnapshot(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      asOfDate: String(parsed.asOfDate || parsed.date || "").trim() || null,
      weekMonday: String(parsed.weekMonday || "").trim() || null,
      savedAt: String(parsed.savedAt || "").trim() || null,
      seasonMonths: Array.isArray(parsed.seasonMonths) ? parsed.seasonMonths : [],
      gp10: summarizeExpectedStockedCohort(parsed.gp10 || {}),
      gp0: summarizeExpectedStockedCohort(parsed.gp0 || {}),
    };
  } catch {
    return null;
  }
}

export async function readExpectedStockedSalesEmailSnapshot(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", EXPECTED_STOCKED_SALES_EMAIL_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseSnapshot(data?.setting_value);
}

export async function saveExpectedStockedSalesEmailSnapshot(admin, {
  date,
  weekMonday,
  report = {},
} = {}) {
  const settingValue = JSON.stringify({
    asOfDate: date,
    weekMonday: weekMonday || expectedStockedSalesEmailWeekMonday(date),
    savedAt: new Date().toISOString(),
    seasonMonths: report.season?.calendarMonths || [],
    gp10: summarizeExpectedStockedCohort(report.summary),
    gp0: summarizeExpectedStockedCohort(report.profitableSummary),
  });
  const { error } = await admin.from("system_settings").upsert({
    setting_key: EXPECTED_STOCKED_SALES_EMAIL_SNAPSHOT_KEY,
    setting_value: settingValue,
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function claimExpectedStockedSalesEmail(admin, weekMonday) {
  const settingKey = `${EXPECTED_STOCKED_SALES_EMAIL_KEY_PREFIX}${weekMonday}`;
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

export async function finishExpectedStockedSalesEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        gp10Sales: counts.gp10Sales || 0,
        gp0Sales: counts.gp0Sales || 0,
        gp10Direction: counts.gp10Direction || "flat",
        gp0Direction: counts.gp0Direction || "flat",
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseExpectedStockedSalesEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runExpectedStockedSalesEmailCycle(admin, {
  now = new Date(),
  date = "",
  env = process.env,
  force = false,
  send = sendEmail,
  loadReport = loadExpectedStockedSalesReport,
  readSnapshot = readExpectedStockedSalesEmailSnapshot,
  saveSnapshot = saveExpectedStockedSalesEmailSnapshot,
  claimSend = claimExpectedStockedSalesEmail,
  finishSend = finishExpectedStockedSalesEmail,
  releaseSend = releaseExpectedStockedSalesEmail,
} = {}) {
  const schedule = resolveExpectedStockedSalesEmailSchedule(now, { date, force });
  if (schedule.skipped) {
    return { date: schedule.date, skipped: true, reason: schedule.reason, sentCount: 0 };
  }

  const reportDate = schedule.date;
  const weekMonday = expectedStockedSalesEmailWeekMonday(reportDate);
  const forceSend = truthyFlag(force) || truthyFlag(env.EXPECTED_STOCKED_SALES_EMAIL_FORCE);
  const isTestSend = Boolean(String(env.EXPECTED_STOCKED_SALES_EMAIL_TEST_TO || "").trim());
  const to = expectedStockedSalesEmailRecipients(env);
  const cc = expectedStockedSalesEmailCc(env, to);
  if (!to.length) throw new Error("No Expected Stocked Sales email recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) throw new Error("Email is not configured on the server.");

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, weekMonday);
    if (!claim) {
      return {
        date: reportDate,
        weekMonday,
        skipped: true,
        reason: "already_claimed_or_sent",
        claimKey: expectedStockedSalesEmailClaimKey(reportDate),
        sentCount: 0,
      };
    }
  }

  try {
    const [report, snapshot] = await Promise.all([
      loadReport(admin, { now: now instanceof Date ? now : new Date(now) }),
      readSnapshot(admin),
    ]);
    const message = buildExpectedStockedSalesEmail({
      date: reportDate,
      report,
      previous: snapshot,
      env,
    });
    if (forceSend || isTestSend) message.subject = `[TEST] ${message.subject}`;
    await send({
      subject: message.subject,
      html: message.html,
      text: message.text,
      to,
      ...(cc.length ? { cc } : {}),
    }, env);
    await saveSnapshot(admin, { date: reportDate, weekMonday, report });
    if (claim) {
      await finishSend(admin, claim, {
        gp10Sales: message.gp10.expectedSales,
        gp0Sales: message.gp0.expectedSales,
        gp10Direction: message.gp10Direction,
        gp0Direction: message.gp0Direction,
      });
    }
    return {
      date: reportDate,
      weekMonday,
      sentCount: 1,
      to,
      cc,
      gp10: message.gp10,
      gp0: message.gp0,
      gp10Direction: message.gp10Direction,
      gp0Direction: message.gp0Direction,
      hadPrevious: Boolean(snapshot),
      forced: forceSend || isTestSend,
    };
  } catch (error) {
    if (claim) await releaseSend(admin, claim);
    throw error;
  }
}
