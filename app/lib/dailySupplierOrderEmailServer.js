import { sumOrderLineValue } from "./collectionDaySummary.js";
import {
  buildDailySupplierOrderEmail,
  buildDailySupplierOrderRow,
  DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY,
  defaultSupplierOrderSinceIso,
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
  missingInvoiceCreatedFromIso,
  parseInvoiceMeta,
} from "./missingInvoiceEmail.js";
import { loadInvoiceMetaMap } from "./missingInvoiceEmailServer.js";
import { INVOICE_BUCKET } from "./orderInvoiceComparison.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import {
  formatKsaDateTime,
  getKsaDateString,
  getKsaWeekdayIndex,
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
  if (!date) return getKsaDateString(now);
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

  if (getKsaWeekdayIndex(now) === 5) {
    return { date: getKsaDateString(now), skipped: true, reason: "friday_holiday" };
  }

  const reportDate = getKsaDateString(now);
  if (!isKsaOrderDay(reportDate) && !isKsaOrderDay(getPreviousKsaDateString(now))) {
    return { date: reportDate, skipped: true, reason: "not_order_day" };
  }

  return { date: reportDate, skipped: false, reason: "" };
}

function salesmanOrderRecipients({ reportEmail, email, chainEmails = [] } = {}) {
  const user = normalizeDeliverableEmail(reportEmail) || normalizeDeliverableEmail(email);
  const to = [];
  const cc = [];
  if (user) to.push(user);
  parseEmailList(Array.isArray(chainEmails) ? chainEmails.join(",") : chainEmails).forEach((address) => {
    const normalized = normalizeDeliverableEmail(address) || address;
    if (!normalized) return;
    if (to.includes(normalized) || cc.includes(normalized)) return;
    cc.push(normalized);
  });
  return { to, cc };
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

export async function loadSubmittedOrdersForSupplierReport(admin, {
  asOfIso = new Date().toISOString(),
} = {}) {
  const createdFromIso = missingInvoiceCreatedFromIso() || defaultSupplierOrderSinceIso();
  const orders = await fetchPagedRows(
    admin,
    "sales_orders",
    ORDERS_SELECT,
    (query) => query
      .eq("status", "SUBMITTED")
      .gte("created_at", createdFromIso)
      .lte("created_at", asOfIso)
      .order("created_at", { ascending: true }),
  );
  return orders;
}

/** @deprecated Prefer loadSubmittedOrdersForSupplierReport + selectDailySupplierOrders */
export async function loadSubmittedOrdersForKsaDate(admin, reportDate) {
  return loadSubmittedOrdersForSupplierReport(admin, {
    asOfIso: new Date().toISOString(),
  });
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

export async function loadLastDailySupplierOrderEmailMarker(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseDailySupplierOrderLastSent(data?.setting_value);
}

/** @deprecated use loadLastDailySupplierOrderEmailMarker */
export async function loadLastDailySupplierOrderEmailDate(admin) {
  const marker = await loadLastDailySupplierOrderEmailMarker(admin);
  return marker.date || marker.lastSentAt || "";
}

export async function saveLastDailySupplierOrderEmailMarker(admin, {
  reportDate,
  asOfIso,
  trigger = "",
} = {}) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY,
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

/** @deprecated use saveLastDailySupplierOrderEmailMarker */
export async function saveLastDailySupplierOrderEmailDate(admin, reportDate) {
  await saveLastDailySupplierOrderEmailMarker(admin, {
    reportDate,
    asOfIso: new Date().toISOString(),
    trigger: "legacy",
  });
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
  trigger = "manual",
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadOrders = loadSubmittedOrdersForSupplierReport,
  loadProfiles = loadProfilesForSupplierOrderEmails,
  loadMeta = loadInvoiceMetaMap,
  loadValues = loadOrderValuesById,
  loadInvoiceValues = resolveInvoiceValuesByOrder,
  loadLastSentMarker = loadLastDailySupplierOrderEmailMarker,
  saveLastSentMarker = saveLastDailySupplierOrderEmailMarker,
  listAuthUsers = loadAuthUsers,
  // Legacy test hooks
  loadLastSentDate,
  saveLastSentDate,
} = {}) {
  const force = envFlagEnabled(env.DAILY_SUPPLIER_ORDER_EMAIL_FORCE, false);
  const normalizedTrigger = String(trigger || "manual").trim().toLowerCase() || "manual";
  const testTo = parseEmailList(env.DAILY_SUPPLIER_ORDER_EMAIL_TEST_TO);
  const isTestSend = testTo.length > 0;
  const asOf = now instanceof Date ? now : new Date(now);
  let asOfIso = asOf.toISOString();
  const reportDate = parseSupplierOrderReportDate(date, asOf);
  const explicitDate = Boolean(String(date || "").trim());

  // Midnight cron keeps Friday skip; sales-upload always runs when data lands.
  if (normalizedTrigger === "cron" && !force) {
    const schedule = resolveDailySupplierOrderEmailSchedule("", asOf);
    if (schedule.skipped) {
      return { date: schedule.date, skipped: true, reason: schedule.reason, sentCount: 0, orderCount: 0 };
    }
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, orderCount: 0 };
  }

  const resolveLastSent = loadLastSentDate
    ? async () => {
      const legacy = await loadLastSentDate(admin);
      return parseDailySupplierOrderLastSent(legacy);
    }
    : loadLastSentMarker;

  const marker = await resolveLastSent(admin);

  // Always cover the full report KSA day (start → asOf), so Invoice made and
  // unbilled orders raised that day both appear. Older unbilled rows still carry forward.
  const dayBounds = ksaDayBounds(reportDate);
  let sinceIso = dayBounds.startIso;
  if (explicitDate && (isTestSend || normalizedTrigger === "manual" || force)) {
    asOfIso = dayBounds.endIso;
  } else {
    // Sales upload / live run: up to now, but not before day start.
    const dayEndMs = Date.parse(dayBounds.endIso);
    const asOfMs = Date.parse(asOfIso);
    if (Number.isFinite(dayEndMs) && Number.isFinite(asOfMs) && asOfMs > dayEndMs) {
      asOfIso = dayBounds.endIso;
    }
  }

  // Upload-driven sends advance the watermark; only block exact duplicate cron runs for the same KSA date.
  if (
    normalizedTrigger === "cron"
    && !force
    && !isTestSend
    && marker.date === reportDate
    && marker.lastSentAt
  ) {
    return { date: reportDate, skipped: true, reason: "already_sent", sentCount: 0, orderCount: 0 };
  }

  const candidateOrders = await loadOrders(admin, { sinceIso, asOfIso, reportDate });
  const candidateIds = candidateOrders.map((order) => order.id);
  const metaByOrder = await loadMeta(admin, candidateIds);
  const orders = selectDailySupplierOrders(candidateOrders, metaByOrder, { sinceIso, asOfIso });

  if (!orders.length) {
    return {
      date: reportDate,
      skipped: true,
      reason: "no_orders",
      sentCount: 0,
      orderCount: 0,
      sinceIso,
      asOfIso,
    };
  }

  const [profiles, authUsers] = await Promise.all([
    loadProfiles(admin),
    listAuthUsers(admin),
  ]);
  const { values: orderValues, linesByOrder } = await loadValues(admin, orders);
  const invoiceValues = await loadInvoiceValues(admin, orders, metaByOrder, linesByOrder);
  const groups = groupDailySupplierOrders(orders, profiles);
  const sendToUsers = isTestSend
    ? false
    : envFlagEnabled(env.DAILY_SUPPLIER_ORDER_EMAIL_SEND_TO_USERS, true);
  const digestTo = isTestSend ? testTo : resolveDailySupplierOrderDigestRecipients(env);
  const digestCc = isTestSend ? [] : resolveDailySupplierOrderDigestCc(env, digestTo);
  const asOfLabel = formatKsaDateTime(asOfIso);

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
        asOfLabel,
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
        const sent = await send({
          ...message,
          to: recipients.to,
          ...(recipients.cc.length ? { cc: recipients.cc } : {}),
        }, env);
        sentCount += 1;
        results.push({
          salesmanName,
          skipped: false,
          orderCount: rows.length,
          to: recipients.to,
          cc: recipients.cc,
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
          cc: recipients.cc,
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
      asOfLabel,
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

  if (sentCount > 0 && failedCount === 0 && !isTestSend) {
    try {
      if (saveLastSentDate) {
        await saveLastSentDate(admin, reportDate);
      } else {
        await saveLastSentMarker(admin, {
          reportDate,
          asOfIso,
          trigger: normalizedTrigger,
        });
      }
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
    sinceIso,
    asOfIso,
    trigger: normalizedTrigger,
    results,
  };
}
