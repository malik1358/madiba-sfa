import { randomUUID } from "node:crypto";
import {
  BAD_DEBT_REPORT_EMAIL_KEY_PREFIX,
  BAD_DEBT_REPORT_EMAIL_SNAPSHOT_KEY,
  badDebtReportEmailRecipients,
  buildBadDebtReportEmail,
  snapshotCodes,
} from "./badDebtReportEmail.js";
import { loadDebtReports } from "./badDebtReportServer.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import { getKsaDateString } from "./workdayActivity.js";

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseSnapshot(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      badDebtCodes: Array.isArray(parsed.badDebtCodes) ? parsed.badDebtCodes : [],
      legalCodes: Array.isArray(parsed.legalCodes) ? parsed.legalCodes : [],
    };
  } catch {
    return null;
  }
}

export async function readBadDebtReportEmailSnapshot(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", BAD_DEBT_REPORT_EMAIL_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseSnapshot(data?.setting_value);
}

export async function saveBadDebtReportEmailSnapshot(admin, { date, badDebts = [], legalTransfers = [] } = {}) {
  const settingValue = JSON.stringify({
    date,
    savedAt: new Date().toISOString(),
    badDebtCodes: snapshotCodes(badDebts.filter((row) => !row.transferredToLegal)),
    legalCodes: snapshotCodes(legalTransfers),
  });
  const { error } = await admin.from("system_settings").upsert({
    setting_key: BAD_DEBT_REPORT_EMAIL_SNAPSHOT_KEY,
    setting_value: settingValue,
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function claimBadDebtReportEmail(admin, date) {
  const settingKey = `${BAD_DEBT_REPORT_EMAIL_KEY_PREFIX}${date}`;
  const claim = JSON.stringify({ status: "sending", token: randomUUID(), claimedAt: new Date().toISOString() });
  const { error } = await admin.from("system_settings").insert({ setting_key: settingKey, setting_value: claim });
  if (error?.code === "23505") return null;
  if (error) throw error;
  return { settingKey, claim };
}

export async function finishBadDebtReportEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        openCustomers: counts.openCustomers || 0,
        legalCustomers: counts.legalCustomers || 0,
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseBadDebtReportEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runBadDebtReportEmailCycle(admin, {
  now = new Date(),
  env = process.env,
  force = false,
  send = sendEmail,
  loadReport = loadDebtReports,
  readSnapshot = readBadDebtReportEmailSnapshot,
  saveSnapshot = saveBadDebtReportEmailSnapshot,
  claimSend = claimBadDebtReportEmail,
  finishSend = finishBadDebtReportEmail,
  releaseSend = releaseBadDebtReportEmail,
} = {}) {
  const reportDate = getKsaDateString(now instanceof Date ? now : new Date(now));
  const forceSend = truthyFlag(force) || truthyFlag(env.BAD_DEBT_REPORT_EMAIL_FORCE);
  const isTestSend = Boolean(String(env.BAD_DEBT_REPORT_EMAIL_TEST_TO || "").trim());
  const to = badDebtReportEmailRecipients(env);
  if (!to.length) throw new Error("No potential bad debt email recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) throw new Error("Email is not configured on the server.");

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, reportDate);
    if (!claim) return { date: reportDate, skipped: true, reason: "already_claimed_or_sent", sentCount: 0 };
  }

  try {
    const [report, snapshot] = await Promise.all([
      loadReport(admin, { now: now instanceof Date ? now : new Date(now) }),
      readSnapshot(admin),
    ]);
    const message = buildBadDebtReportEmail({
      date: reportDate,
      badDebts: report.badDebts || [],
      legalTransfers: report.legalTransfers || [],
      previousBadDebtCodes: snapshot ? snapshot.badDebtCodes : null,
      previousLegalCodes: snapshot ? snapshot.legalCodes : null,
    });
    if (forceSend || isTestSend) message.subject = `[TEST] ${message.subject}`;
    await send({ subject: message.subject, html: message.html, text: message.text, to }, env);
    await saveSnapshot(admin, {
      date: reportDate,
      badDebts: report.badDebts || [],
      legalTransfers: report.legalTransfers || [],
    });
    if (claim) {
      await finishSend(admin, claim, {
        openCustomers: message.openCustomers,
        legalCustomers: message.legalCustomers,
      });
    }
    return {
      date: reportDate,
      sentCount: 1,
      to,
      openCustomers: message.openCustomers,
      legalCustomers: message.legalCustomers,
      addedToday: message.addedToday,
      forced: forceSend || isTestSend,
    };
  } catch (error) {
    if (claim) await releaseSend(admin, claim);
    throw error;
  }
}
