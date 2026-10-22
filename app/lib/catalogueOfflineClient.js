import { fetchJsonWithTimeout, getSessionWithTimeout } from "./authSession.js";
import {
  beginCataloguePhotoSync, catalogueMetaFromPayload, mergeCataloguePacking, readCatalogueOffline,
  syncCataloguePhotoBlobs, writeCatalogueOffline,
} from "./catalogueOffline.js";
import { getSupabaseClient } from "./supabase.js";

export const CATALOGUE_PHOTO_SYNC_EVENT = "madiba-catalogue-photo-sync";

function emit(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CATALOGUE_PHOTO_SYNC_EVENT, { detail }));
}

async function catalogueAccessToken() {
  const supabase = getSupabaseClient();
  if (!supabase) return "";
  const session = await getSessionWithTimeout(supabase);
  return session?.access_token || "";
}

async function saveCataloguePhotos() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const token = await catalogueAccessToken();
  if (!token) return;
  emit({ type: "start" });
  try {
    const cached = await readCatalogueOffline();
    const { response, payload } = await fetchJsonWithTimeout("/api/product-catalogue", {
      headers: { Authorization: `Bearer ${token}` },
    }, 45000);
    if (!response.ok || !payload?.success) {
      emit({ type: "error", message: payload?.error || "Unable to load photos and packing.", hasCache: Boolean(cached) });
      return;
    }
    const next = mergeCataloguePacking(cached, catalogueMetaFromPayload(payload));
    await writeCatalogueOffline(next);
    emit({ type: "meta", meta: next, canManagePhotos: payload.canManagePhotos === true });
    await syncCataloguePhotoBlobs({
      meta: next,
      downloadPhoto: async (id) => {
        const photoResponse = await fetch(`/api/product-catalogue?photoId=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!photoResponse.ok) return null;
        return photoResponse.blob();
      },
      onStored: (id, blob) => emit({ type: "photo", id, blob, meta: next }),
    });
  } catch (error) {
    emit({
      type: "error",
      message: error?.message || "Unable to load photos and packing.",
      hasCache: true,
    });
  } finally {
    emit({ type: "done" });
  }
}

/** Save and update catalogue photos without blocking the screen that asked for it. */
export function startCataloguePhotoSync() {
  return beginCataloguePhotoSync(saveCataloguePhotos);
}
