import { listOfflineQueue } from "./offlineSyncQueue.js";
import { readCacheEntry, writeCacheEntry } from "./localDataStore.js";
import {
  formatSalesmanOrderNumber,
  isSalesmanOrderNumberForCode,
  maxSequenceFromOrderNumbers,
  nextSalesmanOrderSequence,
  normalizeSalesmanOrderPrefix,
  parseSalesmanOrderNumber,
} from "./salesmanOrderNumber.js";
import { isSalesOrderQueueItem } from "./queuedSalesOrders.js";

const SEQ_CACHE_PREFIX = "salesOrderSeq:v1:";
const SEQ_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function seqCacheKey(salesmanCode) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  return prefix ? `${SEQ_CACHE_PREFIX}${prefix}` : "";
}

async function readLocalMaxSequence(salesmanCode) {
  const key = seqCacheKey(salesmanCode);
  if (!key) return 0;
  const entry = await readCacheEntry(key);
  const value = Number(entry?.value || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export async function rememberSalesmanOrderSequence(salesmanCode, sequenceOrOrderNumber) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  if (!prefix) return 0;

  let sequence = Number(sequenceOrOrderNumber);
  if (!Number.isFinite(sequence) || sequence < 1) {
    const parsed = parseSalesmanOrderNumber(sequenceOrOrderNumber);
    if (!parsed || parsed.prefix !== prefix) return await readLocalMaxSequence(salesmanCode);
    sequence = parsed.sequence;
  }

  const current = await readLocalMaxSequence(salesmanCode);
  const nextMax = Math.max(current, Math.floor(sequence));
  await writeCacheEntry(seqCacheKey(salesmanCode), nextMax, { ttlMs: SEQ_TTL_MS });
  return nextMax;
}

async function maxSequenceFromPendingQueue(salesmanCode) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  if (!prefix) return 0;
  try {
    const [pending, failed] = await Promise.all([
      listOfflineQueue("pending"),
      listOfflineQueue("failed"),
    ]);
    const numbers = [...pending, ...failed]
      .filter(isSalesOrderQueueItem)
      .map((item) => item?.jsonBody?.orderNumber || item?.metadata?.orderNumber || "")
      .filter(Boolean);
    return maxSequenceFromOrderNumbers(numbers, salesmanCode);
  } catch {
    return 0;
  }
}

/**
 * Allot the next permanent salesman order number on this device.
 * The same value is sent to the server on sync and must not be rewritten.
 */
export async function allocateLocalSalesOrderNumber(salesmanCode, {
  existingOrderNumber = "",
} = {}) {
  const existing = String(existingOrderNumber || "").trim();
  if (existing && isSalesmanOrderNumberForCode(existing, salesmanCode)) {
    await rememberSalesmanOrderSequence(salesmanCode, existing);
    return existing;
  }

  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  if (!prefix) {
    throw new Error("Salesman code is required to allot an order number offline.");
  }

  const [localMax, queuedMax] = await Promise.all([
    readLocalMaxSequence(salesmanCode),
    maxSequenceFromPendingQueue(salesmanCode),
  ]);
  const sequence = nextSalesmanOrderSequence(Math.max(localMax, queuedMax));
  const orderNumber = formatSalesmanOrderNumber(salesmanCode, sequence);
  await rememberSalesmanOrderSequence(salesmanCode, sequence);
  return orderNumber;
}
