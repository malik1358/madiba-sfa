import { listOfflineQueue } from "./offlineSyncQueue.js";
import { readCacheEntry, writeCacheEntry } from "./localDataStore.js";
import {
  formatSalesmanOrderNumber,
  isSalesmanOrderNumberForCode,
  maxSequenceFromOrderNumbers,
  nextSalesmanOrderSequence,
  normalizeSalesmanLetters,
  parseSalesmanOrderNumber,
  resolveSalesmanOrderPrefix,
} from "./salesmanOrderNumber.js";
import { isSalesOrderQueueItem } from "./queuedSalesOrders.js";

const SEQ_CACHE_PREFIX = "salesOrderSeq:v2:";
const PREFIX_CACHE_PREFIX = "salesOrderPrefix:v2:";
const PEERS_CACHE_KEY = "salesOrderPeers:v1";
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function seqCacheKey(prefix) {
  const key = String(prefix || "").trim().toUpperCase();
  return key ? `${SEQ_CACHE_PREFIX}${key}` : "";
}

function prefixCacheKey(salesmanCode) {
  const letters = normalizeSalesmanLetters(salesmanCode);
  return letters ? `${PREFIX_CACHE_PREFIX}${letters}` : "";
}

export async function rememberSalesmanOrderPeers(peerCodes = []) {
  const peers = [...new Set(
    (Array.isArray(peerCodes) ? peerCodes : [])
      .map((code) => String(code || "").trim())
      .filter(Boolean),
  )];
  if (peers.length === 0) return [];
  await writeCacheEntry(PEERS_CACHE_KEY, peers, { ttlMs: CACHE_TTL_MS });
  return peers;
}

export async function readSalesmanOrderPeers(fallbackPeers = []) {
  try {
    const entry = await readCacheEntry(PEERS_CACHE_KEY);
    const cached = Array.isArray(entry?.value) ? entry.value : [];
    if (cached.length > 0) return cached;
  } catch {
    // Fall through to fallback.
  }
  return Array.isArray(fallbackPeers) ? fallbackPeers : [];
}

async function readStoredPrefix(salesmanCode) {
  const key = prefixCacheKey(salesmanCode);
  if (!key) return "";
  const entry = await readCacheEntry(key);
  return String(entry?.value || "").trim().toUpperCase();
}

async function writeStoredPrefix(salesmanCode, prefix) {
  const key = prefixCacheKey(salesmanCode);
  const value = String(prefix || "").trim().toUpperCase();
  if (!key || !value) return "";
  await writeCacheEntry(key, value, { ttlMs: CACHE_TTL_MS });
  return value;
}

async function readLocalMaxSequence(prefix) {
  const key = seqCacheKey(prefix);
  if (!key) return 0;
  const entry = await readCacheEntry(key);
  const value = Number(entry?.value || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export async function rememberSalesmanOrderSequence(salesmanCode, sequenceOrOrderNumber, {
  peerCodes = [],
} = {}) {
  const parsed = parseSalesmanOrderNumber(sequenceOrOrderNumber);
  let prefix = parsed?.prefix || "";
  let sequence = parsed?.sequence;

  if (!prefix) {
    prefix = (await readStoredPrefix(salesmanCode))
      || resolveSalesmanOrderPrefix(salesmanCode, peerCodes);
    sequence = Number(sequenceOrOrderNumber);
  }

  if (!prefix || !Number.isFinite(sequence) || sequence < 1) {
    return readLocalMaxSequence(prefix);
  }

  if (isSalesmanOrderNumberForCode(`${prefix}${sequence}`, salesmanCode)
    || isSalesmanOrderNumberForCode(sequenceOrOrderNumber, salesmanCode)) {
    await writeStoredPrefix(salesmanCode, prefix);
  }

  const current = await readLocalMaxSequence(prefix);
  const nextMax = Math.max(current, Math.floor(sequence));
  await writeCacheEntry(seqCacheKey(prefix), nextMax, { ttlMs: CACHE_TTL_MS });
  return nextMax;
}

async function maxSequenceFromPendingQueue(salesmanCode, peerCodes, prefix) {
  try {
    const [pending, failed] = await Promise.all([
      listOfflineQueue("pending"),
      listOfflineQueue("failed"),
    ]);
    const numbers = [...pending, ...failed]
      .filter(isSalesOrderQueueItem)
      .map((item) => item?.jsonBody?.orderNumber || item?.metadata?.orderNumber || "")
      .filter(Boolean);
    if (prefix) {
      let max = 0;
      numbers.forEach((value) => {
        const parsed = parseSalesmanOrderNumber(value);
        if (!parsed || parsed.prefix !== prefix) return;
        if (parsed.sequence > max) max = parsed.sequence;
      });
      return max;
    }
    return maxSequenceFromOrderNumbers(numbers, salesmanCode, peerCodes);
  } catch {
    return 0;
  }
}

/**
 * Allot the next permanent salesman order number on this device (e.g. P01).
 * The same value is sent to the server on sync and must not be rewritten.
 */
export async function allocateLocalSalesOrderNumber(salesmanCode, {
  existingOrderNumber = "",
  peerCodes = [],
} = {}) {
  const existing = String(existingOrderNumber || "").trim();
  if (existing && isSalesmanOrderNumberForCode(existing, salesmanCode)) {
    await rememberSalesmanOrderSequence(salesmanCode, existing, { peerCodes });
    return existing;
  }

  const letters = normalizeSalesmanLetters(salesmanCode);
  if (!letters) {
    throw new Error("Salesman code is required to allot an order number offline.");
  }

  const peers = await readSalesmanOrderPeers(peerCodes);
  if (Array.isArray(peerCodes) && peerCodes.length > 0) {
    void rememberSalesmanOrderPeers([...peers, ...peerCodes, salesmanCode]);
  }

  let prefix = await readStoredPrefix(salesmanCode);
  if (!prefix) {
    prefix = resolveSalesmanOrderPrefix(salesmanCode, peers.length ? peers : peerCodes);
    await writeStoredPrefix(salesmanCode, prefix);
  }

  const [localMax, queuedMax] = await Promise.all([
    readLocalMaxSequence(prefix),
    maxSequenceFromPendingQueue(salesmanCode, peers, prefix),
  ]);
  const sequence = nextSalesmanOrderSequence(Math.max(localMax, queuedMax));
  const orderNumber = formatSalesmanOrderNumber(salesmanCode, sequence, { prefix });
  await rememberSalesmanOrderSequence(salesmanCode, orderNumber, { peerCodes: peers });
  return orderNumber;
}
