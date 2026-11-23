/** In-process TTL cache for sales-scope resolution (warm serverless instances). */
export const SALES_SCOPE_RESOLVE_CACHE_TTL_MS = 60_000;

const scopeCache = new Map();
const scopeInFlight = new Map();

export function clearSalesScopeResolveCache() {
  scopeCache.clear();
  scopeInFlight.clear();
}

export async function withSalesScopeResolveCache(userId, loader, ttlMs = SALES_SCOPE_RESOLVE_CACHE_TTL_MS) {
  const key = String(userId || "").trim();
  if (!key || typeof loader !== "function") {
    return loader();
  }

  const now = Date.now();
  const hit = scopeCache.get(key);
  if (hit && now - Number(hit.at || 0) < ttlMs) {
    return hit.value;
  }

  const pending = scopeInFlight.get(key);
  if (pending) return pending;

  const task = Promise.resolve()
    .then(loader)
    .then((value) => {
      scopeCache.set(key, { at: Date.now(), value });
      scopeInFlight.delete(key);
      return value;
    })
    .catch((error) => {
      scopeInFlight.delete(key);
      throw error;
    });

  scopeInFlight.set(key, task);
  return task;
}
