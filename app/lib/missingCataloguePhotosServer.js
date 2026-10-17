import { missingCataloguePhotoReport } from "./missingCataloguePhotos.js";
import { isMissingRelationError } from "./schemaGuards.js";
import { ATTACHMENT_CATEGORIES } from "./storage/attachmentKeys.js";

async function readAll(admin, table, columns, orderColumn) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await admin.from(table).select(columns).order(orderColumn).range(start, start + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

export async function loadMissingCataloguePhotoReport(admin) {
  const [master, cacheResult] = await Promise.all([
    readAll(admin, "items_master", "item_code,item_name,category,is_active", "item_code"),
    admin.from("price_catalog_cache").select("sheet_items,price_map").eq("cache_key", "default").maybeSingle(),
  ]);
  if (cacheResult.error) throw cacheResult.error;

  let photoCodes = [];
  let photosReady = true;
  try {
    const photos = [];
    for (let start = 0; ; start += 1000) {
      const result = await admin.from("attachments")
        .select("entity_id")
        .eq("category", ATTACHMENT_CATEGORIES.productCataloguePhoto)
        .order("id")
        .range(start, start + 999);
      if (result.error) throw result.error;
      photos.push(...(result.data || []));
      if ((result.data || []).length < 1000) break;
    }
    photoCodes = photos.map((photo) => photo.entity_id);
  } catch (photoError) {
    if (!isMissingRelationError(photoError)) throw photoError;
    photosReady = false;
  }

  return {
    photosReady,
    ...missingCataloguePhotoReport({
      master,
      sheet: Array.isArray(cacheResult.data?.sheet_items) ? cacheResult.data.sheet_items : [],
      priceMap: cacheResult.data?.price_map || {},
      photoCodes,
    }),
  };
}
