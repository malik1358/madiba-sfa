import { sumOrderLineValue } from "./collectionDaySummary.js";
import { buildVisitDaySplit } from "./dailyVisitReportStats.js";
import { todayAttendanceBounds } from "./morningAttendance.js";
import {
  timelineRowFromActivityLog,
  timelineRowFromCollectionVisit,
} from "./visitDistanceWhatsapp.js";

export const DAY_ACTIVITY_WHATSAPP_TIMEOUT_MS = 8000;

export const DAY_ACTIVITY_WHATSAPP_LABELS = {
  visitsWithOrder: "Visits with order",
  visitsWithoutOrder: "Visits without order",
  collections: "Collections",
};

export const DAY_ACTIVITY_WHATSAPP_LABELS_AR = {
  visitsWithOrder: "زيارات مع طلب",
  visitsWithoutOrder: "زيارات بدون طلب",
  collections: "التحصيلات",
};

const ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "ORDER_SUBMITTED",
  "PROSPECT_FOLLOW_UP",
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function entryType(entry) {
  return String(
    entry?.transactionType
    || entry?.transaction_type
    || entry?.entryType
    || entry?.entry_type
    || entry?.type
    || "",
  ).trim().toUpperCase();
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseActivityNote(note) {
  if (!note) return null;
  if (typeof note === "object") return note;
  try {
    return JSON.parse(note);
  } catch {
    return null;
  }
}

function rowTimestamp(row) {
  const ts = Date.parse(row?.savedAt || row?.saved_at || "");
  return Number.isFinite(ts) ? ts : 0;
}

function emptyOrderStats() {
  return {
    orderCount: 0,
    orderValue: 0,
    newCustomerOrderCount: 0,
    newCustomerOrderValue: 0,
    repeatCustomerOrderCount: 0,
    repeatCustomerOrderValue: 0,
  };
}

function emptyDayActivity() {
  return {
    known: true,
    visitWithoutOrderCount: 0,
    orderCount: 0,
    orderValue: 0,
    collectionCount: 0,
    collectionValue: 0,
  };
}

/**
 * Normalize timeline rows into the shapes `buildVisitDaySplit` expects.
 * Prospect follow-ups count as visit-without-order rows (Daily Visit Report).
 */
export function normalizeDayActivityEntry(entry) {
  if (!entry) return null;
  const type = entryType(entry);
  if (!type) return null;

  const mappedType = type === "PROSPECT_FOLLOW_UP" ? "VISIT_REPORT" : type;
  if (
    mappedType !== "VISIT_REPORT"
    && mappedType !== "ORDER_SUBMITTED"
    && mappedType !== "COLLECTION_VISIT"
  ) {
    return null;
  }

  const parsed = parseActivityNote(entry?.note) || {};
  return {
    transactionType: mappedType,
    customerCode: normalizeCode(
      entry?.customerCode
      || entry?.customer_code
      || parsed.customer_code
      || parsed.customerCode
      || "",
    ),
    amountReceived: Number(
      entry?.amountReceived
      ?? entry?.amount_received
      ?? parsed.amount_received
      ?? parsed.amountReceived
      ?? 0,
    ),
    visitOutcome: String(
      entry?.visitOutcome
      || entry?.visit_outcome
      || parsed.visit_outcome
      || parsed.visitOutcome
      || "",
    ).trim(),
    savedAt: entry?.savedAt || entry?.saved_at || parsed.captured_at || parsed.capturedAt || "",
    orderValue: Number(entry?.orderValue ?? entry?.order_value ?? parsed.order_value ?? 0),
  };
}

function mergeCurrentOrderStats(orderStats = emptyOrderStats(), currentEntry = null) {
  const normalized = normalizeDayActivityEntry(currentEntry);
  if (!normalized || normalized.transactionType !== "ORDER_SUBMITTED") {
    return {
      orderCount: Number(orderStats.orderCount || 0),
      orderValue: Number(orderStats.orderValue || 0),
      newCustomerOrderCount: Number(orderStats.newCustomerOrderCount || 0),
      newCustomerOrderValue: Number(orderStats.newCustomerOrderValue || 0),
      repeatCustomerOrderCount: Number(orderStats.repeatCustomerOrderCount || 0),
      repeatCustomerOrderValue: Number(orderStats.repeatCustomerOrderValue || 0),
    };
  }

  const value = Number(normalized.orderValue || 0);
  const nextCount = Number(orderStats.orderCount || 0) + 1;
  const nextValue = Number(orderStats.orderValue || 0) + (Number.isFinite(value) ? value : 0);
  return {
    orderCount: nextCount,
    orderValue: nextValue,
    // Keep new/repeat blank so buildVisitDaySplit falls back to posted totals.
    newCustomerOrderCount: 0,
    newCustomerOrderValue: 0,
    repeatCustomerOrderCount: 0,
    repeatCustomerOrderValue: 0,
  };
}

function sameDayActivityEntry(left, right) {
  if (!left || !right) return false;
  if (entryType(left) !== entryType(right)) return false;
  if (normalizeCode(left.customerCode || left.customer_code)
    !== normalizeCode(right.customerCode || right.customer_code)) {
    return false;
  }
  const leftTs = rowTimestamp(left);
  const rightTs = rowTimestamp(right);
  if (!leftTs || !rightTs) return false;
  return Math.abs(leftTs - rightTs) <= 120000;
}

/**
 * Running day totals for WhatsApp: visits with order (+ value), visits without
 * order, and successful collections (+ value). Matches Daily Visit Report counts.
 */
export function resolveDayActivityTillMessage({
  entries = [],
  orderStats = null,
  untilAt = "",
  currentEntry = null,
} = {}) {
  const cutoffTs = Date.parse(String(untilAt || ""));
  const cutoff = Number.isFinite(cutoffTs) ? cutoffTs : Date.now();

  const prior = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeDayActivityEntry(entry))
    .filter((entry) => {
      if (!entry) return false;
      const ts = rowTimestamp(entry);
      return !ts || ts <= cutoff;
    });

  const current = normalizeDayActivityEntry(currentEntry);
  let currentAdded = false;
  if (current) {
    const currentTs = rowTimestamp(current) || cutoff;
    if (currentTs <= cutoff + 1000 && !prior.some((entry) => sameDayActivityEntry(entry, current))) {
      prior.push({
        ...current,
        savedAt: current.savedAt || new Date(cutoff).toISOString(),
      });
      currentAdded = true;
    }
  }

  // Only bump posted order totals when this share's order is not already in DB.
  const splitOrderStats = currentAdded
    ? mergeCurrentOrderStats(orderStats || emptyOrderStats(), current)
    : {
      orderCount: Number(orderStats?.orderCount || 0),
      orderValue: Number(orderStats?.orderValue || 0),
      newCustomerOrderCount: Number(orderStats?.newCustomerOrderCount || 0),
      newCustomerOrderValue: Number(orderStats?.newCustomerOrderValue || 0),
      repeatCustomerOrderCount: Number(orderStats?.repeatCustomerOrderCount || 0),
      repeatCustomerOrderValue: Number(orderStats?.repeatCustomerOrderValue || 0),
    };

  const split = buildVisitDaySplit(prior, splitOrderStats);
  return {
    known: true,
    visitWithoutOrderCount: Number(split.visitWithoutOrderCount || 0),
    orderCount: Number(split.orderCount || 0),
    orderValue: Number(split.orderValue || 0),
    collectionCount: Number(split.collectionCount || 0),
    collectionValue: Number(split.collectionValue || 0),
  };
}

/**
 * Format trailing WhatsApp lines for today's visit/order/collection counts.
 * Pads with a blank line before and after so the block stands out.
 * Omit the block when stats were not loaded (null); unknown loads still show "-".
 */
export function formatDayActivityWhatsappLines(stats = null, labels = {}) {
  if (stats == null) return [];

  const resolvedLabels = { ...DAY_ACTIVITY_WHATSAPP_LABELS, ...labels };
  if (stats.known === false) {
    return [
      "",
      `${resolvedLabels.visitsWithOrder}: -`,
      `${resolvedLabels.visitsWithoutOrder}: -`,
      `${resolvedLabels.collections}: -`,
      "",
    ];
  }

  return [
    "",
    `${resolvedLabels.visitsWithOrder}: ${Number(stats.orderCount || 0)} / ${formatMoney(stats.orderValue)} ﷼`,
    `${resolvedLabels.visitsWithoutOrder}: ${Number(stats.visitWithoutOrderCount || 0)}`,
    `${resolvedLabels.collections}: ${Number(stats.collectionCount || 0)} / ${formatMoney(stats.collectionValue)} ﷼`,
    "",
  ];
}

export function buildCurrentDayActivityEntry({
  transactionType = "VISIT_REPORT",
  savedAt = "",
  customerCode = "",
  customer = {},
  amountReceived = 0,
  visitOutcome = "",
  orderValue = 0,
} = {}) {
  return {
    savedAt: savedAt || new Date().toISOString(),
    transactionType: String(transactionType || "VISIT_REPORT").trim().toUpperCase(),
    customerCode: customerCode || customer?.customer_code || "",
    amountReceived: Number(amountReceived || 0),
    visitOutcome: String(visitOutcome || "").trim(),
    orderValue: Number(orderValue || 0),
  };
}

async function loadTodaySubmittedOrderStats(supabase, userId) {
  if (!supabase || !userId) return emptyOrderStats();
  const { startIso, endIso } = todayAttendanceBounds();

  try {
    let query = supabase
      .from("sales_orders")
      .select("id,customer_code,status,submitted_at,created_at")
      .eq("created_by", userId)
      .eq("status", "SUBMITTED")
      .gte("submitted_at", startIso)
      .lte("submitted_at", endIso);

    let { data, error } = await query;
    if (error) {
      ({ data, error } = await supabase
        .from("sales_orders")
        .select("id,customer_code,status,created_at")
        .eq("created_by", userId)
        .eq("status", "SUBMITTED")
        .gte("created_at", startIso)
        .lte("created_at", endIso));
    }
    if (error || !Array.isArray(data) || !data.length) {
      return emptyOrderStats();
    }

    const orderIds = [...new Set(data.map((row) => Number(row?.id)).filter(Boolean))];
    if (!orderIds.length) return emptyOrderStats();

    const { data: lines, error: lineError } = await supabase
      .from("sales_order_items")
      .select("order_id,line_value,quantity,rate")
      .in("order_id", orderIds);
    if (lineError) {
      return { ...emptyOrderStats(), orderCount: orderIds.length };
    }

    return {
      ...emptyOrderStats(),
      orderCount: orderIds.length,
      orderValue: sumOrderLineValue(lines),
    };
  } catch {
    return emptyOrderStats();
  }
}

export async function loadTodayDayActivityEntries(supabase, userId) {
  if (!supabase || !userId) return { entries: [], orderStats: emptyOrderStats() };

  const { startIso, endIso } = todayAttendanceBounds();
  const entries = [];

  const [activityResult, collectionResult, orderStats] = await Promise.all([
    (async () => {
      try {
        return await supabase
          .from("daily_activity_logs")
          .select("id,user_id,entry_type,note,created_at")
          .eq("user_id", userId)
          .in("entry_type", ACTIVITY_ENTRY_TYPES)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true })
          .limit(400);
      } catch {
        return { data: null, error: true };
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from("collection_visits")
          .select("id,saved_at,latitude,longitude,created_by,customer_code,amount_received,visit_outcome")
          .eq("created_by", userId)
          .gte("saved_at", startIso)
          .lte("saved_at", endIso)
          .order("saved_at", { ascending: true })
          .limit(200);
      } catch {
        return { data: null, error: true };
      }
    })(),
    loadTodaySubmittedOrderStats(supabase, userId),
  ]);

  if (!activityResult?.error && activityResult?.data) {
    activityResult.data.forEach((row) => {
      const base = timelineRowFromActivityLog(row);
      const parsed = parseActivityNote(row?.note) || {};
      entries.push({
        ...base,
        customerCode: parsed.customer_code || parsed.customerCode || "",
        amountReceived: parsed.amount_received ?? parsed.amountReceived ?? 0,
        visitOutcome: parsed.visit_outcome || parsed.visitOutcome || "",
        transactionType: base.transactionType,
      });
    });
  }

  if (!collectionResult?.error && collectionResult?.data) {
    collectionResult.data.forEach((row) => {
      entries.push({
        ...timelineRowFromCollectionVisit(row),
        customerCode: row.customer_code,
        amountReceived: row.amount_received,
        visitOutcome: row.visit_outcome,
      });
    });
  }

  entries.sort((left, right) => rowTimestamp(left) - rowTimestamp(right));
  return { entries, orderStats };
}

/**
 * Load today's visit/order/collection totals up to the WhatsApp message.
 * Soft-timeout / offline still includes currentEntry so queueFirst shares show
 * at least this stop instead of dashes.
 */
export async function loadDayActivityTillMessage({
  supabase,
  userId,
  savedAt = "",
  currentEntry = null,
  skipTimeline = false,
  timelineTimeoutMs = DAY_ACTIVITY_WHATSAPP_TIMEOUT_MS,
  localEntries = null,
  localOrderStats = null,
} = {}) {
  const capturedAt = savedAt || new Date().toISOString();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  let entries = Array.isArray(localEntries) ? localEntries : null;
  let orderStats = localOrderStats && typeof localOrderStats === "object"
    ? localOrderStats
    : null;

  if (!offline && (!skipTimeline || timelineTimeoutMs > 0)) {
    try {
      const timelinePromise = loadTodayDayActivityEntries(supabase, userId);
      if (timelineTimeoutMs > 0) {
        const loaded = await Promise.race([
          timelinePromise.then((payload) => ({ ok: true, payload })),
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, payload: null }), timelineTimeoutMs);
          }),
        ]);
        if (loaded.ok && loaded.payload) {
          entries = loaded.payload.entries;
          orderStats = loaded.payload.orderStats;
        } else {
          entries = entries || [];
          orderStats = orderStats || emptyOrderStats();
        }
      } else {
        const payload = await timelinePromise;
        entries = payload.entries;
        orderStats = payload.orderStats;
      }
    } catch {
      entries = entries || [];
      orderStats = orderStats || emptyOrderStats();
    }
  }

  if (!entries) entries = [];
  if (!orderStats) orderStats = emptyOrderStats();

  return resolveDayActivityTillMessage({
    entries,
    orderStats,
    untilAt: capturedAt,
    currentEntry,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dayActivityBlockPattern(labels = DAY_ACTIVITY_WHATSAPP_LABELS) {
  const withOrder = escapeRegExp(labels.visitsWithOrder || DAY_ACTIVITY_WHATSAPP_LABELS.visitsWithOrder);
  const withoutOrder = escapeRegExp(
    labels.visitsWithoutOrder || DAY_ACTIVITY_WHATSAPP_LABELS.visitsWithoutOrder,
  );
  const collections = escapeRegExp(labels.collections || DAY_ACTIVITY_WHATSAPP_LABELS.collections);
  return new RegExp(
    `(?:\\n\\n|\\n)?^${withOrder}:\\s*.+$\\n^${withoutOrder}:\\s*.+$\\n^${collections}:\\s*.+(?:\\n\\n|\\n)?`,
    "m",
  );
}

export function patchWhatsappSummaryDayActivity(
  summary,
  stats = null,
  labels = DAY_ACTIVITY_WHATSAPP_LABELS,
) {
  const text = String(summary || "");
  if (!text) return text;

  const lines = formatDayActivityWhatsappLines(stats, labels);
  if (!lines.length) return text;
  const block = `\n${lines.join("\n").trim()}\n`;
  const spacedBlock = `\n\n${lines.filter((line) => String(line || "").trim()).join("\n")}\n\n`;

  const labelSets = [
    labels,
    DAY_ACTIVITY_WHATSAPP_LABELS,
    DAY_ACTIVITY_WHATSAPP_LABELS_AR,
  ];
  for (const labelSet of labelSets) {
    const pattern = dayActivityBlockPattern(labelSet);
    if (pattern.test(text)) {
      return text.replace(pattern, spacedBlock).replace(/\n{3,}/g, "\n\n").trimEnd();
    }
  }

  return `${text.trimEnd()}${block}`.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export { emptyDayActivity, emptyOrderStats };
