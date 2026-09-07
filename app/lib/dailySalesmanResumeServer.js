import { sumOrderLineValue } from "./collectionDaySummary.js";
import {
  extractWorkdayTimesFromTimelineRows,
  loadLoggedActivityTimesByUser,
  loadWorkdayEventsByUser,
} from "./collectionDaySummaryServer.js";
import {
  buildDailySalesmanResumeEmail,
  emptySalesmanResumeRow,
  resolveDailySalesmanResumeRecipients,
  resolveResumeWorkingEndAt,
  shouldIncludeSalesmanResumeRow,
  sortSalesmanResumeRows,
} from "./dailySalesmanResume.js";
import { groupSalesRowsIntoInvoices } from "./salesInvoices.js";
import { formatCollectorDisplayName } from "./geo.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  calculateWorkingHoursMinutes,
  filterLogsByKsaEventDate,
  getPreviousKsaDateString,
  ksaDayBounds,
} from "./workdayActivity.js";

const SALESMAN_ROLES = new Set(["salesman", "collector"]);

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

export function isJwtClockSkewError(error) {
  const message = String(error?.message || error?.details || error || "").toLowerCase();
  return message.includes("jwt issued at future")
    || message.includes("issued at future");
}

export function formatSupabaseError(error) {
  if (!error) return "Unknown Supabase error";
  if (typeof error === "string") return error;
  const message = String(error.message || "Supabase request failed").trim();
  const details = [error.code, error.details, error.hint]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return details.length ? `${message} (${details.join(" | ")})` : message;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withJwtClockSkewRetry(work, {
  attempts = 3,
  delayMs = 1000,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      lastError = error;
      if (!isJwtClockSkewError(error) || attempt >= attempts) {
        throw error instanceof Error ? error : new Error(formatSupabaseError(error));
      }
      await sleep(delayMs * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(formatSupabaseError(lastError));
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function parseResumeDateParam(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getPreviousKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

function profileDisplayName(profile) {
  const name = String(profile?.salesman_name || "").trim();
  if (name) return name;
  const fromFormatter = formatCollectorDisplayName(profile);
  if (fromFormatter && fromFormatter.includes("@")) {
    return String(profile?.salesman_code || fromFormatter).trim();
  }
  return fromFormatter;
}

function ensureRow(map, profile) {
  const userId = String(profile?.id || profile?.userId || "").trim();
  if (!userId) return null;
  if (!map.has(userId)) {
    map.set(userId, emptySalesmanResumeRow({
      userId,
      salesmanName: profileDisplayName(profile),
      salesmanCode: profile?.salesman_code || profile?.salesmanCode || "",
      role: profile?.role || "",
    }));
  }
  return map.get(userId);
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    let query = admin.from(table).select(select).range(from, from + pageSize - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(formatSupabaseError(error));
    }
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function loadSalesmanResumeProfiles(admin) {
  // Match visit-report profile loading: avoid server-side is_active filter so
  // schema drift does not break the cron, then filter in JS.
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,is_active");

  if (error) throw new Error(formatSupabaseError(error));

  return (data || [])
    .filter((row) => row.is_active !== false)
    .filter((row) => SALESMAN_ROLES.has(normalizeRole(row.role)));
}

async function loadVisitCountsByUser(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const logs = await fetchPagedRows(
    admin,
    "daily_activity_logs",
    "user_id,entry_type,note,created_at",
    (query) => query
      .eq("entry_type", "VISIT_REPORT")
      .gte("created_at", widenedStart.toISOString())
      .lte("created_at", widenedEnd.toISOString()),
  );

  const counts = new Map();
  for (const row of filterLogsByKsaEventDate(logs, reportDate)) {
    const userId = String(row.user_id || "").trim();
    if (!userId) continue;
    counts.set(userId, (counts.get(userId) || 0) + 1);
  }
  return counts;
}

function laterIso(current, next) {
  const currentTs = Date.parse(String(current || ""));
  const nextTs = Date.parse(String(next || ""));
  if (!Number.isFinite(nextTs) || nextTs <= 0) return current || "";
  if (!Number.isFinite(currentTs) || nextTs > currentTs) return String(next);
  return current || "";
}

async function loadCollectionMetricsByUser(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const rows = await fetchPagedRows(
    admin,
    "collection_visits",
    "id,created_by,saved_at,amount_received",
    (query) => query.gte("saved_at", startIso).lte("saved_at", endIso),
  );

  const metrics = new Map();
  for (const row of rows) {
    const userId = String(row.created_by || "").trim();
    if (!userId) continue;
    const current = metrics.get(userId) || { count: 0, value: 0, lastAt: "" };
    current.count += 1;
    current.value += Number(row.amount_received || 0);
    current.lastAt = laterIso(current.lastAt, row.saved_at);
    metrics.set(userId, current);
  }
  return metrics;
}

function orderTimestampIso(row) {
  return String(row?.submitted_at || row?.updated_at || row?.created_at || "").trim();
}

function isSubmittedOrderInWindow(row, startIso, endIso) {
  if (String(row?.status || "").toUpperCase() !== "SUBMITTED") return false;
  const ts = Date.parse(orderTimestampIso(row));
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.parse(startIso) && ts <= Date.parse(endIso);
}

async function loadOrderMetricsByUser(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const orders = await fetchPagedRows(
    admin,
    "sales_orders",
    "id,created_by,status,total_quantity,total_items,submitted_at,updated_at,created_at",
    (query) => query
      .eq("status", "SUBMITTED")
      .gte("updated_at", widenedStart.toISOString())
      .lte("updated_at", widenedEnd.toISOString()),
  );

  const dayOrders = orders.filter((row) => isSubmittedOrderInWindow(row, startIso, endIso));
  const metrics = new Map();

  for (const row of dayOrders) {
    const userId = String(row.created_by || "").trim();
    if (!userId) continue;
    const current = metrics.get(userId) || {
      orders: 0,
      orderValue: 0,
      skuSoldCount: 0,
      lastAt: "",
      skuCodes: new Set(),
    };
    current.orders += 1;
    current.lastAt = laterIso(current.lastAt, orderTimestampIso(row));
    metrics.set(userId, current);
  }

  const orderIds = dayOrders.map((row) => Number(row.id)).filter(Boolean);
  const valueByOrderId = new Map();
  const linesByOrderId = new Map();
  for (const chunk of chunkList(orderIds, 200)) {
    const lines = await fetchPagedRows(
      admin,
      "sales_order_items",
      "order_id,item_code,line_value,quantity,rate",
      (query) => query.in("order_id", chunk),
    );
    const grouped = new Map();
    for (const line of lines) {
      const orderId = Number(line.order_id);
      if (!orderId) continue;
      if (!grouped.has(orderId)) grouped.set(orderId, []);
      grouped.get(orderId).push(line);
    }
    grouped.forEach((orderLines, orderId) => {
      valueByOrderId.set(orderId, sumOrderLineValue(orderLines));
      linesByOrderId.set(orderId, orderLines);
    });
  }

  for (const row of dayOrders) {
    const userId = String(row.created_by || "").trim();
    if (!userId) continue;
    const current = metrics.get(userId);
    if (!current) continue;
    const orderLines = linesByOrderId.get(Number(row.id)) || [];
    current.orderValue += Number(valueByOrderId.get(Number(row.id)) || 0);
    orderLines.forEach((line) => {
      const code = String(line.item_code || "").trim().toUpperCase();
      const quantity = Number(line.quantity);
      if (!code) return;
      if (Number.isFinite(quantity) && quantity <= 0) return;
      current.skuCodes.add(code);
    });
  }

  metrics.forEach((current) => {
    current.skuSoldCount = current.skuCodes.size;
    delete current.skuCodes;
  });

  return metrics;
}

async function loadInvoiceMetricsBySalesman(admin, reportDate) {
  const rows = await fetchPagedRows(
    admin,
    "active_sales",
    "id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,sales_amount,item_code",
    (query) => query.eq("transaction_date", reportDate),
  );
  const invoices = groupSalesRowsIntoInvoices(rows);
  const metrics = new Map();

  invoices.forEach((invoice) => {
    const code = String(invoice.salesman_code || "").trim().toUpperCase();
    if (!code) return;
    const current = metrics.get(code) || { count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(invoice.total_amount || 0);
    metrics.set(code, current);
  });

  return metrics;
}

async function loadLastActivityByUser(admin, userIds, reportDate, extras = new Map()) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const lastAt = new Map();

  extras.forEach((iso, userId) => {
    lastAt.set(userId, laterIso(lastAt.get(userId), iso));
  });

  for (const chunk of chunkList(ids, 100)) {
    const activities = await loadLoggedActivityTimesByUser(admin, chunk, startIso, endIso, reportDate);
    activities.forEach((rows, userId) => {
      (rows || []).forEach((row) => {
        lastAt.set(userId, laterIso(lastAt.get(userId), row.saved_at || row.savedAt));
      });
    });
  }

  return lastAt;
}

async function loadWorkdaysByUser(admin, userIds, lastActivityByUser, reportDate) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const eventsByUser = new Map();

  for (const chunk of chunkList(ids, 100)) {
    const part = await loadWorkdayEventsByUser(admin, chunk, startIso, endIso, reportDate);
    part.forEach((rows, userId) => eventsByUser.set(userId, rows));
  }

  const workdays = new Map();
  ids.forEach((userId) => {
    const times = extractWorkdayTimesFromTimelineRows(eventsByUser.get(userId) || []);
    const lastActivityAt = lastActivityByUser.get(userId) || "";
    const workingEndAt = resolveResumeWorkingEndAt({
      logoutAt: times.logoutAt,
      logoutAutoClosed: times.logoutAutoClosed,
      lastActivityAt,
    });
    workdays.set(userId, {
      ...times,
      lastActivityAt,
      workingMinutes: calculateWorkingHoursMinutes({
        ...times,
        logoutAt: workingEndAt,
      }),
    });
  });
  return workdays;
}

export function buildSalesmanResumeRows({
  profiles = [],
  visitCounts = new Map(),
  collectionCounts = new Map(),
  collectionMetrics = new Map(),
  orderMetrics = new Map(),
  invoiceMetrics = new Map(),
  workdays = new Map(),
} = {}) {
  const collectionsByUser = collectionMetrics.size
    ? collectionMetrics
    : new Map([...collectionCounts.entries()].map(([userId, count]) => [userId, { count, value: 0 }]));
  const byUserId = new Map();

  for (const profile of profiles || []) {
    ensureRow(byUserId, profile);
  }

  for (const [userId, visits] of visitCounts.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (row) row.visits = Number(visits || 0);
  }

  for (const [userId, collections] of collectionsByUser.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (!row) continue;
    row.collections = Number(collections?.count ?? collections ?? 0);
    row.collectionValue = Number(collections?.value || 0);
  }

  for (const [userId, metrics] of orderMetrics.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (!row) continue;
    row.orders = Number(metrics?.orders || 0);
    row.orderValue = Number(metrics?.orderValue || 0);
    row.skuSoldCount = Number(metrics?.skuSoldCount || 0);
  }

  const userIdByCode = new Map();
  byUserId.forEach((row) => {
    const code = String(row.salesmanCode || "").trim().toUpperCase();
    if (code && !userIdByCode.has(code)) userIdByCode.set(code, row.userId);
  });

  for (const [salesmanCode, invoice] of invoiceMetrics.entries()) {
    const code = String(salesmanCode || "").trim().toUpperCase();
    const userId = userIdByCode.get(code);
    const row = userId
      ? byUserId.get(userId)
      : ensureRow(byUserId, { id: `code:${code}`, salesman_code: code });
    if (!row) continue;
    row.invoiceCount = Number(invoice?.count || 0);
    row.invoiceAmount = Number(invoice?.amount || 0);
  }

  for (const [userId, workday] of workdays.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (!row || !workday) continue;
    row.loginAt = workday.loginAt || "";
    row.lunchOutAt = workday.lunchOutAt || "";
    row.lunchInAt = workday.lunchInAt || "";
    row.logoutAt = workday.logoutAt || "";
    row.logoutAutoClosed = Boolean(workday.logoutAutoClosed);
    row.lastActivityAt = workday.lastActivityAt || "";
    row.workingMinutes = workday.workingMinutes ?? calculateWorkingHoursMinutes({
      ...workday,
      logoutAt: resolveResumeWorkingEndAt({
        logoutAt: workday.logoutAt,
        logoutAutoClosed: workday.logoutAutoClosed,
        lastActivityAt: workday.lastActivityAt,
      }),
    });
  }

  return sortSalesmanResumeRows([...byUserId.values()].filter((row) => {
    if (!shouldIncludeSalesmanResumeRow(row)) return false;
    return Number(row.orders || 0)
      + Number(row.orderValue || 0)
      + Number(row.invoiceCount || 0)
      + Number(row.invoiceAmount || 0)
      + Number(row.collections || 0)
      + Number(row.collectionValue || 0)
      + Number(row.visits || 0)
      + Number(row.skuSoldCount || 0) > 0
      || SALESMAN_ROLES.has(normalizeRole(row.role));
  }));
}

export async function buildDailySalesmanResume(admin, { date, now = new Date() } = {}) {
  const reportDate = parseResumeDateParam(date, now);
  const [profiles, visitCounts, collectionMetrics, orderMetrics, invoiceMetrics] = await Promise.all([
    loadSalesmanResumeProfiles(admin),
    loadVisitCountsByUser(admin, reportDate),
    loadCollectionMetricsByUser(admin, reportDate),
    loadOrderMetricsByUser(admin, reportDate),
    loadInvoiceMetricsBySalesman(admin, reportDate),
  ]);

  const userIds = [
    ...new Set([
      ...profiles.map((profile) => profile.id),
      ...visitCounts.keys(),
      ...collectionMetrics.keys(),
      ...orderMetrics.keys(),
    ].filter(Boolean)),
  ];
  const extraLastActivity = new Map();
  collectionMetrics.forEach((metric, userId) => extraLastActivity.set(userId, laterIso(extraLastActivity.get(userId), metric.lastAt)));
  orderMetrics.forEach((metric, userId) => extraLastActivity.set(userId, laterIso(extraLastActivity.get(userId), metric.lastAt)));
  const lastActivityByUser = await loadLastActivityByUser(admin, userIds, reportDate, extraLastActivity);
  const workdays = await loadWorkdaysByUser(admin, userIds, lastActivityByUser, reportDate);

  const rows = buildSalesmanResumeRows({
    profiles,
    visitCounts,
    collectionMetrics,
    orderMetrics,
    invoiceMetrics,
    workdays,
  });

  return {
    date: reportDate,
    timezone: "Asia/Riyadh",
    rows,
  };
}

export async function runDailySalesmanResumeEmailCycle(admin, {
  date,
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadResume = buildDailySalesmanResume,
} = {}) {
  const reportDate = parseResumeDateParam(date, now);
  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      date: reportDate,
      skipped: true,
      reason: "email_not_configured",
      sentCount: 0,
    };
  }

  const to = resolveDailySalesmanResumeRecipients(env);
  if (!to.length) {
    return {
      date: reportDate,
      skipped: true,
      reason: "no_recipients",
      sentCount: 0,
    };
  }

  const resume = await loadResume(admin, { date: reportDate, now });
  const message = buildDailySalesmanResumeEmail({
    date: resume.date,
    rows: resume.rows,
  });

  try {
    const sent = await send({ ...message, to }, env);
    return {
      date: resume.date,
      skipped: false,
      sentCount: 1,
      failedCount: 0,
      to,
      provider: sent?.provider || null,
      rowCount: message.rowCount,
      totals: message.totals,
    };
  } catch (error) {
    return {
      date: resume.date,
      skipped: false,
      sentCount: 0,
      failedCount: 1,
      to,
      error: error.message || "Unable to send email",
      rowCount: message.rowCount,
      totals: message.totals,
    };
  }
}
