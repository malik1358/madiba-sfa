import sharp from "sharp";
import { isMissingRelationError } from "./schemaGuards.js";
import {
  cataloguePacking,
  cataloguePermissions,
  catalogueSheetPacking,
  MAX_PRODUCT_PHOTO_BYTES,
  normalizeCatalogueCode,
} from "./productCatalogue.js";
import { parseCsvToRows } from "./pricePayload.js";
import { loadRoleModuleMatrix } from "./roleModuleAccessServer.js";
import {
  ATTACHMENT_ENTITY_TYPES,
  attachmentObjectRef,
  createAttachmentRecord,
  getAttachmentById,
  isAttachmentId,
  isMissingAttachmentSchemaError,
} from "./storage/attachmentRecords.js";
import {
  ATTACHMENT_BUCKETS,
  ATTACHMENT_CATEGORIES,
  buildAttachmentKey,
  KEY_LAYOUTS,
} from "./storage/attachmentKeys.js";
import {
  deleteObject,
  ensureAttachmentBucket,
  getSignedReadUrl,
  readAttachmentStorageConfig,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_PROVIDERS,
  writeAttachmentObject,
} from "./storage/attachmentStorage.js";

export const CATALOGUE_PACKING_SHEET_URL = "https://docs.google.com/spreadsheets/d/1vXUem61icj7Gv8wBNx5_Sc-oXNDm-wZiLZCjTjGtXww/export?format=csv&gid=612911319";

const PHOTO_ATTACHMENT_SELECT = "id,entity_id,object_key,storage_provider,created_at,original_file_name,content_type";
const MIGRATION_MESSAGE = "Photo upload is not ready. Apply 20261015084023_product_catalogue_photos_attachments.sql in Supabase.";

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function isCataloguePhotoCategoryError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return message.includes("product_catalogue_photo")
    || message.includes("attachments_category")
    || (message.includes("check") && message.includes("category"));
}

export async function loadCatalogueSheetPacking(fetcher = fetch) {
  const response = await fetcher(CATALOGUE_PACKING_SHEET_URL, {
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Packing sheet request failed (${response.status}).`);
  const text = await response.text();
  return catalogueSheetPacking(parseCsvToRows(text));
}

export async function requireCatalogueAccess(admin, request, write = false) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) fail("Please login again.", 401);
  const { data: { user }, error } = await admin.auth.getUser(header.slice(7));
  if (error || !user) fail("Please login again.", 401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,salesman_code,is_active").eq("id", user.id).single();
  if (profileError) throw profileError;
  let roleModuleMatrix = null;
  try {
    const loaded = await loadRoleModuleMatrix(admin);
    roleModuleMatrix = loaded.matrix;
  } catch {
    roleModuleMatrix = null;
  }
  const permissions = cataloguePermissions(profile, user, { roleModuleMatrix });
  if (!permissions.canView || (write && !permissions.canManagePhotos)) {
    fail(write ? "Only admin or manager can manage product photos." : "Product catalogue access denied.", 403);
  }
  return { user, profile, ...permissions };
}

async function readAll(admin, table, columns, orderColumn = "item_code") {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await admin.from(table).select(columns)
      .order(orderColumn)
      .range(start, start + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

async function loadCataloguePhotoAttachments(admin) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await admin.from("attachments")
      .select(PHOTO_ATTACHMENT_SELECT)
      .eq("category", ATTACHMENT_CATEGORIES.productCataloguePhoto)
      .order("created_at")
      .order("id")
      .range(start, start + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

export async function loadCatalogueDetails(admin, loadSheetPacking = loadCatalogueSheetPacking) {
  const warnings = [];
  async function optionalRows(table, columns) {
    try {
      return await readAll(admin, table, columns);
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
      warnings.push(`Packing source ${table} is not installed.`);
      return [];
    }
  }
  async function sheetPacking() {
    try {
      return await loadSheetPacking();
    } catch (error) {
      warnings.push(`Google Sheet packing unavailable: ${error.message} Showing existing stock-take packing where available.`);
      return {};
    }
  }

  let photos = [];
  let photosReady = true;
  try {
    photos = await loadCataloguePhotoAttachments(admin);
  } catch (error) {
    if (isMissingAttachmentSchemaError(error) || isMissingRelationError(error)) {
      photosReady = false;
      warnings.push(MIGRATION_MESSAGE);
      photos = [];
    } else {
      throw error;
    }
  }

  const [products, stockItems, items, packingByCode] = await Promise.all([
    optionalRows("products", "item_code,unit"),
    optionalRows("stock_take_items", "item_code,base_uom,mid_uom,master_uom,base_uom_pack_size,mid_uom_pack_size"),
    readAll(admin, "items_master", "*"),
    sheetPacking(),
  ]);
  const details = {};
  function detailFor(code) {
    const normalized = normalizeCatalogueCode(code);
    details[normalized] ||= { photos: [], sellingUnit: "", packing: "" };
    return details[normalized];
  }
  const productsByCode = new Map(products.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const stockByCode = new Map(stockItems.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const itemsByCode = new Map(items.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  for (const code of new Set([...productsByCode.keys(), ...stockByCode.keys(), ...itemsByCode.keys(), ...Object.keys(packingByCode)])) {
    Object.assign(detailFor(code), cataloguePacking(itemsByCode.get(code), productsByCode.get(code), stockByCode.get(code)));
    if (packingByCode[code]) detailFor(code).packing = packingByCode[code];
  }

  photos.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  for (const photo of photos) {
    const ref = attachmentObjectRef(photo);
    const itemCode = normalizeCatalogueCode(photo.entity_id);
    if (!ref || !itemCode) continue;
    try {
      const signed = await getSignedReadUrl(admin, {
        provider: ref.provider,
        key: ref.key,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
      detailFor(itemCode).photos.push({ id: photo.id, url: signed.url });
    } catch {
      fail("Unable to load a product photo. Refresh or ask an administrator to check Storage.", 500);
    }
  }
  return { details, warnings, photosReady };
}

async function assertExistingItem(admin, rawCode) {
  const code = normalizeCatalogueCode(rawCode);
  if (!code || code.length > 100) fail("A valid item code is required.");
  const [items, { data: cache, error: cacheError }] = await Promise.all([
    readAll(admin, "items_master", "item_code"),
    admin.from("price_catalog_cache").select("sheet_items,price_map").eq("cache_key", "default").maybeSingle(),
  ]);
  if (cacheError) throw cacheError;
  const codes = [
    ...items.map((item) => item.item_code),
    ...(Array.isArray(cache?.sheet_items) ? cache.sheet_items.map((item) => item.item_code) : []),
    ...Object.keys(cache?.price_map || {}),
  ];
  if (!codes.some((candidate) => normalizeCatalogueCode(candidate) === code)) {
    fail("Item not found in the current catalogue.", 404);
  }
  return code;
}

export async function prepareCataloguePhoto(file) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size || file.size > MAX_PRODUCT_PHOTO_BYTES) {
    fail("Choose a JPEG, PNG, or WebP photo no larger than 3 MB.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_PRODUCT_PHOTO_BYTES) fail("Photo must be no larger than 3 MB.", 413);
  const image = sharp(buffer, { limitInputPixels: 25000000, animated: false });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    fail("This photo cannot be read. Choose a valid JPEG, PNG, or WebP image.");
  }
  if (!["jpeg", "png", "webp"].includes(metadata.format)) fail("Only JPEG, PNG, and WebP photos are supported.");
  try {
    return await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
  } catch {
    fail("This photo cannot be processed. Choose a valid JPEG, PNG, or WebP image.");
  }
}

export async function uploadCataloguePhoto(admin, user, rawCode, file) {
  const code = await assertExistingItem(admin, rawCode);
  const { error: schemaError } = await admin.from("attachments").select("id").limit(1);
  if (schemaError) {
    if (isMissingAttachmentSchemaError(schemaError) || isMissingRelationError(schemaError)) {
      fail(MIGRATION_MESSAGE, 503);
    }
    throw schemaError;
  }

  const image = await prepareCataloguePhoto(file);
  let config = readAttachmentStorageConfig();
  if (config.writeProvider === STORAGE_PROVIDERS.r2) {
    const { error: attachProbe } = await admin.from("attachments").select("id").limit(1);
    if (attachProbe && isMissingAttachmentSchemaError(attachProbe)) {
      config = { ...config, writeProvider: STORAGE_PROVIDERS.supabase, dualWrite: false };
    }
  }
  if (config.writeProvider !== STORAGE_PROVIDERS.r2) {
    await ensureAttachmentBucket(admin, ATTACHMENT_BUCKETS.productCatalogue);
  }

  const layout = config.writeProvider === STORAGE_PROVIDERS.r2 ? KEY_LAYOUTS.immutable : KEY_LAYOUTS.legacy;
  const objectKey = buildAttachmentKey(
    ATTACHMENT_CATEGORIES.productCataloguePhoto,
    { itemCode: code, extension: "jpg" },
    layout,
  );
  const write = await writeAttachmentObject(admin, {
    key: objectKey,
    body: image,
    contentType: "image/jpeg",
    metadata: { category: ATTACHMENT_CATEGORIES.productCataloguePhoto, "entity-type": ATTACHMENT_ENTITY_TYPES.productItem },
    config,
  });
  const stored = write.primary;

  try {
    const { record, supported } = await createAttachmentRecord(admin, {
      category: ATTACHMENT_CATEGORIES.productCataloguePhoto,
      stored,
      originalFileName: `${code}.jpg`,
      entityType: ATTACHMENT_ENTITY_TYPES.productItem,
      entityId: code,
      uploadedBy: user.id,
    });
    if (!supported || !record?.id) {
      await deleteObject(admin, { key: stored.key, provider: stored.provider });
      fail(MIGRATION_MESSAGE, 503);
    }
    return { id: record.id };
  } catch (error) {
    try {
      await deleteObject(admin, { key: stored.key, provider: stored.provider });
    } catch (cleanupError) {
      console.error("Product photo rollback failed:", cleanupError.message);
    }
    if (isCataloguePhotoCategoryError(error) || isMissingAttachmentSchemaError(error)) {
      fail(MIGRATION_MESSAGE, 503);
    }
    throw error;
  }
}

export async function deleteCataloguePhoto(admin, id) {
  if (!isAttachmentId(id)) fail("Invalid photo ID.");
  const photo = await getAttachmentById(admin, id);
  if (!photo || photo.category !== ATTACHMENT_CATEGORIES.productCataloguePhoto) {
    fail("Photo not found.", 404);
  }
  const ref = attachmentObjectRef(photo);
  if (!ref) fail("Photo not found.", 404);
  await deleteObject(admin, { key: ref.key, provider: ref.provider });
  const { error: deleteError } = await admin.from("attachments").delete().eq("id", photo.id);
  if (deleteError) throw deleteError;
}
