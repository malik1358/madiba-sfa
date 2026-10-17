import { isWithinTeamEmailWindow } from "./workdayActivity.js";
import { sendStoredInvoiceUploadNotification } from "./invoiceUploadEmailServer.js";
import { runKpiTargetsEmailCycle } from "./kpiTargetsEmailServer.js";
import { runMatchedReceiptEmailCycle } from "./matchedReceiptEmailServer.js";
import { runDailySupplierOrderEmailCycle } from "./dailySupplierOrderEmailServer.js";
import {
  readSalesmanVisitPlanSnapshot,
  sendSalesmanVisitPlanEmailsFromPayload,
} from "./salesmanVisitPlanServer.js";

export const DEFERRED_TEAM_EMAILS_KEY = "deferred_team_emails_v1";
const MAX_ITEMS = 100;

function parseQueue(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.filter((item) => item && item.key && item.kind);
  } catch {
    return [];
  }
}

export function deferredTeamEmailKey(item = {}) {
  const kind = String(item.kind || "").trim();
  if (kind === "invoice_upload") return `invoice_upload:${String(item.orderId || "").trim()}`;
  if (kind === "kpi_targets") return `kpi_targets:${String(item.month || "").trim()}`;
  if (kind === "matched_receipt_upload") {
    const dates = [...new Set((item.uploadDates || []).map((date) => String(date || "").trim()).filter(Boolean))].sort();
    return `matched_receipt_upload:${dates.join(",")}`;
  }
  if (kind === "visit_plan") return `visit_plan:${String(item.reportDate || "").trim()}`;
  if (kind === "supplier_order") return `supplier_order:${String(item.date || "").trim()}`;
  return "";
}

export function mergeDeferredTeamEmailItem(items = [], item = {}, now = new Date()) {
  const key = deferredTeamEmailKey(item);
  if (!key) return items;
  const next = items.filter((row) => row.key !== key);
  const previous = items.find((row) => row.key === key);
  let payload = { ...item, kind: item.kind };
  if (item.kind === "kpi_targets" && previous) {
    const salesmanCodes = [...new Set([
      ...(previous.salesmanCodes || []),
      ...(item.salesmanCodes || []),
    ].map((code) => String(code || "").trim()).filter(Boolean))];
    payload = {
      ...previous,
      ...item,
      salesmanCodes,
      changedLabelsBySalesman: {
        ...(previous.changedLabelsBySalesman || {}),
        ...(item.changedLabelsBySalesman || {}),
      },
    };
  }
  if (item.kind === "matched_receipt_upload") {
    payload = {
      ...payload,
      uploadDates: [...new Set((item.uploadDates || []).map((date) => String(date || "").trim()).filter(Boolean))].sort(),
    };
  }
  next.push({
    key,
    kind: item.kind,
    createdAt: previous?.createdAt || now.toISOString(),
    ...payload,
  });
  return next.slice(-MAX_ITEMS);
}

async function readQueue(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", DEFERRED_TEAM_EMAILS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseQueue(data?.setting_value);
}

async function writeQueue(admin, items) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: DEFERRED_TEAM_EMAILS_KEY,
    setting_value: JSON.stringify({ items }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function enqueueDeferredTeamEmail(admin, item, now = new Date()) {
  const items = await readQueue(admin);
  await writeQueue(admin, mergeDeferredTeamEmailItem(items, item, now));
  return { queued: true, key: deferredTeamEmailKey(item) };
}

function deliveryKept(result) {
  if (!result) return true;
  if (Number(result.failedCount || 0) > 0) return true;
  if (result.sent === false && result.reason === "email_not_configured") return true;
  if (result.skipped && result.reason === "email_not_configured") return true;
  return false;
}

async function deliverItem(admin, item) {
  if (item.kind === "invoice_upload") {
    return sendStoredInvoiceUploadNotification(admin, { orderId: item.orderId });
  }
  if (item.kind === "kpi_targets") {
    return runKpiTargetsEmailCycle(admin, {
      month: item.month,
      salesmanCodes: item.salesmanCodes || [],
      changedLabelsBySalesman: item.changedLabelsBySalesman || {},
      trigger: item.trigger || "target_update_deferred",
    });
  }
  if (item.kind === "matched_receipt_upload") {
    return runMatchedReceiptEmailCycle(admin, { uploadDates: item.uploadDates || [] });
  }
  if (item.kind === "supplier_order") {
    return runDailySupplierOrderEmailCycle(admin, {
      date: item.date,
      trigger: "sales-upload-deferred",
    });
  }
  if (item.kind === "visit_plan") {
    const snapshot = await readSalesmanVisitPlanSnapshot(admin);
    if (!snapshot) return { skipped: true, reason: "missing_snapshot", sentCount: 0, failedCount: 0 };
    return sendSalesmanVisitPlanEmailsFromPayload(snapshot, { forcePreview: false });
  }
  return { skipped: true, reason: "unknown_kind", sentCount: 0, failedCount: 0 };
}

export async function flushDeferredTeamEmails(admin, { now = new Date() } = {}) {
  if (!isWithinTeamEmailWindow(now)) {
    return { skipped: true, reason: "outside_team_email_window", sent: 0, kept: 0 };
  }

  const items = await readQueue(admin);
  if (!items.length) return { skipped: false, sent: 0, kept: 0, results: [] };

  const kept = [];
  const results = [];
  for (const item of items) {
    try {
      const result = await deliverItem(admin, item);
      results.push({ key: item.key, kind: item.kind, kept: deliveryKept(result), reason: result?.reason || "" });
      if (deliveryKept(result)) kept.push(item);
    } catch (error) {
      kept.push(item);
      results.push({ key: item.key, kind: item.kind, kept: true, error: String(error?.message || error) });
    }
  }

  await writeQueue(admin, kept);
  return {
    skipped: false,
    sent: results.filter((row) => !row.kept).length,
    kept: kept.length,
    results,
  };
}
