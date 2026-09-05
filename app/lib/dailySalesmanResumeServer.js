import {
  buildDailySalesmanResumeEmail,
  emptySalesmanResumeRow,
  resolveDailySalesmanResumeRecipients,
  sortSalesmanResumeRows,
} from "./dailySalesmanResume.js";
import { formatCollectorDisplayName } from "./geo.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
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

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
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
      throw error;
    }
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function loadSalesmanResumeProfiles(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,is_active")
    .eq("is_active", true);

  if (error) throw error;

  return (data || []).filter((row) => SALESMAN_ROLES.has(normalizeRole(row.role)));
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

async function loadCollectionCountsByUser(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const rows = await fetchPagedRows(
    admin,
    "collection_visits",
    "id,created_by,saved_at",
    (query) => query.gte("saved_at", startIso).lte("saved_at", endIso),
  );

  const counts = new Map();
  for (const row of rows) {
    const userId = String(row.created_by || "").trim();
    if (!userId) continue;
    counts.set(userId, (counts.get(userId) || 0) + 1);
  }
  return counts;
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
    const current = metrics.get(userId) || { orders: 0, skuSoldCount: 0 };
    current.orders += 1;
    const quantity = Number(row.total_quantity);
    const items = Number(row.total_items);
    if (Number.isFinite(quantity) && quantity > 0) {
      current.skuSoldCount += quantity;
    } else if (Number.isFinite(items) && items > 0) {
      current.skuSoldCount += items;
    }
    metrics.set(userId, current);
  }

  return metrics;
}

export function buildSalesmanResumeRows({
  profiles = [],
  visitCounts = new Map(),
  collectionCounts = new Map(),
  orderMetrics = new Map(),
} = {}) {
  const byUserId = new Map();

  for (const profile of profiles || []) {
    ensureRow(byUserId, profile);
  }

  for (const [userId, visits] of visitCounts.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (row) row.visits = Number(visits || 0);
  }

  for (const [userId, collections] of collectionCounts.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (row) row.collections = Number(collections || 0);
  }

  for (const [userId, metrics] of orderMetrics.entries()) {
    const row = ensureRow(byUserId, { id: userId });
    if (!row) continue;
    row.orders = Number(metrics?.orders || 0);
    row.skuSoldCount = Number(metrics?.skuSoldCount || 0);
  }

  return sortSalesmanResumeRows([...byUserId.values()].filter((row) => (
    Number(row.orders || 0)
    + Number(row.collections || 0)
    + Number(row.visits || 0)
    + Number(row.skuSoldCount || 0) > 0
    || SALESMAN_ROLES.has(normalizeRole(row.role))
  )));
}

export async function buildDailySalesmanResume(admin, { date, now = new Date() } = {}) {
  const reportDate = parseResumeDateParam(date, now);
  const [profiles, visitCounts, collectionCounts, orderMetrics] = await Promise.all([
    loadSalesmanResumeProfiles(admin),
    loadVisitCountsByUser(admin, reportDate),
    loadCollectionCountsByUser(admin, reportDate),
    loadOrderMetricsByUser(admin, reportDate),
  ]);

  const rows = buildSalesmanResumeRows({
    profiles,
    visitCounts,
    collectionCounts,
    orderMetrics,
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
