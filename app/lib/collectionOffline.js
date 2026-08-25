import { getKsaDateString } from "./workdayActivity.js";
import { readCacheEntry, writeCacheEntry } from "./localDataStore.js";

function visitCountCacheKey(userId, dateKey = getKsaDateString()) {
  return `collectionVisitCount:v1:${String(userId || "").trim()}:${dateKey}`;
}

export async function readLocalCollectionVisitCount(userId, dateKey = getKsaDateString()) {
  if (!userId) return 0;
  const entry = await readCacheEntry(visitCountCacheKey(userId, dateKey));
  return Number(entry?.value || 0);
}

export async function incrementLocalCollectionVisitCount(userId, dateKey = getKsaDateString()) {
  const next = (await readLocalCollectionVisitCount(userId, dateKey)) + 1;
  await writeCacheEntry(visitCountCacheKey(userId, dateKey), next, {
    ttlMs: 48 * 60 * 60 * 1000,
  });
  return next;
}

export async function resolveCollectionVisitNumberForDay(userId, options = {}) {
  const cachedCount = Number(options.cachedServerCount || 0);
  const localCount = await readLocalCollectionVisitCount(userId);
  const pendingQueued = Number(options.pendingQueuedCount || 0);
  return Math.max(cachedCount, localCount, pendingQueued) + 1;
}

export function buildOptimisticLatestCollection(row, {
  visitOutcome,
  paymentStatus,
  amountReceived,
  nextVisitAt,
  remarkArabic,
  remarkEnglish,
  summaryText,
}) {
  return {
    ...(row?.latest_collection || {}),
    saved_at: new Date().toISOString(),
    visit_outcome: visitOutcome,
    payment_status: paymentStatus,
    amount_received: Number(amountReceived || 0),
    next_visit_at: nextVisitAt || null,
    remark_arabic: remarkArabic || "",
    remark_english: remarkEnglish || "",
    summary_text: summaryText || "",
    pending_sync: true,
  };
}

export function mergeOptimisticCollectionRow(row, latestCollection) {
  if (!row || !latestCollection) return row;
  return {
    ...row,
    latest_collection: latestCollection,
    collection_history: [
      latestCollection,
      ...(Array.isArray(row.collection_history) ? row.collection_history : []),
    ].slice(0, 10),
  };
}

export function patchCollectionQueuesWithOptimisticVisit(queues, customerCode, latestCollection) {
  const code = String(customerCode || "").trim().toUpperCase();
  if (!code || !latestCollection) return queues;

  const patchRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
    if (String(row.customer_code || "").trim().toUpperCase() !== code) return row;
    return mergeOptimisticCollectionRow(row, latestCollection);
  });

  return {
    dueCustomers: patchRows(queues.dueCustomers),
    notDueCustomers: patchRows(queues.notDueCustomers),
    legalCustomers: patchRows(queues.legalCustomers),
  };
}
