import { listCacheKeys, readCacheEntry, removeCacheEntry, writeCacheEntry } from "./localDataStore.js";

export const CATALOGUE_OFFLINE_KEY = "product-catalogue-offline-v1";
export const CATALOGUE_PHOTO_PREFIX = "product-catalogue-photo-v1:";
export const CATALOGUE_PHOTO_WRITE_TIMEOUT_MS = 20000;

const SHEET_WARNING = /google sheet packing unavailable/i;

export function cataloguePhotoCacheKey(photoId) {
  return `${CATALOGUE_PHOTO_PREFIX}${String(photoId || "").trim()}`;
}

export function catalogueMetaFromPayload(payload = {}) {
  const details = {};
  for (const [code, detail] of Object.entries(payload.details || {})) {
    const normalized = String(code || "").trim();
    if (!normalized || !detail || typeof detail !== "object") continue;
    details[normalized] = {
      sellingUnit: String(detail.sellingUnit || ""),
      packing: String(detail.packing || ""),
      photos: (Array.isArray(detail.photos) ? detail.photos : [])
        .map((photo) => ({ id: String(photo?.id || "").trim() }))
        .filter((photo) => photo.id),
    };
  }
  return {
    details,
    warnings: (Array.isArray(payload.warnings) ? payload.warnings : [])
      .map((warning) => String(warning || "").trim())
      .filter(Boolean),
    photosReady: payload.photosReady === true,
  };
}

export function cataloguePhotoIds(meta) {
  const ids = [];
  for (const detail of Object.values(meta?.details || {})) {
    for (const photo of detail?.photos || []) {
      if (photo?.id) ids.push(photo.id);
    }
  }
  return [...new Set(ids)];
}

export function cataloguePhotosToFetch(wantedIds = [], storedIds = []) {
  const have = new Set(storedIds);
  const wanted = new Set(wantedIds);
  return {
    missing: wantedIds.filter((id) => id && !have.has(id)),
    stale: [...storedIds].filter((id) => id && !wanted.has(id)),
  };
}

export function mergeCataloguePacking(previous, next) {
  if (!next) return previous || null;
  const sheetFailed = (next.warnings || []).some((warning) => SHEET_WARNING.test(warning));
  if (!sheetFailed || !previous?.details) return next;
  const details = { ...next.details };
  for (const [code, prior] of Object.entries(previous.details)) {
    if (!prior?.packing) continue;
    const incoming = details[code];
    if (!incoming) continue;
    details[code] = { ...incoming, packing: prior.packing };
  }
  return { ...next, details };
}

export function attachCataloguePhotoUrls(meta, urlById = {}) {
  const details = {};
  for (const [code, detail] of Object.entries(meta?.details || {})) {
    details[code] = {
      sellingUnit: detail?.sellingUnit || "",
      packing: detail?.packing || "",
      photos: (detail?.photos || []).map((photo) => ({
        id: photo.id,
        url: urlById[photo.id] || "",
      })),
    };
  }
  return details;
}

export function catalogueOfflineNotice(offline, hasCache) {
  if (!offline || hasCache) return "";
  return "Photos and packing are not on this device yet. Open the catalogue once while online.";
}

function defaultStore() {
  return {
    async read(key) {
      const entry = await readCacheEntry(key, { timeoutMs: CATALOGUE_PHOTO_WRITE_TIMEOUT_MS });
      return entry?.value;
    },
    write(key, value, options) {
      return writeCacheEntry(key, value, options);
    },
    remove: removeCacheEntry,
    list: listCacheKeys,
  };
}

export async function readCatalogueOffline(store = defaultStore()) {
  const value = await store.read(CATALOGUE_OFFLINE_KEY);
  if (!value || typeof value !== "object" || !value.details || typeof value.details !== "object") return null;
  return value;
}

export async function writeCatalogueOffline(meta, store = defaultStore()) {
  if (!meta?.details) return false;
  return store.write(CATALOGUE_OFFLINE_KEY, meta, { ttlMs: 0 });
}

export function cataloguePhotoBlob(value) {
  if (!value) return null;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size ? value : null;
  if (value instanceof ArrayBuffer) return new Blob([value], { type: "image/jpeg" });
  if (ArrayBuffer.isView(value)) return new Blob([value], { type: "image/jpeg" });
  return null;
}

export async function readCataloguePhotoBlob(photoId, store = defaultStore()) {
  return cataloguePhotoBlob(await store.read(cataloguePhotoCacheKey(photoId)));
}

export async function writeCataloguePhotoBlob(photoId, blob, store = defaultStore()) {
  const body = cataloguePhotoBlob(blob);
  if (!photoId || !body) return false;
  return store.write(cataloguePhotoCacheKey(photoId), body, {
    ttlMs: 0,
    timeoutMs: CATALOGUE_PHOTO_WRITE_TIMEOUT_MS,
    indexedDbOnly: true,
  });
}

async function mapWithLimit(list, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  }
  const workers = Math.min(Math.max(limit, 1), list.length || 1);
  if (list.length) await Promise.all(Array.from({ length: workers }, () => run()));
}

let cataloguePhotoSync = null;
let cataloguePhotoSyncAgain = false;

export function cataloguePhotoSyncInFlight() {
  return Boolean(cataloguePhotoSync);
}

/** Run photo saving in the background. A second request waits for one follow-up pass. */
export function beginCataloguePhotoSync(task) {
  if (typeof task !== "function") return Promise.resolve();
  if (cataloguePhotoSync) {
    cataloguePhotoSyncAgain = true;
    return cataloguePhotoSync;
  }
  cataloguePhotoSync = (async () => {
    do {
      cataloguePhotoSyncAgain = false;
      try {
        await task();
      } catch {
        // Keep the copy already saved on the device.
      }
    } while (cataloguePhotoSyncAgain);
  })().finally(() => {
    cataloguePhotoSync = null;
  });
  return cataloguePhotoSync;
}

export async function syncCataloguePhotoBlobs({
  meta,
  downloadPhoto,
  store = defaultStore(),
  onStored,
  concurrency = 4,
} = {}) {
  const wanted = cataloguePhotoIds(meta);
  const keys = await store.list(CATALOGUE_PHOTO_PREFIX);
  const storedIds = keys
    .map((key) => (String(key).startsWith(CATALOGUE_PHOTO_PREFIX) ? String(key).slice(CATALOGUE_PHOTO_PREFIX.length) : ""))
    .filter(Boolean);
  const { missing, stale } = cataloguePhotosToFetch(wanted, storedIds);
  await Promise.all(stale.map((id) => store.remove(cataloguePhotoCacheKey(id))));
  let stored = 0;
  await mapWithLimit(missing, concurrency, async (id) => {
    const downloaded = await downloadPhoto(id);
    const body = cataloguePhotoBlob(downloaded);
    if (!body) return;
    await writeCataloguePhotoBlob(id, body, store);
    stored += 1;
    onStored?.(id, body, stored, missing.length);
  });
  return { missing: missing.length, removed: stale.length, stored };
}
