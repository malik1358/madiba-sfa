const DB_NAME = "madiba-sfa-local";
const DB_VERSION = 1;
const STORE_NAME = "cache_entries";
const LOCAL_STORAGE_PREFIX = "madiba.cache.";

let dbPromise = null;

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
    });
  }

  return dbPromise;
}

async function readFromIndexedDb(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function writeToIndexedDb(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(entry);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(true);
  });
}

async function removeFromIndexedDb(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(true);
  });
}

function readFromLocalStorage(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeToLocalStorage(key, entry) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

function removeFromLocalStorage(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${key}`);
  } catch {
    // Ignore storage failures.
  }
}

export function isCacheEntryFresh(entry, ttlMs, now = Date.now()) {
  if (!entry || entry.expiresAt === undefined || entry.expiresAt === null) return false;
  return Number(entry.expiresAt) > now;
}

export async function readCacheEntry(key) {
  if (!key) return null;

  try {
    const indexedEntry = await readFromIndexedDb(key);
    if (indexedEntry) return indexedEntry;
  } catch {
    // Fall back to localStorage below.
  }

  return readFromLocalStorage(key);
}

export async function writeCacheEntry(key, value, options = {}) {
  if (!key) return false;

  const savedAt = Number(options.savedAt || Date.now());
  const ttlMs = Number(options.ttlMs || 0);
  const entry = {
    key,
    value,
    savedAt,
    expiresAt: ttlMs > 0 ? savedAt + ttlMs : null,
    version: Number(options.version || 1),
  };

  try {
    await writeToIndexedDb(entry);
    return true;
  } catch {
    return writeToLocalStorage(key, entry);
  }
}

export async function removeCacheEntry(key) {
  if (!key) return;

  try {
    await removeFromIndexedDb(key);
  } catch {
    // Ignore IndexedDB delete failures.
  }

  removeFromLocalStorage(key);
}

export async function fetchWithLocalCache(key, ttlMs, fetcher, options = {}) {
  const cached = await readCacheEntry(key);
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
  const allowStale = options.allowStale !== false;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline) {
    if (cached?.value !== undefined) {
      return {
        data: cached.value,
        fromCache: true,
        stale: true,
        offline: true,
      };
    }

    throw new Error("You are offline and this data is not available on the device yet.");
  }

  if (cached && isCacheEntryFresh(cached, ttlMs)) {
    if (onUpdate) {
      Promise.resolve()
        .then(fetcher)
        .then(async (fresh) => {
          await writeCacheEntry(key, fresh, { ttlMs });
          onUpdate(fresh, { fromCache: false, stale: false });
        })
        .catch(() => {});
    }

    return {
      data: cached.value,
      fromCache: true,
      stale: false,
    };
  }

  if (cached && allowStale) {
    Promise.resolve()
      .then(fetcher)
      .then(async (fresh) => {
        await writeCacheEntry(key, fresh, { ttlMs });
        onUpdate?.(fresh, { fromCache: false, stale: false });
      })
      .catch(() => {});

    return {
      data: cached.value,
      fromCache: true,
      stale: true,
    };
  }

  const fresh = await fetcher();
  await writeCacheEntry(key, fresh, { ttlMs });
  return {
    data: fresh,
    fromCache: false,
    stale: false,
  };
}

export async function fetchWithLocalCacheResilient(key, ttlMs, fetcher, options = {}) {
  try {
    return await fetchWithLocalCache(key, ttlMs, fetcher, options);
  } catch (error) {
    const cached = await readCacheEntry(key);
    if (cached?.value !== undefined && options.allowStale !== false) {
      return {
        data: cached.value,
        fromCache: true,
        stale: true,
        offline: typeof navigator !== "undefined" && navigator.onLine === false,
        error: String(error?.message || error || ""),
      };
    }
    throw error;
  }
}
