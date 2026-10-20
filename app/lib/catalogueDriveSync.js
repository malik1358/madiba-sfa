import { createHash } from "node:crypto";
import { isMissingRelationError } from "./schemaGuards.js";
import { normalizeCatalogueCode } from "./productCatalogue.js";
import {
  deleteCataloguePhoto,
  MAX_DRIVE_PHOTO_BYTES,
  prepareCataloguePhotoBuffer,
  storeCatalogueJpeg,
} from "./productCatalogueServer.js";
import { ATTACHMENT_CATEGORIES } from "./storage/attachmentKeys.js";
import {
  CATALOGUE_DRIVE_FOLDER_ID,
  CATALOGUE_DRIVE_SYNC_KEY,
  catalogueDriveItemCode,
  driveFileDownloadUrl,
  driveFileMarker,
  driveFileNeedsDownload,
  driveFolderListUrl,
  driveSyncIsLocked,
  parseDriveFileMarker,
  parseDriveFolderListing,
  parseDriveModifiedLabel,
  parseDriveSyncState,
  shouldOpenDriveFolder,
} from "./catalogueDrivePhotos.js";

const DRIVE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; MadibaCatalogue/1.0)",
  "Accept-Language": "en-US,en;q=0.9",
};
const DOWNLOAD_CAP = 40;

async function readRows(admin, table, columns, { filters = [], orderColumn = "id" } = {}) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    let query = admin.from(table).select(columns).order(orderColumn).range(start, start + 999);
    for (const [key, value] of filters) query = query.eq(key, value);
    const result = await query;
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

async function loadKnownCodes(admin) {
  const [items, cacheResult] = await Promise.all([
    readRows(admin, "items_master", "item_code", { orderColumn: "item_code" }),
    admin.from("price_catalog_cache").select("sheet_items,price_map").eq("cache_key", "default").maybeSingle(),
  ]);
  if (cacheResult.error) throw cacheResult.error;
  const codes = new Set(items.map((item) => normalizeCatalogueCode(item.item_code)).filter(Boolean));
  for (const item of cacheResult.data?.sheet_items || []) codes.add(normalizeCatalogueCode(item.item_code));
  for (const code of Object.keys(cacheResult.data?.price_map || {})) codes.add(normalizeCatalogueCode(code));
  codes.delete("");
  return codes;
}

async function loadCataloguePhotos(admin) {
  const rows = await readRows(
    admin,
    "attachments",
    "id,entity_id,sha256,original_file_name,created_at",
    { filters: [["category", ATTACHMENT_CATEGORIES.productCataloguePhoto]] },
  );
  const byCode = new Map();
  for (const row of rows) {
    const code = normalizeCatalogueCode(row.entity_id);
    if (!code) continue;
    const list = byCode.get(code) || [];
    list.push(row);
    byCode.set(code, list);
  }
  return byCode;
}

async function readSyncState(admin) {
  const { data, error } = await admin.from("system_settings").select("setting_value")
    .eq("setting_key", CATALOGUE_DRIVE_SYNC_KEY).maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return { status: "", startedAt: "", folders: {} };
    throw error;
  }
  return parseDriveSyncState(data?.setting_value);
}

async function writeSyncState(admin, state) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: CATALOGUE_DRIVE_SYNC_KEY,
    setting_value: JSON.stringify(state),
  }, { onConflict: "setting_key" });
  if (error && !isMissingRelationError(error)) throw error;
}

async function driveText(url, fetcher) {
  const response = await fetcher(url, {
    headers: DRIVE_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
  return response.text();
}

async function downloadDriveFile(fileId, fetcher) {
  const response = await fetcher(driveFileDownloadUrl(fileId), {
    headers: DRIVE_HEADERS,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Drive download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = String(response.headers.get("content-type") || "");
  if (type.includes("text/html") || bytes.subarray(0, 15).toString("utf8").toLowerCase().includes("<!doctype")) {
    throw new Error("Drive did not return the photo file.");
  }
  if (bytes.length > MAX_DRIVE_PHOTO_BYTES) throw new Error("This Drive photo is larger than 25 MB.");
  return bytes;
}

function markerFor(file, now) {
  const instant = parseDriveModifiedLabel(file.modified, now);
  return driveFileMarker(file.id, file.modified, instant ? instant.toISOString() : "");
}

async function rememberMarker(admin, photo, marker) {
  const { error } = await admin.from("attachments").update({ original_file_name: marker }).eq("id", photo.id);
  if (error) throw error;
  photo.original_file_name = marker;
}

export async function syncCatalogueDrivePhotos(admin, {
  fetcher = fetch,
  uploadedBy = null,
  now = new Date(),
  folderId = CATALOGUE_DRIVE_FOLDER_ID,
} = {}) {
  const state = await readSyncState(admin);
  if (driveSyncIsLocked(state, now)) {
    return { alreadyRunning: true, added: 0, updated: 0, linked: 0, skipped: 0, limited: false, errors: [] };
  }
  const folders = { ...(state.folders || {}) };
  await writeSyncState(admin, { status: "running", startedAt: now.toISOString(), folders, checkedAt: state.checkedAt || "" });

  const summary = { alreadyRunning: false, added: 0, updated: 0, linked: 0, skipped: 0, limited: false, errors: [] };
  let downloads = 0;
  try {
    const root = parseDriveFolderListing(await driveText(driveFolderListUrl(folderId), fetcher))
      .filter((entry) => entry.kind === "folder")
      .map((entry) => ({ ...entry, itemCode: catalogueDriveItemCode(entry.name) }));
    const [knownCodes, photosByCode] = await Promise.all([loadKnownCodes(admin), loadCataloguePhotos(admin)]);

    for (const folder of root) {
      if (summary.limited) break;
      const photos = folder.itemCode ? (photosByCode.get(folder.itemCode) || []) : [];
      const open = shouldOpenDriveFolder(folder, {
        photoCount: photos.length,
        savedLabel: Object.prototype.hasOwnProperty.call(folders, folder.id) ? folders[folder.id] : undefined,
        now,
      });
      if (!open) {
        if (folder.itemCode) folders[folder.id] = folder.modified;
        continue;
      }
      if (!folder.itemCode || !knownCodes.has(folder.itemCode)) {
        summary.skipped += 1;
        folders[folder.id] = folder.modified;
        continue;
      }
      let children;
      try {
        children = parseDriveFolderListing(await driveText(driveFolderListUrl(folder.id), fetcher));
      } catch (error) {
        summary.errors.push(`${folder.itemCode}: ${error.message}`);
        continue;
      }
      let folderFinished = true;
      for (const file of children) {
        const storedPhoto = photos.find((photo) => parseDriveFileMarker(photo.original_file_name)?.fileId === file.id);
        const needed = driveFileNeedsDownload({
          ...file,
          stored: storedPhoto ? parseDriveFileMarker(storedPhoto.original_file_name) : null,
        }, { photoCount: photos.length, now });
        if (!needed) {
          summary.skipped += 1;
          continue;
        }
        if (downloads >= DOWNLOAD_CAP) {
          summary.limited = true;
          folderFinished = false;
          break;
        }
        downloads += 1;
        try {
          const bytes = await downloadDriveFile(file.id, fetcher);
          const image = await prepareCataloguePhotoBuffer(bytes, { maxBytes: MAX_DRIVE_PHOTO_BYTES });
          const sha256 = createHash("sha256").update(image).digest("hex");
          const marker = markerFor(file, now);
          const same = photos.find((photo) => photo.sha256 && photo.sha256 === sha256);
          if (same) {
            await rememberMarker(admin, same, marker);
            summary.linked += 1;
            continue;
          }
          const saved = await storeCatalogueJpeg(admin, {
            code: folder.itemCode,
            image,
            originalFileName: marker,
            uploadedBy,
            createdAt: storedPhoto?.created_at || "",
          });
          photos.push({ id: saved.id, sha256: saved.sha256 || sha256, original_file_name: marker, created_at: storedPhoto?.created_at || now.toISOString() });
          if (storedPhoto) {
            await deleteCataloguePhoto(admin, storedPhoto.id);
            const index = photos.findIndex((photo) => photo.id === storedPhoto.id);
            if (index >= 0) photos.splice(index, 1);
            summary.updated += 1;
          } else {
            summary.added += 1;
          }
        } catch (error) {
          summary.errors.push(`${folder.itemCode} ${file.name}: ${error.message}`);
        }
      }
      if (folderFinished) folders[folder.id] = folder.modified;
      photosByCode.set(folder.itemCode, photos);
    }

    await writeSyncState(admin, {
      status: "idle",
      startedAt: "",
      checkedAt: now.toISOString(),
      folders,
      added: summary.added,
      updated: summary.updated,
      linked: summary.linked,
    });
    return summary;
  } catch (error) {
    await writeSyncState(admin, { status: "idle", startedAt: "", folders, checkedAt: state.checkedAt || "", error: error.message });
    throw error;
  }
}
