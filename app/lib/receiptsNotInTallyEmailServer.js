import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import {
  RECEIPTS_NOT_IN_TALLY_EMAIL_LAST_SENT_KEY,
  buildReceiptsNotInTallyEmail,
  buildReceiptsNotInTallyReportUrl,
  parseReceiptsNotInTallyLastSent,
  resolveReceiptsNotInTallyEmailCc,
  resolveReceiptsNotInTallyEmailRecipients,
} from "./receiptsNotInTallyEmail.js";
import { DEFAULT_DATE_WINDOW_DAYS } from "./receiptsNotInTally.js";
import {
  buildReceiptsNotInTallyReport,
  defaultReceiptsNotInTallyFromDate,
} from "./receiptsNotInTallyServer.js";
import {
  getKsaDateString,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

function envFlagEnabled(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function parseReceiptsNotInTallyReportDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveReceiptsNotInTallyEmailSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseReceiptsNotInTallyReportDate(explicit, now), skipped: false, reason: "" };
  }

  const reportDate = getKsaDateString(now);
  if (getKsaWeekdayIndex(now) === 5 || getKsaWeekdayIndexForDateString(reportDate) === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }

  return { date: reportDate, skipped: false, reason: "" };
}

export async function loadLastReceiptsNotInTallyEmailMarker(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", RECEIPTS_NOT_IN_TALLY_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseReceiptsNotInTallyLastSent(data?.setting_value);
}

export async function saveLastReceiptsNotInTallyEmailMarker(admin, {
  reportDate,
  asOfIso,
  trigger = "",
} = {}) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: RECEIPTS_NOT_IN_TALLY_EMAIL_LAST_SENT_KEY,
    setting_value: JSON.stringify({
      date: reportDate,
      lastSentAt: asOfIso,
      asOf: asOfIso,
      trigger: String(trigger || "").trim() || null,
      savedAt: new Date().toISOString(),
    }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function runReceiptsNotInTallyEmailCycle(admin, {
  date,
  from,
  to,
  windowDays = DEFAULT_DATE_WINDOW_DAYS,
  trigger = "manual",
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadReport = buildReceiptsNotInTallyReport,
  loadLastSentMarker = loadLastReceiptsNotInTallyEmailMarker,
  saveLastSentMarker = saveLastReceiptsNotInTallyEmailMarker,
} = {}) {
  const force = envFlagEnabled(env.RECEIPTS_NOT_IN_TALLY_EMAIL_FORCE, false);
  const normalizedTrigger = String(trigger || "manual").trim().toLowerCase() || "manual";
  const testTo = parseEmailList(env.RECEIPTS_NOT_IN_TALLY_EMAIL_TEST_TO);
  const isTestSend = testTo.length > 0;
  const asOf = now instanceof Date ? now : new Date(now);
  const asOfIso = asOf.toISOString();
  const explicitDate = Boolean(String(date || "").trim());

  let reportDate = "";
  if (explicitDate) {
    reportDate = parseReceiptsNotInTallyReportDate(date, asOf);
  } else if (normalizedTrigger === "cron") {
    const schedule = resolveReceiptsNotInTallyEmailSchedule("", asOf);
    if (schedule.skipped && !force) {
      return { date: schedule.date, skipped: true, reason: schedule.reason, sentCount: 0, openCount: 0 };
    }
    reportDate = schedule.date || getKsaDateString(asOf);
  } else {
    reportDate = getKsaDateString(asOf);
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, openCount: 0 };
  }

  const marker = await loadLastSentMarker(admin);
  if (
    normalizedTrigger === "cron"
    && !force
    && !isTestSend
    && marker.date === reportDate
    && marker.lastSentAt
  ) {
    return { date: reportDate, skipped: true, reason: "already_sent", sentCount: 0, openCount: 0 };
  }

  const fromDate = String(from || "").trim() || defaultReceiptsNotInTallyFromDate(reportDate);
  const toDate = String(to || "").trim() || reportDate;

  const report = await loadReport(admin, {
    fromDate,
    toDate,
    windowDays,
  });

  const openRows = Array.isArray(report.missingInTally) ? report.missingInTally : [];
  const ignoredCount = Number(report.summary?.ignoredCount || 0);

  // Still send when empty so recipients know the list is clear.
  const digestTo = isTestSend ? testTo : resolveReceiptsNotInTallyEmailRecipients(env);
  if (!digestTo.length) {
    return { date: reportDate, skipped: true, reason: "no_recipients", sentCount: 0, openCount: openRows.length };
  }
  const digestCc = isTestSend ? [] : resolveReceiptsNotInTallyEmailCc(env, digestTo);
  const reportUrl = buildReceiptsNotInTallyReportUrl(env, { from: fromDate, to: toDate });
  const message = buildReceiptsNotInTallyEmail({
    date: reportDate,
    from: fromDate,
    to: toDate,
    windowDays: report.windowDays ?? windowDays,
    rows: openRows,
    ignoredCount,
    reportUrl,
  });

  await send({
    to: digestTo,
    cc: digestCc,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  if (!isTestSend) {
    await saveLastSentMarker(admin, {
      reportDate,
      asOfIso,
      trigger: normalizedTrigger,
    });
  }

  return {
    date: reportDate,
    from: fromDate,
    to: toDate,
    windowDays: report.windowDays ?? windowDays,
    skipped: false,
    sentCount: 1,
    openCount: openRows.length,
    ignoredCount,
    total: message.total,
    to: digestTo,
    cc: digestCc,
  };
}
