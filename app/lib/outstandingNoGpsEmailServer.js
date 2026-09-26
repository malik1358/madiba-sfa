import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, parseEmailList, sendEmail } from "./mailer.js";
import {
  buildOutstandingNoGpsEmail,
  buildOutstandingNoGpsEmailRow,
  buildOutstandingNoGpsReportUrl,
  groupOutstandingNoGpsBySalesman,
  OUTSTANDING_NO_GPS_EMAIL_LAST_SENT_KEY,
  parseOutstandingNoGpsLastSent,
  resolveOutstandingNoGpsDigestCc,
  resolveOutstandingNoGpsDigestRecipients,
  salesmanOutstandingNoGpsRecipients,
} from "./outstandingNoGpsEmail.js";
import { fetchOutstandingNoGpsCustomers } from "./outstandingNoGps.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
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

export function parseOutstandingNoGpsReportDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveOutstandingNoGpsEmailSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseOutstandingNoGpsReportDate(explicit, now), skipped: false, reason: "" };
  }

  const reportDate = getKsaDateString(now);
  if (getKsaWeekdayIndex(now) === 5 || getKsaWeekdayIndexForDateString(reportDate) === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }

  return { date: reportDate, skipped: false, reason: "" };
}

export async function loadProfilesForOutstandingNoGpsEmails(admin) {
  const extra = "id,role,salesman_code,salesman_name,email,report_email,is_active";
  const fallback = "id,role,salesman_code,salesman_name,email,is_active";
  let result = await admin.from("profiles").select(extra);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback);
  }
  if (result.error) throw result.error;
  return (result.data || []).filter((row) => row.is_active !== false);
}

async function loadAuthUsers(admin) {
  if (typeof admin?.auth?.admin?.listUsers !== "function") return [];
  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;
  return usersRes.data?.users || [];
}

export async function loadLastOutstandingNoGpsEmailMarker(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_NO_GPS_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseOutstandingNoGpsLastSent(data?.setting_value);
}

export async function saveLastOutstandingNoGpsEmailMarker(admin, {
  reportDate,
  asOfIso,
  trigger = "",
} = {}) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: OUTSTANDING_NO_GPS_EMAIL_LAST_SENT_KEY,
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

function buildRowsForCustomers(customers, { profile = null } = {}) {
  return (customers || []).map((row) => buildOutstandingNoGpsEmailRow(row, { profile }));
}

function dedupeOutstandingNoGpsCustomers(customers = []) {
  const seen = new Set();
  const rows = [];
  (customers || []).forEach((row) => {
    const key = [
      String(row?.customer_code || "").trim().toUpperCase(),
      String(row?.current_salesman_code || row?.salesman_code || "").trim().toUpperCase(),
      String(row?.customer_name || "").trim().toUpperCase(),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });
  return rows;
}

export async function runOutstandingNoGpsEmailCycle(admin, {
  date,
  trigger = "manual",
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadCustomers = fetchOutstandingNoGpsCustomers,
  loadProfiles = loadProfilesForOutstandingNoGpsEmails,
  loadLastSentMarker = loadLastOutstandingNoGpsEmailMarker,
  saveLastSentMarker = saveLastOutstandingNoGpsEmailMarker,
  listAuthUsers = loadAuthUsers,
} = {}) {
  const force = envFlagEnabled(env.OUTSTANDING_NO_GPS_EMAIL_FORCE, false);
  const normalizedTrigger = String(trigger || "manual").trim().toLowerCase() || "manual";
  const testTo = parseEmailList(env.OUTSTANDING_NO_GPS_EMAIL_TEST_TO);
  const isTestSend = testTo.length > 0;
  const asOf = now instanceof Date ? now : new Date(now);
  const asOfIso = asOf.toISOString();
  const explicitDate = Boolean(String(date || "").trim());

  let reportDate = "";
  if (explicitDate) {
    reportDate = parseOutstandingNoGpsReportDate(date, asOf);
  } else if (normalizedTrigger === "cron") {
    const schedule = resolveOutstandingNoGpsEmailSchedule("", asOf);
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

  const customers = await loadCustomers(admin);
  if (!customers.length) {
    return {
      date: reportDate,
      skipped: true,
      reason: "no_customers",
      sentCount: 0,
      customerCount: 0,
    };
  }

  const [profiles, authUsers] = await Promise.all([
    loadProfiles(admin),
    listAuthUsers(admin),
  ]);
  const groups = groupOutstandingNoGpsBySalesman(customers, profiles);
  const sendToUsers = isTestSend
    ? false
    : envFlagEnabled(env.OUTSTANDING_NO_GPS_EMAIL_SEND_TO_USERS, true);
  const digestTo = isTestSend ? testTo : resolveOutstandingNoGpsDigestRecipients(env);
  const digestCc = isTestSend ? [] : resolveOutstandingNoGpsDigestCc(env, digestTo);
  const reportUrl = buildOutstandingNoGpsReportUrl(env);

  const results = [];
  let sentCount = 0;
  let failedCount = 0;
  const usedDigestEmails = new Set();
  const bossRowsById = new Map();

  if (sendToUsers) {
    for (const group of groups) {
      const rows = buildRowsForCustomers(group.rows, { profile: group.profile });
      const salesmanName = group.salesmanName;
      const message = buildOutstandingNoGpsEmail({
        date: reportDate,
        salesmanName,
        rows,
        includeSalesman: false,
        reportUrl,
      });
      const chain = resolveReportingChainFromAuth({
        actorUserId: group.profile?.id,
        profiles,
        authUsers,
      });
      chain.forEach((boss) => {
        if (!boss?.id) return;
        if (!bossRowsById.has(boss.id)) {
          bossRowsById.set(boss.id, { boss, rows: [] });
        }
        bossRowsById.get(boss.id).rows.push(...group.rows);
      });
      const recipients = salesmanOutstandingNoGpsRecipients({
        reportEmail: group.profile?.report_email,
        email: group.profile?.email,
        chainEmails: [],
      });
      if (!recipients.to.length) {
        results.push({ salesmanName, skipped: true, reason: "no_recipients", customerCount: rows.length });
        continue;
      }
      try {
        const sent = await send({
          ...message,
          to: recipients.to,
        }, env);
        sentCount += 1;
        results.push({
          salesmanName,
          skipped: false,
          customerCount: rows.length,
          to: recipients.to,
          cc: [],
          provider: sent?.provider || null,
        });
      } catch (error) {
        failedCount += 1;
        results.push({
          salesmanName,
          skipped: false,
          failed: true,
          customerCount: rows.length,
          to: recipients.to,
          cc: [],
          error: error.message || "Unable to send email",
        });
      }
    }
  }

  const bossDigests = [...bossRowsById.values()].sort((left, right) => (
    String(left.boss?.salesman_name || left.boss?.salesman_code || "").localeCompare(
      String(right.boss?.salesman_name || right.boss?.salesman_code || ""),
    )
  ));
  for (const { boss, rows } of bossDigests) {
    const inbox = normalizeDeliverableEmail(boss?.report_email) || normalizeDeliverableEmail(boss?.email);
    const digestRows = buildRowsForCustomers(dedupeOutstandingNoGpsCustomers(rows));
    if (!inbox || !digestRows.length) continue;
    const message = buildOutstandingNoGpsEmail({
      date: reportDate,
      salesmanName: boss?.salesman_name || boss?.salesman_code || "Team",
      rows: digestRows,
      includeSalesman: true,
      reportUrl,
      audience: "boss",
    });
    try {
      const sent = await send({ ...message, to: [inbox] }, env);
      sentCount += 1;
      usedDigestEmails.add(inbox);
      results.push({
        salesmanName: boss?.salesman_name || boss?.salesman_code || "Team",
        skipped: false,
        customerCount: digestRows.length,
        to: [inbox],
        cc: [],
        kind: "boss_digest",
        provider: sent?.provider || null,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        salesmanName: boss?.salesman_name || boss?.salesman_code || "Team",
        skipped: false,
        failed: true,
        customerCount: digestRows.length,
        to: [inbox],
        cc: [],
        kind: "boss_digest",
        error: error.message || "Unable to send email",
      });
    }
  }

  const digestRows = buildRowsForCustomers(customers);
  const filteredDigestTo = digestTo.filter((email) => !usedDigestEmails.has(email));
  if (filteredDigestTo.length) {
    const message = buildOutstandingNoGpsEmail({
      date: reportDate,
      salesmanName: "",
      rows: digestRows,
      includeSalesman: true,
      reportUrl,
      audience: "digest",
    });
    try {
      const sent = await send({ ...message, to: filteredDigestTo, cc: digestCc.filter((email) => !usedDigestEmails.has(email)) }, env);
      sentCount += 1;
      results.push({
        salesmanName: "all",
        skipped: false,
        customerCount: digestRows.length,
        to: filteredDigestTo,
        cc: digestCc.filter((email) => !usedDigestEmails.has(email)),
        kind: "company_digest",
        provider: sent?.provider || null,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        salesmanName: "all",
        skipped: false,
        failed: true,
        customerCount: digestRows.length,
        to: filteredDigestTo,
        cc: digestCc.filter((email) => !usedDigestEmails.has(email)),
        kind: "company_digest",
        error: error.message || "Unable to send email",
      });
    }
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
    skipped: sentCount === 0 && failedCount === 0,
    reason: sentCount === 0 && failedCount === 0 ? "no_recipients" : "",
    sentCount,
    failedCount,
    customerCount: customers.length,
    groupCount: groups.length,
    asOfIso,
    trigger: normalizedTrigger,
    results,
  };
}
