import { sumOrderLineValue } from "./collectionDaySummary.js";
import {
  buildDailySupplierOrderEmail,
  buildDailySupplierOrderRow,
  DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY,
  groupDailySupplierOrders,
  parseDailySupplierOrderLastSent,
  resolveDailySupplierOrderDigestCc,
  resolveDailySupplierOrderDigestRecipients,
  selectDailySupplierOrders,
  supplierOrderDisplayName,
} from "./dailySupplierOrderEmail.js";
import { extractPdfText } from "./extractPdfText.js";
import { resolveInvoiceAmountExclVat } from "./invoiceAmountFromPdf.js";
import { compareOrderLinesWithInvoiceText } from "./invoiceOrderCompare.js";
import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, parseEmailList, sendEmail } from "./mailer.js";
import {
  hasUploadedInvoice,
  invoiceMetaKey,
  parseInvoiceMeta,
} from "./missingInvoiceEmail.js";
import { loadInvoiceMetaMap } from "./missingInvoiceEmailServer.js";
import { INVOICE_BUCKET } from "./orderInvoiceComparison.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import {
  addKsaCalendarDays,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
  getPreviousKsaDateString,
  isKsaOrderDay,
  ksaDayBounds,
} from "./workdayActivity.js";

const ORDERS_SELECT = "id,order_number,customer_code,customer_name,salesman_code,salesman_name,status,created_by,created_at,updated_at,submitted_at,total_value";
const PAGE_SIZE = 1000;
const LINE_CHUNK = 200;

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function envFlagEnabled(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function parseSupplierOrderReportDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getPreviousKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveDailySupplierOrderEmailSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseSupplierOrderReportDate(explicit, now), skipped: false, reason: "" };
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

function salesmanOrderRecipients({ reportEmail, email, chainEmails = [] } = {}) {
  const user = normalizeDeliverableEmail(reportEmail) || normalizeDeliverableEmail(email);
  const to = [];
  if (user) to.push(user);
  parseEmailList(Array.isArray(chainEmails) ? chainEmails.join(",") : chainEmails).forEach((address) => {
    if (!to.includes(address)) to.push(address);
  });
  return { to };
}

function orderTimestampIso(row) {
  return String(row?.submitted_at || row?.created_at || row?.updated_at || "").trim();
}

function isSubmittedOrderInWindow(row, startIso, endIso) {
  if (String(row?.status || "").toUpperCase() !== "SUBMITTED") return false;
  const ts = Date.parse(orderTimestampIso(row));
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.parse(startIso) && ts <= Date.parse(endIso);
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = admin.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function loadSubmittedOrdersForKsaDate(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const orders = await fetchPagedRows(
    admin,
    "sales_orders",
    ORDERS_SELECT,
    (query) => query
      .eq("status", "SUBMITTED")
      .gte("updated_at", widenedStart.toISOString())
      .lte("updated_at", widenedEnd.toISOString()),
  );

  return selectDailySupplierOrders(orders.filter((row) => isSubmittedOrderInWindow(row, startIso, endIso)));
}

export async function loadOrderValuesById(admin, orders = []) {
  const values = new Map();
  const linesByOrder = new Map();
  const orderIds = [...new Set((orders || []).map((order) => Number(order?.id)).filter(Boolean))];

  for (const chunk of chunkList(orderIds, LINE_CHUNK)) {
    const lines = await fetchPagedRows(
      admin,
      "sales_order_items",
      "order_id,item_code,item_name,quantity,rate,line_value",
      (query) => query.in("order_id", chunk),
    );
    lines.forEach((line) => {
      const orderId = String(line.order_id || "").trim();
      if (!orderId) return;
      if (!linesByOrder.has(orderId)) linesByOrder.set(orderId, []);
      linesByOrder.get(orderId).push(line);
    });
  }

  linesByOrder.forEach((lines, orderId) => {
    values.set(orderId, sumOrderLineValue(lines));
  });

  (orders || []).forEach((order) => {
    const orderId = String(order?.id || "").trim();
    if (!orderId || values.has(orderId)) return;
    const fallback = Number(order?.total_value);
    values.set(orderId, Number.isFinite(fallback) ? fallback : 0);
  });

  return { values, linesByOrder };
}

export function cachedInvoiceAmountExclVat(meta) {
  const payload = parseInvoiceMeta(meta) || {};
  const amount = Number(payload.invoiceAmountExclVat);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function extractAmountFromStoredInvoice(admin, meta, orderLines) {
  const path = String(meta?.invoiceFilePath || "").trim();
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(path);
    if (error) throw error;
    const pdfText = await extractPdfText(await data.arrayBuffer());
    const diffs = compareOrderLinesWithInvoiceText(orderLines, pdfText);
    return resolveInvoiceAmountExclVat({ pdfText, orderLines, diffs });
  } catch {
    return invoiceAmountFromLinesOnly(orderLines);
  }
}

function invoiceAmountFromLinesOnly(orderLines) {
  return resolveInvoiceAmountExclVat({ orderLines, diffs: [] });
}

export async function resolveInvoiceValuesByOrder(admin, orders, metaByOrder, linesByOrder) {
  const amounts = new Map();
  for (const order of orders || []) {
    const orderId = String(order?.id || "").trim();
    const meta = metaByOrder.get(orderId);
    if (!hasUploadedInvoice(meta)) {
      amounts.set(orderId, null);
      continue;
    }

    const cached = cachedInvoiceAmountExclVat(meta);
    if (cached != null) {
      amounts.set(orderId, cached);
      continue;
    }

    const orderLines = linesByOrder.get(orderId) || [];
    const extracted = await extractAmountFromStoredInvoice(admin, meta, orderLines);
    amounts.set(orderId, extracted);

    if (Number.isFinite(extracted) && extracted > 0 && typeof admin?.from === "function") {
      try {
        await admin.from("system_settings").upsert({
          setting_key: invoiceMetaKey(orderId),
          setting_value: JSON.stringify({
            ...(parseInvoiceMeta(meta) || { orderId }),
            invoiceAmountExclVat: extracted,
            invoiceAmountExtractedAt: new Date().toISOString(),
          }),
        }, { onConflict: "setting_key" });
      } catch {
        // Cache is best-effort.
      }
    }
  }
  return amounts;
}

export async function loadProfilesForSupplierOrderEmails(admin) {
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

export async function loadLastDailySupplierOrderEmailDate(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseDailySupplierOrderLastSent(data?.setting_value);
}

export async function saveLastDailySupplierOrderEmailDate(admin, reportDate) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY,
    setting_value: JSON.stringify({ date: reportDate, lastSentAt: new Date().toISOString() }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

function buildRowsForOrders(orders, {
  profile = null,
  metaByOrder,
  orderValues,
  invoiceValues,
} = {}) {
  return (orders || []).map((order) => {
    const orderId = String(order?.id || "").trim();
    return buildDailySupplierOrderRow(order, metaByOrder.get(orderId), {
      profile,
      orderValue: orderValues.get(orderId),
      invoiceValue: invoiceValues.get(orderId),
    });
  });
}

export async function runDailySupplierOrderEmailCycle(admin, {
  date,
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadOrders = loadSubmittedOrdersForKsaDate,
  loadProfiles = loadProfilesForSupplierOrderEmails,
  loadMeta = loadInvoiceMetaMap,
  loadValues = loadOrderValuesById,
  loadInvoiceValues = resolveInvoiceValuesByOrder,
  loadLastSentDate = loadLastDailySupplierOrderEmailDate,
  saveLastSentDate = saveLastDailySupplierOrderEmailDate,
  listAuthUsers = loadAuthUsers,
} = {}) {
  const schedule = resolveDailySupplierOrderEmailSchedule(date, now);
  const reportDate = schedule.date;

  if (schedule.skipped) {
    return { date: reportDate, skipped: true, reason: schedule.reason, sentCount: 0, orderCount: 0 };
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, orderCount: 0 };
  }

  const lastSentDate = await loadLastSentDate(admin);
  if (lastSentDate === reportDate && !envFlagEnabled(env.DAILY_SUPPLIER_ORDER_EMAIL_FORCE, false)) {
    return { date: reportDate, skipped: true, reason: "already_sent", sentCount: 0, orderCount: 0 };
  }

  const orders = await loadOrders(admin, reportDate);
  if (!orders.length) {
    return { date: reportDate, skipped: true, reason: "no_orders", sentCount: 0, orderCount: 0 };
  }

  const [profiles, metaByOrder, authUsers] = await Promise.all([
    loadProfiles(admin),
    loadMeta(admin, orders.map((order) => order.id)),
    listAuthUsers(admin),
  ]);
  const { values: orderValues, linesByOrder } = await loadValues(admin, orders);
  const invoiceValues = await loadInvoiceValues(admin, orders, metaByOrder, linesByOrder);
  const groups = groupDailySupplierOrders(orders, profiles);
  const sendToUsers = envFlagEnabled(env.DAILY_SUPPLIER_ORDER_EMAIL_SEND_TO_USERS, true);
  const digestTo = resolveDailySupplierOrderDigestRecipients(env);
  const digestCc = resolveDailySupplierOrderDigestCc(env, digestTo);

  const results = [];
  let sentCount = 0;
  let failedCount = 0;

  if (sendToUsers) {
    for (const group of groups) {
      const rows = buildRowsForOrders(group.orders, {
        profile: group.profile,
        metaByOrder,
        orderValues,
        invoiceValues,
      });
      const salesmanName = group.salesmanName || supplierOrderDisplayName(group.orders[0], group.profile);
      const message = buildDailySupplierOrderEmail({
        date: reportDate,
        salesmanName,
        rows,
        includeSalesman: false,
      });
      const chainEmails = resolveReportingChainFromAuth({
        actorUserId: group.profile?.id,
        profiles,
        authUsers,
      }).map((boss) => normalizeDeliverableEmail(boss?.report_email) || normalizeDeliverableEmail(boss?.email))
        .filter(Boolean);
      const recipients = salesmanOrderRecipients({
        reportEmail: group.profile?.report_email,
        email: group.profile?.email,
        chainEmails,
      });
      if (!recipients.to.length) {
        results.push({ salesmanName, skipped: true, reason: "no_recipients", orderCount: rows.length });
        continue;
      }
      try {
        const sent = await send({ ...message, to: recipients.to }, env);
        sentCount += 1;
        results.push({
          salesmanName,
          skipped: false,
          orderCount: rows.length,
          to: recipients.to,
          provider: sent?.provider || null,
        });
      } catch (error) {
        failedCount += 1;
        results.push({
          salesmanName,
          skipped: false,
          failed: true,
          orderCount: rows.length,
          to: recipients.to,
          error: error.message || "Unable to send email",
        });
      }
    }
  }

  const digestRows = buildRowsForOrders(orders, { metaByOrder, orderValues, invoiceValues });
  if (digestTo.length) {
    const message = buildDailySupplierOrderEmail({
      date: reportDate,
      salesmanName: "",
      rows: digestRows,
      includeSalesman: true,
    });
    try {
      const sent = await send({ ...message, to: digestTo, cc: digestCc }, env);
      sentCount += 1;
      results.push({
        salesmanName: "all",
        skipped: false,
        orderCount: digestRows.length,
        to: digestTo,
        cc: digestCc,
        provider: sent?.provider || null,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        salesmanName: "all",
        skipped: false,
        failed: true,
        orderCount: digestRows.length,
        to: digestTo,
        cc: digestCc,
        error: error.message || "Unable to send email",
      });
    }
  }

  if (sentCount > 0 && failedCount === 0) {
    try {
      await saveLastSentDate(admin, reportDate);
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
    orderCount: orders.length,
    groupCount: groups.length,
    results,
  };
}
