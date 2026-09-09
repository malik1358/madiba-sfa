import { fetchWithLocalCacheResilient, readCacheEntry, writeCacheEntry } from "./localDataStore.js";

export const STOCK_TAKE_ITEMS_KEY = "stockTakeItems:v1";
export const STOCK_TAKE_ITEMS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const STOCK_TAKE_SESSIONS_TTL_MS = 24 * 60 * 60 * 1000;
export const STOCK_TAKE_LINES_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function stockTakeSessionsKey(userId) {
  return `stockTakeSessions:v1:${String(userId || "local").trim()}`;
}

export function stockTakeLinesKey(sessionId) {
  return `stockTakeLines:v1:${String(sessionId || "").trim()}`;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || "Unable to load stock take data.");
  }
  return payload;
}

export async function fetchStockTakeItemsCached({ headers, onUpdate } = {}) {
  return fetchWithLocalCacheResilient(
    STOCK_TAKE_ITEMS_KEY,
    STOCK_TAKE_ITEMS_TTL_MS,
    async () => {
      const payload = await fetchJson("/api/stock-take?action=master", headers);
      return payload.items || [];
    },
    { onUpdate },
  );
}

export async function fetchStockTakeSessionsCached({ headers, userId, onUpdate } = {}) {
  return fetchWithLocalCacheResilient(
    stockTakeSessionsKey(userId),
    STOCK_TAKE_SESSIONS_TTL_MS,
    async () => {
      const payload = await fetchJson("/api/stock-take?action=open-sessions", headers);
      return {
        sessions: payload.sessions || [],
        shareUsers: payload.shareUsers || [],
        sharesAvailable: payload.sharesAvailable !== false,
      };
    },
    { onUpdate },
  );
}

export async function fetchStockTakeLinesCached({ headers, sessionId, onUpdate } = {}) {
  if (!sessionId) return { data: [], fromCache: false, offline: false };
  return fetchWithLocalCacheResilient(
    stockTakeLinesKey(sessionId),
    STOCK_TAKE_LINES_TTL_MS,
    async () => {
      const payload = await fetchJson(
        `/api/stock-take?action=session-lines&sessionId=${encodeURIComponent(sessionId)}`,
        headers,
      );
      return payload.lines || [];
    },
    { onUpdate },
  );
}

export async function writeStockTakeSessionsCache(userId, value) {
  await writeCacheEntry(stockTakeSessionsKey(userId), value, { ttlMs: STOCK_TAKE_SESSIONS_TTL_MS });
}

export async function writeStockTakeLinesCache(sessionId, lines) {
  if (!sessionId) return;
  await writeCacheEntry(stockTakeLinesKey(sessionId), lines || [], { ttlMs: STOCK_TAKE_LINES_TTL_MS });
}

export async function readStockTakeItemsCache() {
  const cached = await readCacheEntry(STOCK_TAKE_ITEMS_KEY);
  return cached?.value || [];
}
