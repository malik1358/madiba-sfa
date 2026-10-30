import { randomUUID } from "node:crypto";
import {
  MISSING_CATALOGUE_PHOTOS_EMAIL_KEY_PREFIX,
  buildMissingCataloguePhotoEmail,
  missingCataloguePhotoEmailCc,
  missingCataloguePhotoEmailRecipients,
} from "./missingCataloguePhotosEmail.js";
import { loadMissingCataloguePhotoReport } from "./missingCataloguePhotosServer.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import { getKsaDateString } from "./workdayActivity.js";

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function claimMissingCataloguePhotoEmail(admin, date) {
  const settingKey = `${MISSING_CATALOGUE_PHOTOS_EMAIL_KEY_PREFIX}${date}`;
  const claim = JSON.stringify({ status: "sending", token: randomUUID(), claimedAt: new Date().toISOString() });
  const { error } = await admin.from("system_settings").insert({ setting_key: settingKey, setting_value: claim });
  if (error?.code === "23505") return null;
  if (error) throw error;
  return { settingKey, claim };
}

export async function finishMissingCataloguePhotoEmail(admin, claim, count) {
  const { error } = await admin.from("system_settings")
    .update({ setting_value: JSON.stringify({ status: "sent", sentAt: new Date().toISOString(), missing: count }) })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseMissingCataloguePhotoEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runMissingCataloguePhotoEmailCycle(admin, {
  now = new Date(),
  env = process.env,
  force = false,
  send = sendEmail,
  loadReport = loadMissingCataloguePhotoReport,
  claimSend = claimMissingCataloguePhotoEmail,
  finishSend = finishMissingCataloguePhotoEmail,
  releaseSend = releaseMissingCataloguePhotoEmail,
} = {}) {
  const reportDate = getKsaDateString(now);
  const forceSend = truthyFlag(force) || truthyFlag(env.MISSING_CATALOGUE_PHOTOS_EMAIL_FORCE);
  const isTestSend = Boolean(String(env.MISSING_CATALOGUE_PHOTOS_EMAIL_TEST_TO || "").trim());
  const to = missingCataloguePhotoEmailRecipients(env);
  const cc = isTestSend ? [] : missingCataloguePhotoEmailCc(env, to);
  if (!to.length) throw new Error("No missing catalogue photo recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) throw new Error("Email is not configured on the server.");

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, reportDate);
    if (!claim) return { date: reportDate, skipped: true, reason: "already_claimed_or_sent", sentCount: 0 };
  }

  let delivered = false;
  try {
    const report = await loadReport(admin, { now: now.getTime() });
    if (report.photosReady === false) {
      if (claim) await releaseSend(admin, claim);
      return { date: reportDate, skipped: true, reason: "photos_not_ready", sentCount: 0 };
    }
    const message = buildMissingCataloguePhotoEmail({ date: reportDate, ...report });
    if (forceSend || isTestSend) message.subject = `[TEST] ${message.subject}`;
    await send({ ...message, to, ...(cc.length ? { cc } : {}) }, env);
    delivered = true;
    if (claim) await finishSend(admin, claim, report.summary?.missing || 0);
    return {
      date: reportDate,
      sentCount: 1,
      missing: report.summary?.missing || 0,
      uploadedLast24h: report.summary?.uploadedLast24h || 0,
      itemsUploadedLast24h: report.summary?.itemsUploadedLast24h || 0,
      forced: forceSend || isTestSend,
      to,
      cc,
    };
  } catch (error) {
    if (claim && !delivered) await releaseSend(admin, claim);
    throw error;
  }
}
