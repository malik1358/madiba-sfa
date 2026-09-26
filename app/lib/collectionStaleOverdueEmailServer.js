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
import { isFarFromCustomer } from "./customerLocation.js";
import { extractGpsFromVisitLocation } from "./outstandingNoGps.js";
import { buildCollectionQueues } from "./paymentCollections.js";
import { resolveCustomerAccountCode } from "./outstanding.js";
import {
  getKsaDateString,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

const VISIT_REPORT_LATEST_PREFIX = "visit_report_latest:";
const VISIT_REPORT_HISTORY_PREFIX = "visit_report_history:";

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

function emptyVisitMeta() {
  return { visitAt: "", isFar: false, nearVisitAt: "" };
}

function parseVisitSettingPayload(row) {
  try {
    const parsed = JSON.parse(String(row?.setting_value || "null"));
    if (!parsed || typeof parsed !== "object") return null;
    const fromKey = String(row?.setting_key || "");
    let customerCode = normalizeCustomerCode(parsed?.customer_code || "");
    if (!customerCode && fromKey.startsWith(VISIT_REPORT_LATEST_PREFIX)) {
      customerCode = normalizeCustomerCode(fromKey.slice(VISIT_REPORT_LATEST_PREFIX.length));
    } else if (!customerCode && fromKey.startsWith(VISIT_REPORT_HISTORY_PREFIX)) {
      const rest = fromKey.slice(VISIT_REPORT_HISTORY_PREFIX.length);
      customerCode = normalizeCustomerCode(rest.split(":")[0] || "");
    }
    const visitAt = parsed?.captured_at || parsed?.saved_at || "";
    if (!customerCode || !visitAt) return null;
    return {
      customerCode,
      visitAt,
      location: extractGpsFromVisitLocation(parsed?.location) || null,
    };
  } catch {
    return null;
  }
}

function visitIsFar(visit, customerGps) {
  if (!visit?.location || !customerGps) return false;
  return isFarFromCustomer(visit.location, customerGps);
}

function preferLaterVisitMeta(current, candidate) {
  const base = current && typeof current === "object" ? current : emptyVisitMeta();
  const next = candidate && typeof candidate === "object" ? candidate : emptyVisitMeta();
  const baseMs = Date.parse(base.visitAt) || Number.NEGATIVE_INFINITY;
  const nextMs = Date.parse(next.visitAt) || Number.NEGATIVE_INFINITY;

  let visitAt = base.visitAt || "";
  let isFar = Boolean(base.isFar);
  if (nextMs > baseMs) {
    visitAt = next.visitAt || "";
    isFar = Boolean(next.isFar);
  } else if (nextMs === baseMs && next.visitAt) {
    visitAt = next.visitAt || base.visitAt || "";
    isFar = Boolean(base.isFar || next.isFar);
  }

  return {
    visitAt: visitAt ? laterIso(visitAt) : "",
    isFar: Boolean(visitAt && isFar),
    nearVisitAt: laterIso(base.nearVisitAt, next.nearVisitAt),
  };
}

async function loadCustomerGpsByCode(admin, codes = []) {
  const map = new Map();
  const list = [...new Set((codes || []).map(normalizeCustomerCode).filter(Boolean))];
  if (!list.length || typeof admin?.from !== "function") return map;

  for (const batch of chunk(list, 80)) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,latitude,longitude")
      .in("customer_code", batch);
    if (error) {
      const message = String(error?.message || error?.details || "").toLowerCase();
      if (error?.code === "42P01" || message.includes("does not exist")) break;
      throw error;
    }
    (data || []).forEach((row) => {
      const code = normalizeCustomerCode(row?.customer_code);
      if (!code) return;
      const gps = {
        latitude: Number(row?.latitude),
        longitude: Number(row?.longitude),
      };
      customerCodeAliases(code).forEach((alias) => {
        map.set(alias, gps);
      });
    });
  }
  return map;
}

async function loadNearVisitFromHistory(admin, customerCodes = [], customerGpsByCode = new Map()) {
  const nearByCode = new Map();
  const codes = [...new Set((customerCodes || []).map(normalizeCustomerCode).filter(Boolean))];
  if (!codes.length || typeof admin?.from !== "function") return nearByCode;

  await Promise.all(codes.map(async (code) => {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .like("setting_key", `${VISIT_REPORT_HISTORY_PREFIX}${code}:%`)
      .order("setting_key", { ascending: false })
      .limit(40);
    if (error) {
      const message = String(error?.message || error?.details || "").toLowerCase();
      if (error?.code === "42P01" || message.includes("does not exist")) return;
      throw error;
    }

    let bestNear = "";
    (data || []).forEach((row) => {
      const visit = parseVisitSettingPayload(row);
      if (!visit) return;
      const gps = customerGpsByCode.get(visit.customerCode)
        || customerGpsByCode.get(code)
        || null;
      if (visitIsFar(visit, gps)) return;
      bestNear = laterIso(bestNear, visit.visitAt);
    });
    if (bestNear) {
      customerCodeAliases(code).forEach((alias) => {
        nearByCode.set(alias, laterIso(nearByCode.get(alias), bestNear));
      });
    }
  }));

  return nearByCode;
}

export async function loadLastVisitWithoutOrderByCustomer(admin, customerCodes = []) {
  const latest = new Map();
  const codes = [...new Set(
    (customerCodes || [])
      .flatMap((code) => customerCodeAliases(code))
      .filter(Boolean),
  )];
  if (!codes.length || typeof admin?.from !== "function") return latest;

  const visitPayloads = [];
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
      const visit = parseVisitSettingPayload(row);
      if (visit) visitPayloads.push(visit);
    });
  }

  const customerGpsByCode = await loadCustomerGpsByCode(
    admin,
    visitPayloads.map((visit) => visit.customerCode),
  );

  const farCodes = new Set();
  visitPayloads.forEach((visit) => {
    const gps = customerGpsByCode.get(visit.customerCode) || null;
    const isFar = visitIsFar(visit, gps);
    const visitAt = laterIso("", visit.visitAt);
    const nearVisitAt = isFar ? "" : visitAt;
    if (isFar) farCodes.add(visit.customerCode);
    const meta = { visitAt, isFar, nearVisitAt };
    customerCodeAliases(visit.customerCode).forEach((alias) => {
      latest.set(alias, preferLaterVisitMeta(latest.get(alias), meta));
    });
  });

  if (farCodes.size) {
    const nearFromHistory = await loadNearVisitFromHistory(admin, [...farCodes], customerGpsByCode);
    nearFromHistory.forEach((nearVisitAt, alias) => {
      const current = latest.get(alias) || emptyVisitMeta();
      latest.set(alias, {
        ...current,
        nearVisitAt: laterIso(current.nearVisitAt, nearVisitAt),
      });
    });
  }

  return latest;
}

export function attachLastVisitWithoutOrder(rows = [], visitByCustomer = new Map()) {
  return (rows || []).map((row) => {
    const aliases = customerCodeAliases(row?.customer_code);
    let meta = emptyVisitMeta();
    aliases.forEach((alias) => {
      const value = visitByCustomer.get(alias);
      if (value == null) return;
      if (typeof value === "string") {
        meta = preferLaterVisitMeta(meta, { visitAt: value, isFar: false, nearVisitAt: value });
        return;
      }
      meta = preferLaterVisitMeta(meta, value);
    });
    return {
      ...row,
      last_visit_without_order_at: meta.visitAt || row?.last_visit_without_order_at || "",
      last_visit_without_order_is_far: Boolean(meta.visitAt && meta.isFar),
      last_near_visit_without_order_at: meta.nearVisitAt || row?.last_near_visit_without_order_at || "",
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
