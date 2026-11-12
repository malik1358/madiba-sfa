import { createClient } from "@supabase/supabase-js";
import { previousMonthKey } from "./categoryGrowth.js";
import { isKpiTargetProfile, mergeKpiTargetProfiles } from "./kpiTargetsTable.js";
import {
  allocateReceiptsToCategoryBuckets,
  buildCustomerCategoryMixFromFacts,
  pickCustomerAvgDaysToPay,
  sumExpectedCollectionCategoryBuckets,
  sumOutstandingCategoryBuckets,
  sumSalesCategoryBucketsFromFacts,
} from "./kpiUploadSummaryCategories.js";
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
  isKpiCollectionReceipt,
  monthStartDate,
  normalizeSalesmanCode,
} from "./performanceKpis.js";
import {
  loadPerformanceSnapshotsForSalesmen,
  loadStoredKpiActualsByCode,
} from "./performanceKpisServer.js";
import { loadActiveCustomersCompanyReport } from "./activeCustomersServer.js";
import { buildReceivableDaysReport } from "./receivableDays.js";
import { readReceivableDaysDataset } from "./receivableDaysServer.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import { salesBiFactsFromCube } from "./salesBiCube.js";
import {
  RECEIPT_DATASET_KEY,
  buildReceiptRow,
  normalizeReceiptDataset,
} from "./receiptRegister.js";
import {
  OUTSTANDING_DATASET_KEY,
  normalizeCode,
} from "./outstanding.js";
import { enrichCollectionRecordsWithAvgDays } from "./collectionAvgDays.js";
import { currentMonthDateRange } from "./salesInvoices.js";
import { getKsaDateString } from "./workdayActivity.js";
import { lastDayOfMonth } from "./biReportPeriod.js";

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

/**
 * Read company Avg collection days from the prepared receivable-days cache only.
 * Do not rebuild here — sales/outstanding uploads already refresh that dataset.
 */
export async function loadReceivableDaysReportForKpiSummary(admin, {
  asOfDate = "",
} = {}) {
  try {
    const dataset = await readReceivableDaysDataset(admin);
    if (!dataset?.monthlyReceivables || !dataset?.monthlyCreditSales) return null;
    const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
    return buildReceivableDaysReport({
      monthlyCreditSales: dataset.monthlyCreditSales,
      monthlyReceivables: dataset.monthlyReceivables,
      asOfDate: asOf,
    });
  } catch (error) {
    console.error("KPI upload summary: receivable days cache unavailable:", error);
    return null;
  }
}

function cubeFactsList(cube) {
  if (!cube) return [];
  if (Array.isArray(cube.facts)) return cube.facts;
  if (cube.facts && typeof cube.facts.values === "function") return salesBiFactsFromCube(cube);
  return [];
}

async function loadReceiptRowsForMonth(admin, { fromDate = "", toDate = "" } = {}) {
  try {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", RECEIPT_DATASET_KEY)
      .maybeSingle();
    if (error) throw error;
    const dataset = normalizeReceiptDataset(
      (() => {
        try {
          return JSON.parse(String(data?.setting_value || "null"));
        } catch {
          return null;
        }
      })(),
    );
    return (dataset.rows || [])
      .map((raw) => buildReceiptRow(raw))
      .filter((row) => {
        if (!isKpiCollectionReceipt(row)) return false;
        const day = String(row?.receipt_date || "").slice(0, 10);
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
        return Number(row?.amount || 0) > 0;
      });
  } catch (error) {
    console.error("KPI upload summary: receipt register unavailable for category split:", error);
    return [];
  }
}

async function loadOutstandingInvoicesForKpiSummary(admin) {
  try {
    const payload = await readJsonSetting(admin, OUTSTANDING_DATASET_KEY);
    const invoices = Array.isArray(payload?.invoices) ? payload.invoices : [];
    return invoices.filter((invoice) => Number(invoice?.pending_amount || 0) > 0);
  } catch (error) {
    console.error("KPI upload summary: outstanding invoices unavailable:", error);
    return [];
  }
}

function groupOutstandingInvoicesByCustomer(invoices = []) {
  const byCustomer = new Map();
  (invoices || []).forEach((invoice) => {
    const code = normalizeCode(invoice?.customer_code);
    if (!code) return;
    const current = byCustomer.get(code) || {
      customer_code: code,
      customer_name: String(invoice?.customer_name || "").trim(),
      invoices: [],
    };
    current.invoices.push(invoice);
    if (!current.customer_name && invoice?.customer_name) {
      current.customer_name = String(invoice.customer_name).trim();
    }
    byCustomer.set(code, current);
  });
  return [...byCustomer.values()];
}

/**
 * Sales category buckets from the BI cube; collection buckets from receipts
 * allocated by each customer's sales item mix (same cube). Expected remaining
 * uses open invoices × customer avg pay days (overdue open still counts).
 */
export async function loadKpiUploadSummaryCategoryBreakdown(admin, {
  month = "",
  priorMonth = "",
  salesmanCodes = [],
  todayIso = "",
} = {}) {
  const monthKey = String(month || "").slice(0, 7);
  const priorKey = String(priorMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;

  try {
    const cube = await loadSalesBiCube(admin, { allowStale: true });
    const facts = cubeFactsList(cube);
    const codeSet = new Set((salesmanCodes || []).map(normalizeSalesmanCode).filter(Boolean));
    const salesBuckets = sumSalesCategoryBucketsFromFacts(facts, {
      month: monthKey,
      salesmanCodes: codeSet,
    });
    const priorSalesBuckets = priorKey
      ? sumSalesCategoryBucketsFromFacts(facts, {
        month: priorKey,
        salesmanCodes: codeSet,
      })
      : null;

    const currentRange = currentMonthDateRange(`${monthKey}-01`);
    const priorRange = priorKey ? currentMonthDateRange(`${priorKey}-01`) : null;
    const asOf = String(todayIso || getKsaDateString()).slice(0, 10);
    const monthEnd = lastDayOfMonth(monthKey) || currentRange.to;

    const [currentReceipts, priorReceipts, outstandingInvoices] = await Promise.all([
      loadReceiptRowsForMonth(admin, { fromDate: currentRange.from, toDate: currentRange.to }),
      priorRange
        ? loadReceiptRowsForMonth(admin, { fromDate: priorRange.from, toDate: priorRange.to })
        : Promise.resolve([]),
      loadOutstandingInvoicesForKpiSummary(admin),
    ]);

    // Lifetime/all-months mix for open AR attribution; month mix for MTD receipts.
    const currentMix = buildCustomerCategoryMixFromFacts(facts, {
      month: monthKey,
      salesmanCodes: codeSet,
    });
    const outstandingMix = buildCustomerCategoryMixFromFacts(facts, {
      salesmanCodes: codeSet,
    });
    const priorMix = priorKey
      ? buildCustomerCategoryMixFromFacts(facts, {
        month: priorKey,
        salesmanCodes: codeSet,
      })
      : new Map();

    const customerRecords = groupOutstandingInvoicesByCustomer(outstandingInvoices);
    const enrichedCustomers = customerRecords.length
      ? await enrichCollectionRecordsWithAvgDays(admin, customerRecords, { todayIso: asOf })
      : [];
    const avgDaysByCustomer = new Map(
      enrichedCustomers.map((row) => [normalizeCode(row.customer_code), pickCustomerAvgDaysToPay(row)]),
    );

    return {
      salesBuckets,
      priorSalesBuckets,
      collectionBuckets: allocateReceiptsToCategoryBuckets(currentReceipts, currentMix),
      priorCollectionBuckets: priorKey
        ? allocateReceiptsToCategoryBuckets(priorReceipts, priorMix)
        : null,
      expectedCollectionBuckets: sumExpectedCollectionCategoryBuckets(outstandingInvoices, {
        avgDaysByCustomer,
        customerMix: outstandingMix,
        monthEnd,
      }),
      outstandingBuckets: sumOutstandingCategoryBuckets(outstandingInvoices, outstandingMix),
      cubeFacts: facts,
      salesmanCodes: [...codeSet],
    };
  } catch (error) {
    console.error("KPI upload summary: category breakdown unavailable:", error);
    return null;
  }
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
  const monthKey = String(monthStartDate(monthDate) || monthDate).slice(0, 7);
  const priorMonth = previousMonthKey(monthKey);
  const priorReportDate = priorMonth ? `${priorMonth}-01` : "";
  const [
    snapshots,
    priorMonthActualsByCode,
    receivableDaysReport,
    activeCustomersReport,
    categoryBreakdown,
  ] = await Promise.all([
    loadPerformanceSnapshotsForSalesmen(admin, {
      salesmen: salesmanPayload,
      reportDate: monthDate,
      allowRebuild: false,
    }),
    priorReportDate
      ? loadStoredKpiActualsByCode(admin, priorReportDate)
      : Promise.resolve({}),
    loadReceivableDaysReportForKpiSummary(admin, { asOfDate: todayIso }),
    loadActiveCustomersCompanyReport(admin, { asOfDate: todayIso }),
    loadKpiUploadSummaryCategoryBreakdown(admin, {
      month: monthKey,
      priorMonth,
      salesmanCodes: salesmanPayload.map((row) => row.salesmanCode),
      todayIso,
    }),
  ]);

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
    receivableDaysReport,
    activeCustomersReport,
    categoryBreakdown,
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
  to: toOverride = "",
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

  const overrideTo = String(toOverride || "").trim();
  const envWithTestTo = overrideTo
    ? { ...env, KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO: overrideTo }
    : env;
  const to = resolveKpiUploadSummaryEmailRecipients(envWithTestTo);
  if (!to.length) {
    return { skipped: true, reason: "no_recipients", sentCount: 0 };
  }
  const isTestSend = Boolean(String(envWithTestTo.KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO || "").trim());
  const cc = isTestSend ? [] : resolveKpiUploadSummaryEmailCc(envWithTestTo, to);

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
