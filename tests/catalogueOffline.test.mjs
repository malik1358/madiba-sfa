import test from "node:test";
import assert from "node:assert/strict";
import {
  attachCataloguePhotoUrls, catalogueMetaFromPayload, catalogueOfflineNotice, cataloguePhotoCacheKey,
  cataloguePhotosToFetch, CATALOGUE_OFFLINE_KEY, CATALOGUE_PHOTO_PREFIX, mergeCataloguePacking,
  syncCataloguePhotoBlobs,
} from "../app/lib/catalogueOffline.js";

function memoryStore(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    async read(key) { return entries.get(key); },
    async write(key, value) { entries.set(key, value); return true; },
    async remove(key) { entries.delete(key); },
    async list(prefix) { return [...entries.keys()].filter((key) => String(key).startsWith(prefix)); },
  };
}

test("catalogue offline meta keeps packing and photo ids and reuses saved packing when the sheet fails", () => {
  const meta = catalogueMetaFromPayload({
    photosReady: true,
    warnings: [],
    details: { A123: { sellingUnit: "CTN", packing: "CTN OF 12", photos: [{ id: "p1", url: "https://signed.example/p1" }] } },
  });
  assert.deepEqual(meta.details.A123, { sellingUnit: "CTN", packing: "CTN OF 12", photos: [{ id: "p1" }] });
  const failed = catalogueMetaFromPayload({
    photosReady: true,
    warnings: ["Google Sheet packing unavailable: timeout. Showing existing stock-take packing where available."],
    details: { A123: { sellingUnit: "CTN", packing: "12 PCS / CTN", photos: [{ id: "p1" }] } },
  });
  assert.equal(mergeCataloguePacking(meta, failed).details.A123.packing, "CTN OF 12");
  assert.equal(catalogueOfflineNotice(true, false).includes("once while online"), true);
  assert.equal(catalogueOfflineNotice(true, true), "");
  assert.equal(catalogueOfflineNotice(false, false), "");
});

test("catalogue photo sync stores missing files and drops photos that left the catalogue", async () => {
  const store = memoryStore({
    [CATALOGUE_OFFLINE_KEY]: { details: {} },
    [cataloguePhotoCacheKey("old")]: new Blob(["old"], { type: "image/jpeg" }),
    [cataloguePhotoCacheKey("keep")]: new Blob(["keep"], { type: "image/jpeg" }),
  });
  const meta = catalogueMetaFromPayload({
    details: { A1: { packing: "CTN", photos: [{ id: "keep" }, { id: "new" }] } },
  });
  assert.deepEqual(cataloguePhotosToFetch(["keep", "new"], ["old", "keep"]), { missing: ["new"], stale: ["old"] });
  const downloaded = [];
  const shown = [];
  const result = await syncCataloguePhotoBlobs({
    meta,
    store,
    downloadPhoto: async (id) => {
      downloaded.push(id);
      return new Blob([id], { type: "image/jpeg" });
    },
    onStored: (id) => shown.push(id),
  });
  assert.deepEqual(downloaded, ["new"]);
  assert.deepEqual(shown, ["new"]);
  assert.deepEqual(result, { missing: 1, removed: 1, stored: 1 });
  assert.equal(store.entries.has(cataloguePhotoCacheKey("old")), false);
  assert.equal(store.entries.has(cataloguePhotoCacheKey("keep")), true);
  assert.equal(store.entries.get(cataloguePhotoCacheKey("new")) instanceof Blob, true);
  const urls = attachCataloguePhotoUrls(meta, { keep: "blob:keep", new: "blob:new" });
  assert.deepEqual(urls.A1.photos.map((photo) => photo.url), ["blob:keep", "blob:new"]);
  assert.equal(cataloguePhotoCacheKey("new").startsWith(CATALOGUE_PHOTO_PREFIX), true);
});
