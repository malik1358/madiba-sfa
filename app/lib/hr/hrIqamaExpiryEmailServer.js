import { randomUUID } from "node:crypto";
import { getMailerConfig, isEmailConfigured, sendEmail } from "../mailer.js";
import { getKsaDateString, getKsaWeekdayIndex } from "../workdayActivity.js";
import { isMissingSchemaColumn } from "../performanceKpis.js";
import { isMissingRelationError } from "../schemaGuards.js";
import { rowToEmployee } from "./hrEmployees.js";
import {
  HR_IQAMA_EXPIRY_EMAIL_KEY_PREFIX,
  HR_IQAMA_WARNING_DAYS,
  buildHrIqamaExpiryEmail,
  hrIqamaExpiryEmailClaimKey,
  hrIqamaExpiryEmailRecipients,
  listIqamaExpiringWithinDays,
} from "./hrIqamaExpiryEmail.js";

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeReportDate(value, now = new Date()) {
  const explicit = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return getKsaDateString(now);
}

export function resolveHrIqamaExpiryEmailSchedule(now = new Date(), {
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

export function resolveHrIqamaExpiryEmailRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

export async function claimHrIqamaExpiryEmail(admin, date) {
  const settingKey = hrIqamaExpiryEmailClaimKey(date);
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

export async function finishHrIqamaExpiryEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        total: counts.total || 0,
        overdue: counts.overdue || 0,
        asOf: counts.asOf || "",
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseHrIqamaExpiryEmailClaim(admin, claim) {
  if (!claim?.settingKey) return;
  await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
}

async function loadEmployeesForIqamaWarning(admin) {
  const { data, error } = await admin
    .from("hr_employees")
    .select("employee_code,full_name,iqama_no,iqama_expiry,status")
    .eq("status", "ACTIVE")
    .not("iqama_expiry", "is", null)
    .order("iqama_expiry", { ascending: true })
    .limit(5000);
  if (error) {
    if (isMissingRelationError(error) || isMissingSchemaColumn(error)) {
      return { employees: [], schemaMissing: true };
    }
    throw error;
  }
  return {
    employees: (data || []).map(rowToEmployee),
    schemaMissing: false,
  };
}

export async function runHrIqamaExpiryEmailCycle(admin, {
  force = false,
  date = "",
  env = process.env,
  now = new Date(),
  send = sendEmail,
  warningDays = HR_IQAMA_WARNING_DAYS,
} = {}) {
  const schedule = resolveHrIqamaExpiryEmailSchedule(now, { date, force });
  if (schedule.skipped) {
    return { skipped: true, reason: schedule.reason, date: schedule.date, sentCount: 0 };
  }

  const forceSend = truthyFlag(force) || truthyFlag(env.HR_IQAMA_EXPIRY_EMAIL_FORCE);
  const isTestSend = Boolean(String(env.HR_IQAMA_EXPIRY_EMAIL_TEST_TO || "").trim());
  const recipients = hrIqamaExpiryEmailRecipients(env);
  if (!recipients.length) throw new Error("No HR Iqama expiry email recipients configured.");
  if (!isEmailConfigured(getMailerConfig(env))) {
    throw new Error("Email is not configured on the server.");
  }

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimHrIqamaExpiryEmail(admin, schedule.date);
    if (!claim) {
      return {
        skipped: true,
        reason: "already_claimed_or_sent",
        date: schedule.date,
        claimKey: hrIqamaExpiryEmailClaimKey(schedule.date),
        sentCount: 0,
      };
    }
  }

  try {
    const loaded = await loadEmployeesForIqamaWarning(admin);
    if (loaded.schemaMissing) {
      if (claim) await releaseHrIqamaExpiryEmailClaim(admin, claim);
      return {
        skipped: true,
        reason: "iqama_expiry_column_missing",
        date: schedule.date,
        sentCount: 0,
      };
    }

    const report = listIqamaExpiringWithinDays(loaded.employees, {
      asOfDate: schedule.date,
      warningDays,
      now,
    });

    if (!report.rows.length && !forceSend && !isTestSend) {
      if (claim) await finishHrIqamaExpiryEmail(admin, claim, { total: 0, overdue: 0, asOf: report.asOf });
      return {
        skipped: true,
        reason: "no_expiring_iqama",
        date: schedule.date,
        sentCount: 0,
        total: 0,
        overdue: 0,
      };
    }

    const mail = buildHrIqamaExpiryEmail(report, { env });
    if (forceSend || isTestSend) mail.subject = `[TEST] ${mail.subject}`;
    await send({
      to: recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }, env);
    if (claim) await finishHrIqamaExpiryEmail(admin, claim, mail.counts);
    return {
      skipped: false,
      date: schedule.date,
      sentCount: 1,
      to: recipients,
      forced: forceSend || isTestSend,
      ...mail.counts,
    };
  } catch (error) {
    if (claim) await releaseHrIqamaExpiryEmailClaim(admin, claim);
    throw error;
  }
}

export { HR_IQAMA_EXPIRY_EMAIL_KEY_PREFIX };
