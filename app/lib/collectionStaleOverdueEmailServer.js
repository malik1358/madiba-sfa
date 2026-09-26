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
import { resolveCustomerAccountCode } from "./outstanding.js";
import {
  getKsaDateString,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

const VISIT_REPORT_LATEST_PREFIX = "visit_report_latest:";

function envFlagEnabled(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

function normalizeCustomerCode(value) {
  return String(value || "").trim().toUpperCase();
}

function customerCodeAliases(value) {
  const raw = normalizeCustomerCode(value);
  const canonical = normalizeCustomerCode(resolveCustomerAccountCode(value));
  return [...new Set([raw, canonical].filter(Boolean))];
}

function chunk(values, size = 80) {
  const list = Array.isArray(values) ? values : [];
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

function laterIso(...values) {
  let latest = "";
  let latestMs = Number.NEGATIVE_INFINITY;
  (values || []).forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return;
    if (ms >= latestMs) {
      latestMs = ms;
      latest = new Date(ms).toISOString();
    }
  });
  return latest;
}

export async function loadLastVisitWithoutOrderByCustomer(admin, customerCodes = []) {
  const latest = new Map();
  const codes = [...new Set(
    (customerCodes || [])
      .flatMap((code) => customerCodeAliases(code))
      .filter(Boolean),
  )];
  if (!codes.length || typeof admin?.from !== "function") return latest;

  for (const batch of chunk(codes, 80)) {
    const settingKeys = batch.map((code) => `${VISIT_REPORT_LATEST_PREFIX}${code}`);
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .in("setting_key", settingKeys);
    if (error) {
      const message = String(error?.message || error?.details || "").toLowerCase();
      if (error?.code === "42P01" || message.includes("does not exist")) break;
      throw error;
    }

    (data || []).forEach((row) => {
      try {
        const parsed = JSON.parse(String(row?.setting_value || "null"));
        const fromKey = String(row?.setting_key || "").slice(VISIT_REPORT_LATEST_PREFIX.length);
        const customerCode = normalizeCustomerCode(parsed?.customer_code || fromKey);
        const visitAt = parsed?.captured_at || parsed?.saved_at || "";
        if (!customerCode || !visitAt) return;
        customerCodeAliases(customerCode).forEach((alias) => {
          latest.set(alias, laterIso(latest.get(alias), visitAt));
        });
      } catch {
        // Ignore malformed visit-without-order settings.
      }
    });
  }

  return latest;
}

export function attachLastVisitWithoutOrder(rows = [], visitByCustomer = new Map()) {
  return (rows || []).map((row) => {
    const aliases = customerCodeAliases(row?.customer_code);
    let visitAt = "";
    aliases.forEach((alias) => {
      visitAt = laterIso(visitAt, visitByCustomer.get(alias));
    });
    return {
      ...row,
      last_visit_without_order_at: visitAt || row?.last_visit_without_order_at || "",
    };
  });
}

export async function enrichDueCustomersWithVisitWithoutOrder(admin, rows = []) {
  const visitByCustomer = await loadLastVisitWithoutOrderByCustomer(
    admin,
    (rows || []).map((row) => row?.customer_code),
  );
  return attachLastVisitWithoutOrder(rows, visitByCustomer);
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
  const dueCustomers = Array.isArray(queues?.dueCustomers) ? queues.dueCustomers : [];
  return enrichDueCustomersWithVisitWithoutOrder(admin, dueCustomers);
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
  const matched = filterCollectionStaleOverdueRows(dueCustomers, {
    todayKey: reportDate,
    todayIso: asOfIso,
  });
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
    todayIso: asOfIso,
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
