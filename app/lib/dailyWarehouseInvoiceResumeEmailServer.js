import { randomUUID } from "node:crypto";
import {
  bucketWarehouseInvoiceResumeRows,
  buildDailyWarehouseInvoiceResumeEmail,
  buildWarehouseInvoiceResumeRow,
  dailyWarehouseInvoiceResumeClaimKey,
  DAILY_WAREHOUSE_INVOICE_RESUME_KEY_PREFIX,
  resolveDailyWarehouseInvoiceResumeRecipients,
  selectWarehouseInvoiceResumeRows,
} from "./dailyWarehouseInvoiceResumeEmail.js";
import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import { hasUploadedInvoice, parseInvoiceMeta } from "./missingInvoiceEmail.js";
import {
  addKsaCalendarDays,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
  getPreviousKsaDateString,
  isKsaOrderDay,
  ksaDayBounds,
} from "./workdayActivity.js";
import {
  warehouseInvoicePricingRegion,
  WAREHOUSE_INVOICE_BUCKET_DAMMAM,
  WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
} from "./warehouseInvoiceRecipients.js";

const META_PAGE = 1000;
const ORDER_CHUNK = 200;

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function parseWarehouseInvoiceResumeDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) {
    const previousDate = getPreviousKsaDateString(now);
    return getKsaWeekdayIndexForDateString(previousDate) === 5
      ? addKsaCalendarDays(previousDate, -1)
      : previousDate;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveDailyWarehouseInvoiceResumeSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseWarehouseInvoiceResumeDate(explicit, now), skipped: false, reason: "" };
  }

  const previousDate = getPreviousKsaDateString(now);
  const previousWeekday = getKsaWeekdayIndexForDateString(previousDate);

  if (previousWeekday === 5) {
    return { date: addKsaCalendarDays(previousDate, -1), skipped: false, reason: "" };
  }

  if (getKsaWeekdayIndex(now) === 5) {
    return { date: previousDate, skipped: true, reason: "friday_holiday" };
  }

  if (!isKsaOrderDay(previousDate)) {
    return { date: previousDate, skipped: true, reason: "not_order_day" };
  }

  return { date: previousDate, skipped: false, reason: "" };
}

export function resolveDailyWarehouseInvoiceResumeRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

export async function claimDailyWarehouseInvoiceResume(admin, date) {
  const settingKey = dailyWarehouseInvoiceResumeClaimKey(date);
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

export async function finishDailyWarehouseInvoiceResume(admin, claim, summary = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        ...summary,
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseDailyWarehouseInvoiceResumeClaim(admin, claim) {
  if (!claim?.settingKey) return;
  await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
}

async function loadUploadedInvoiceMetaInWindow(admin, sinceMs, asOfMs) {
  const metaByOrder = new Map();
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .like("setting_key", "order_invoice_meta:%")
      .order("setting_key", { ascending: true })
      .range(offset, offset + META_PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const payload = parseInvoiceMeta(row.setting_value);
      if (!payload || !hasUploadedInvoice(payload)) continue;
      const uploadedMs = Date.parse(String(payload.invoiceUploadedAt || ""));
      if (!Number.isFinite(uploadedMs) || uploadedMs < sinceMs || uploadedMs > asOfMs) continue;
      const orderId = String(payload.orderId || String(row.setting_key || "").replace(/^order_invoice_meta:/, "")).trim();
      if (!orderId) continue;
      metaByOrder.set(orderId, { ...payload, orderId });
    }
    if (rows.length < META_PAGE) break;
    offset += META_PAGE;
  }
  return metaByOrder;
}

async function loadOrdersByIds(admin, orderIds) {
  const map = new Map();
  const ids = [...new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  for (const chunk of chunkList(ids, ORDER_CHUNK)) {
    const { data, error } = await admin
      .from("sales_orders")
      .select("id,order_number,customer_code,customer_name,salesman_code,salesman_name,status,created_at,updated_at,submitted_at")
      .in("id", chunk);
    if (error) throw error;
    (data || []).forEach((order) => {
      map.set(String(order.id), order);
    });
  }
  return map;
}

async function loadPricingRegionByOrder(admin, orderIds) {
  const map = new Map();
  const ids = [...new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  for (const chunk of chunkList(ids, ORDER_CHUNK)) {
    const keys = chunk.map((id) => `order_pricing_meta:${id}`);
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .in("setting_key", keys);
    if (error) throw error;
    (data || []).forEach((row) => {
      const orderId = String(row.setting_key || "").replace(/^order_pricing_meta:/, "").trim();
      const payload = parseInvoiceMeta(row.setting_value);
      map.set(orderId, warehouseInvoicePricingRegion(payload?.pricingRegion || payload?.region || ""));
    });
  }
  return map;
}

export async function loadDailyWarehouseInvoiceResumeRows(admin, {
  date,
  now = new Date(),
} = {}) {
  const reportDate = parseWarehouseInvoiceResumeDate(date, now);
  const bounds = ksaDayBounds(reportDate);
  const sinceMs = Date.parse(bounds.startIso);
  const asOfMs = Date.parse(bounds.endIso);
  const metaByOrder = await loadUploadedInvoiceMetaInWindow(admin, sinceMs, asOfMs);
  const orderIds = [...metaByOrder.keys()];
  const [ordersById, pricingRegionByOrder] = await Promise.all([
    loadOrdersByIds(admin, orderIds),
    loadPricingRegionByOrder(admin, orderIds),
  ]);
  const orders = orderIds.map((id) => ordersById.get(id)).filter(Boolean);
  const rows = selectWarehouseInvoiceResumeRows({
    orders,
    metaByOrder,
    pricingRegionByOrder,
    sinceMs,
    asOfMs,
  });
  // Include meta-only rows if the order row was deleted but invoice meta remains.
  for (const orderId of orderIds) {
    if (ordersById.has(orderId)) continue;
    const row = buildWarehouseInvoiceResumeRow({
      order: { id: orderId, status: "SUBMITTED" },
      meta: metaByOrder.get(orderId),
      pricingRegion: pricingRegionByOrder.get(orderId) || "",
    });
    if (row && row.uploadedAtMs >= sinceMs && row.uploadedAtMs <= asOfMs) rows.push(row);
  }
  rows.sort((a, b) => {
    if (b.uploadedAtMs !== a.uploadedAtMs) return b.uploadedAtMs - a.uploadedAtMs;
    return String(a.orderNumber).localeCompare(String(b.orderNumber));
  });
  return { date: reportDate, rows, buckets: bucketWarehouseInvoiceResumeRows(rows) };
}

export async function runDailyWarehouseInvoiceResumeEmailCycle(admin, {
  force = false,
  date = "",
  to = "",
  cc = "",
  env = process.env,
  now = new Date(),
  send = sendEmail,
  loadRows = loadDailyWarehouseInvoiceResumeRows,
} = {}) {
  const schedule = resolveDailyWarehouseInvoiceResumeSchedule(date, now);
  if (schedule.skipped) {
    return { skipped: true, reason: schedule.reason, date: schedule.date, sentCount: 0 };
  }

  const forceSend = truthyFlag(force) || truthyFlag(env.DAILY_WAREHOUSE_INVOICE_RESUME_FORCE);
  const testTo = parseEmailList(to || env.DAILY_WAREHOUSE_INVOICE_RESUME_TEST_TO || "");
  const isTestSend = testTo.length > 0;
  if (!isEmailConfigured(getMailerConfig(env))) {
    throw new Error("Email is not configured on the server.");
  }

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimDailyWarehouseInvoiceResume(admin, schedule.date);
    if (!claim) {
      return {
        skipped: true,
        reason: "already_claimed_or_sent",
        date: schedule.date,
        claimKey: dailyWarehouseInvoiceResumeClaimKey(schedule.date),
        sentCount: 0,
      };
    }
  }

  try {
    const loaded = await loadRows(admin, { date: schedule.date, now });
    const buckets = loaded.buckets || bucketWarehouseInvoiceResumeRows(loaded.rows || []);
    const bucketKeys = [
      WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
      WAREHOUSE_INVOICE_BUCKET_DAMMAM,
    ];
    const sent = [];
    const requestCc = parseEmailList(cc || env.DAILY_WAREHOUSE_INVOICE_RESUME_EXTRA_CC || "");

    for (const bucketKey of bucketKeys) {
      const rows = buckets[bucketKey] || [];
      // Scheduled runs skip empty buckets; force/test can send an empty table so routing can be checked.
      if (!rows.length && !forceSend && !isTestSend) continue;

      const mail = buildDailyWarehouseInvoiceResumeEmail({
        date: schedule.date,
        bucketKey,
        rows,
      });
      const recipients = resolveDailyWarehouseInvoiceResumeRecipients(bucketKey, env);
      const toList = isTestSend ? testTo : recipients.to;
      const ccList = [...new Set([...recipients.cc, ...requestCc])]
        .filter((email) => email && !toList.includes(email));

      if (!toList.length) continue;
      if (forceSend || isTestSend) mail.subject = `[TEST] ${mail.subject}`;

      await send({
        to: toList,
        ...(ccList.length ? { cc: ccList } : {}),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }, env);

      sent.push({
        bucketKey,
        to: toList,
        cc: ccList,
        invoiceCount: mail.counts.invoiceCount,
        totalAmountExclVat: mail.counts.totalAmountExclVat,
      });
    }

    if (!sent.length && !forceSend && !isTestSend) {
      if (claim) await finishDailyWarehouseInvoiceResume(admin, claim, { invoiceCount: 0, sentCount: 0 });
      return {
        skipped: true,
        reason: "no_invoices",
        date: schedule.date,
        sentCount: 0,
      };
    }

    if (claim) {
      await finishDailyWarehouseInvoiceResume(admin, claim, {
        sentCount: sent.length,
        invoiceCount: sent.reduce((sum, entry) => sum + entry.invoiceCount, 0),
      });
    }

    return {
      skipped: false,
      date: schedule.date,
      sentCount: sent.length,
      forced: forceSend || isTestSend,
      sends: sent,
    };
  } catch (error) {
    if (claim) await releaseDailyWarehouseInvoiceResumeClaim(admin, claim);
    throw error;
  }
}

export { DAILY_WAREHOUSE_INVOICE_RESUME_KEY_PREFIX };
