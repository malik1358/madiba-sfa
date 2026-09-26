import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import {
  buildCollectionStaleOverdueEmail,
  buildCollectionStaleOverdueReportUrl,
  COLLECTION_STALE_OVERDUE_EMAIL_LAST_SENT_KEY,
  filterCollectionStaleOverdueRows,
  groupCollectionStaleOverdueBySalesman,
  parseCollectionStaleOverdueLastSent,
  resolveCollectionStaleOverdueDigestCc,
  resolveCollectionStaleOverdueDigestRecipients,
} from "./collectionStaleOverdueEmail.js";
import { buildCollectionQueues } from "./paymentCollections.js";
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

export function parseCollectionStaleOverdueReportDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveCollectionStaleOverdueEmailSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseCollectionStaleOverdueReportDate(explicit, now), skipped: false, reason: "" };
  }

  const reportDate = getKsaDateString(now);
  if (getKsaWeekdayIndex(now) === 5 || getKsaWeekdayIndexForDateString(reportDate) === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }

  return { date: reportDate, skipped: false, reason: "" };
}

export function resolveCollectionStaleOverdueRouteTrigger({
  date,
  force,
  to,
  trigger,
} = {}) {
  const explicitTrigger = String(trigger || "").trim().toLowerCase();
  if (explicitTrigger === "manual" || explicitTrigger === "cron") {
    return explicitTrigger;
  }
  if (String(date || "").trim() || String(force || "").trim() || String(to || "").trim()) {
    return "manual";
  }
  return "cron";
}

export async function loadLastCollectionStaleOverdueEmailMarker(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", COLLECTION_STALE_OVERDUE_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseCollectionStaleOverdueLastSent(data?.setting_value);
}

export async function saveLastCollectionStaleOverdueEmailMarker(admin, {
  reportDate,
  asOfIso,
  trigger = "",
} = {}) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: COLLECTION_STALE_OVERDUE_EMAIL_LAST_SENT_KEY,
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

async function loadDueCollectionCustomers(admin, {
  fetchOutstandingAndCollectionRecords,
} = {}) {
  if (typeof fetchOutstandingAndCollectionRecords !== "function") {
    throw new Error("fetchOutstandingAndCollectionRecords is required.");
  }

  const scope = {
    hasAllAccess: true,
    visibleSalesmanCodes: [],
    scopeProfiles: [],
    userRole: "admin",
    userId: null,
    canSeeAllSchedulers: true,
    visibleSchedulerUserIds: null,
  };

  const records = await fetchOutstandingAndCollectionRecords(admin, scope);
  const queues = buildCollectionQueues(records);
  return Array.isArray(queues?.dueCustomers) ? queues.dueCustomers : [];
}

export async function runCollectionStaleOverdueEmailCycle(admin, {
  date,
  trigger = "manual",
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadDueCustomers = null,
  loadLastSentMarker = loadLastCollectionStaleOverdueEmailMarker,
  saveLastSentMarker = saveLastCollectionStaleOverdueEmailMarker,
  fetchOutstandingAndCollectionRecords = null,
} = {}) {
  const force = envFlagEnabled(env.COLLECTION_STALE_OVERDUE_EMAIL_FORCE, false);
  const normalizedTrigger = String(trigger || "manual").trim().toLowerCase() || "manual";
  const testTo = parseEmailList(env.COLLECTION_STALE_OVERDUE_EMAIL_TEST_TO);
  const isTestSend = testTo.length > 0;
  const asOf = now instanceof Date ? now : new Date(now);
  const asOfIso = asOf.toISOString();
  const explicitDate = Boolean(String(date || "").trim());

  let reportDate = "";
  if (explicitDate) {
    reportDate = parseCollectionStaleOverdueReportDate(date, asOf);
  } else if (normalizedTrigger === "cron") {
    const schedule = resolveCollectionStaleOverdueEmailSchedule("", asOf);
    if (schedule.skipped && !force) {
      return { date: schedule.date, skipped: true, reason: schedule.reason, sentCount: 0, customerCount: 0 };
    }
    reportDate = schedule.date || getKsaDateString(asOf);
  } else {
    reportDate = getKsaDateString(asOf);
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, customerCount: 0 };
  }

  const marker = await loadLastSentMarker(admin);
  if (
    normalizedTrigger === "cron"
    && !force
    && !isTestSend
    && marker.date === reportDate
    && marker.lastSentAt
  ) {
    return { date: reportDate, skipped: true, reason: "already_sent", sentCount: 0, customerCount: 0 };
  }

  let loader = loadDueCustomers;
  if (!loader) {
    let fetchRecords = fetchOutstandingAndCollectionRecords;
    if (!fetchRecords) {
      ({ fetchOutstandingAndCollectionRecords: fetchRecords } = await import("../api/payment-collections/route.js"));
    }
    loader = (client) => loadDueCollectionCustomers(client, {
      fetchOutstandingAndCollectionRecords: fetchRecords,
    });
  }

  const dueCustomers = await loader(admin);
  const matched = filterCollectionStaleOverdueRows(dueCustomers, { todayKey: reportDate });
  const groups = groupCollectionStaleOverdueBySalesman(matched);

  if (!matched.length) {
    return {
      date: reportDate,
      skipped: true,
      reason: "no_customers",
      sentCount: 0,
      customerCount: 0,
      groupCount: 0,
    };
  }

  const digestTo = isTestSend ? testTo : resolveCollectionStaleOverdueDigestRecipients(env);
  const digestCc = isTestSend ? [] : resolveCollectionStaleOverdueDigestCc(env, digestTo);
  if (!digestTo.length) {
    return {
      date: reportDate,
      skipped: true,
      reason: "no_recipients",
      sentCount: 0,
      customerCount: matched.length,
      groupCount: groups.length,
    };
  }

  const message = buildCollectionStaleOverdueEmail({
    date: reportDate,
    groups,
    reportUrl: buildCollectionStaleOverdueReportUrl(env),
  });

  let sentCount = 0;
  let failedCount = 0;
  const results = [];
  try {
    const sent = await send({
      ...message,
      to: digestTo,
      cc: digestCc,
    }, env);
    sentCount = 1;
    results.push({
      kind: "digest",
      skipped: false,
      customerCount: matched.length,
      groupCount: groups.length,
      to: digestTo,
      cc: digestCc,
      provider: sent?.provider || null,
    });
  } catch (error) {
    failedCount = 1;
    results.push({
      kind: "digest",
      skipped: false,
      failed: true,
      customerCount: matched.length,
      groupCount: groups.length,
      to: digestTo,
      cc: digestCc,
      error: error.message || "Unable to send email",
    });
  }

  if (sentCount > 0 && failedCount === 0 && !isTestSend) {
    try {
      await saveLastSentMarker(admin, {
        reportDate,
        asOfIso,
        trigger: normalizedTrigger,
      });
    } catch {
      // Sending succeeded even if the marker cannot be stored.
    }
  }

  return {
    date: reportDate,
    skipped: false,
    reason: "",
    sentCount,
    failedCount,
    customerCount: matched.length,
    groupCount: groups.length,
    asOfIso,
    trigger: normalizedTrigger,
    results,
  };
}
