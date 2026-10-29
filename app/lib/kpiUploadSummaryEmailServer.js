import { createClient } from "@supabase/supabase-js";
import { previousMonthKey } from "./categoryGrowth.js";
import { isKpiTargetProfile, mergeKpiTargetProfiles } from "./kpiTargetsTable.js";
import {
  KPI_UPLOAD_SUMMARY_DEBOUNCE_MS,
  KPI_UPLOAD_SUMMARY_LAST_SENT_KEY,
  KPI_UPLOAD_SUMMARY_PENDING_KEY,
  buildKpiUploadSummaryEmail,
  buildKpiUploadSummaryTable,
  isKpiUploadSummaryDue,
  kpiUploadSummarySignature,
  mergeKpiUploadSummaryPending,
  resolveKpiUploadSummaryEmailCc,
  resolveKpiUploadSummaryEmailRecipients,
} from "./kpiUploadSummaryEmail.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  emptyPerformanceActuals,
  monthStartDate,
  withDerivedKpiActuals,
} from "./performanceKpis.js";
import { loadPerformanceSnapshotsForSalesmen } from "./performanceKpisServer.js";
import { getKsaDateString } from "./workdayActivity.js";

function createServiceAdmin(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function readJsonSetting(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  try {
    const parsed = JSON.parse(String(data?.setting_value || "null"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJsonSetting(admin, key, value) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(value),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function loadKpiUploadSummaryPending(admin) {
  return readJsonSetting(admin, KPI_UPLOAD_SUMMARY_PENDING_KEY);
}

export async function saveKpiUploadSummaryPending(admin, pending) {
  await writeJsonSetting(admin, KPI_UPLOAD_SUMMARY_PENDING_KEY, pending || {});
}

export async function clearKpiUploadSummaryPending(admin) {
  await writeJsonSetting(admin, KPI_UPLOAD_SUMMARY_PENDING_KEY, { pending: false });
}

export async function loadKpiUploadSummaryLastSent(admin) {
  return readJsonSetting(admin, KPI_UPLOAD_SUMMARY_LAST_SENT_KEY);
}

export async function saveKpiUploadSummaryLastSent(admin, marker) {
  await writeJsonSetting(admin, KPI_UPLOAD_SUMMARY_LAST_SENT_KEY, marker || {});
}

/**
 * Mark that sales or receipts were uploaded. Resets the 15–20 minute debounce
 * so a burst of uploads produces one email.
 */
export async function scheduleKpiUploadSummaryEmail(admin, {
  trigger = "",
  now = new Date(),
  debounceMs = KPI_UPLOAD_SUMMARY_DEBOUNCE_MS,
} = {}) {
  const client = admin || createServiceAdmin();
  if (!client) return { scheduled: false, reason: "missing_admin" };
  const previous = await loadKpiUploadSummaryPending(client).catch(() => ({}));
  const pending = mergeKpiUploadSummaryPending(previous, { trigger, now, debounceMs });
  await saveKpiUploadSummaryPending(client, pending);
  return { scheduled: true, pending };
}

async function listKpiUploadSummarySalesmen(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,is_active")
    .order("salesman_name");
  if (error) throw error;
  return mergeKpiTargetProfiles((data || []).filter(isKpiTargetProfile));
}

export async function loadKpiUploadSummaryPayload(admin, {
  reportDate = "",
} = {}) {
  const todayIso = getKsaDateString();
  const monthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || "").slice(0, 10))
    ? String(reportDate).slice(0, 10)
    : `${String(monthStartDate(todayIso) || todayIso).slice(0, 7)}-01`;
  const salesmen = await listKpiUploadSummarySalesmen(admin);
  const salesmanPayload = salesmen.map((row) => ({
    salesmanCode: row.salesman_code,
    salesmanName: row.salesman_name,
  }));
  const priorMonth = previousMonthKey(String(monthStartDate(monthDate) || monthDate).slice(0, 7));
  const priorReportDate = priorMonth ? `${priorMonth}-01` : "";
  const [snapshots, priorSnapshots] = await Promise.all([
    loadPerformanceSnapshotsForSalesmen(admin, {
      salesmen: salesmanPayload,
      reportDate: monthDate,
    }),
    priorReportDate
      ? loadPerformanceSnapshotsForSalesmen(admin, {
        salesmen: salesmanPayload,
        reportDate: priorReportDate,
      })
      : Promise.resolve([]),
  ]);

  const priorMonthActualsByCode = {};
  (priorSnapshots || []).forEach((snapshot) => {
    const code = String(snapshot?.salesmanCode || "").trim().toUpperCase();
    if (!code) return;
    priorMonthActualsByCode[code] = withDerivedKpiActuals({
      ...emptyPerformanceActuals(),
      ...(snapshot.actuals || {}),
    });
  });

  const salesAsOfDate = String(
    snapshots.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.salesAsOfDate || "").slice(0, 10)))?.salesAsOfDate || "",
  ).slice(0, 10);
  const receiptAsOfDate = String(
    snapshots.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.receiptAsOfDate || "").slice(0, 10)))?.receiptAsOfDate || "",
  ).slice(0, 10);

  const summary = buildKpiUploadSummaryTable({
    rows: snapshots,
    reportDate: monthDate,
    todayIso,
    salesAsOfDate,
    receiptAsOfDate,
    priorMonth,
    priorMonthActualsByCode,
  });

  return { summary, monthDate, todayIso };
}

/**
 * Send when the debounce window has elapsed (or force=true).
 * Called from the 10-minute inactivity cron and optional manual cron.
 */
export async function runKpiUploadSummaryEmailCycle(admin, {
  trigger = "cron",
  force = false,
  env = process.env,
  send = sendEmail,
  now = new Date(),
  loadPending = loadKpiUploadSummaryPending,
  savePending = saveKpiUploadSummaryPending,
  clearPending = clearKpiUploadSummaryPending,
  loadLastSent = loadKpiUploadSummaryLastSent,
  saveLastSent = saveKpiUploadSummaryLastSent,
  loadPayload = loadKpiUploadSummaryPayload,
} = {}) {
  const pending = force ? { pending: true, triggers: [trigger] } : await loadPending(admin).catch(() => ({}));
  if (!force && !isKpiUploadSummaryDue(pending, now)) {
    return {
      skipped: true,
      reason: pending?.pending ? "debounce_wait" : "not_pending",
      sendAfter: pending?.sendAfter || "",
      sentCount: 0,
    };
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { skipped: true, reason: "email_not_configured", sentCount: 0 };
  }

  const to = resolveKpiUploadSummaryEmailRecipients(env);
  if (!to.length) {
    return { skipped: true, reason: "no_recipients", sentCount: 0 };
  }
  const isTestSend = Boolean(String(env.KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO || "").trim());
  const cc = isTestSend ? [] : resolveKpiUploadSummaryEmailCc(env, to);

  const { summary } = await loadPayload(admin);
  if (!summary?.rows?.length || !summary.salesmanCount) {
    if (!force) await clearPending(admin).catch(() => {});
    return { skipped: true, reason: "no_salesmen", sentCount: 0 };
  }

  const signature = kpiUploadSummarySignature(summary);
  if (!force && !isTestSend) {
    const lastSent = await loadLastSent(admin).catch(() => ({}));
    if (lastSent?.signature && lastSent.signature === signature) {
      await clearPending(admin).catch(() => {});
      return { skipped: true, reason: "unchanged", sentCount: 0, signature };
    }
  }

  const message = buildKpiUploadSummaryEmail({
    summary,
    trigger,
    triggers: pending?.triggers || [],
    env,
  });

  await send({
    to,
    cc,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  if (!isTestSend) {
    await saveLastSent(admin, {
      signature,
      lastSentAt: (now instanceof Date ? now : new Date(now)).toISOString(),
      trigger: String(trigger || ""),
      triggers: pending?.triggers || [],
      reportDate: summary.reportDate,
      salesmanCount: summary.salesmanCount,
    }).catch(() => {});
  }
  if (!force || pending?.pending) {
    await clearPending(admin).catch(() => {});
  }

  return {
    skipped: false,
    sentCount: 1,
    to,
    cc,
    reportDate: summary.reportDate,
    salesmanCount: summary.salesmanCount,
    signature,
  };
}
