import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MAX_PRODUCT_PHOTO_BYTES } from "../../lib/productCatalogue.js";
import {
  deleteCataloguePhoto,
  loadCatalogueDetails,
  readCataloguePhoto,
  requireCatalogueAccess,
  uploadCataloguePhoto,
} from "../../lib/productCatalogueServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function handle(request, write, operation) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const access = await requireCatalogueAccess(admin, request, write);
    return json({ success: true, ...await operation(admin, access) });
  } catch (error) {
    if (!error.status) console.error("Product catalogue request failed:", error.message);
    return json({
      success: false,
      error: error.status
        ? error.message
        : "Unable to access product photos or packing. Please try again or contact an administrator.",
    }, error.status || 500);
  }
}

async function sendCataloguePhoto(request, photoId) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await requireCatalogueAccess(admin, request, false);
    const photo = await readCataloguePhoto(admin, photoId);
    return new NextResponse(photo.bytes, {
      status: 200,
      headers: {
        "Content-Type": photo.contentType || "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!error.status) console.error("Product catalogue photo download failed:", error.message);
    return json({
      success: false,
      error: error.status ? error.message : "Unable to load this product photo.",
    }, error.status || 500);
  }
}

export function GET(request) {
  const photoId = new URL(request.url).searchParams.get("photoId");
  if (photoId) return sendCataloguePhoto(request, photoId);
  return handle(request, false, async (admin, access) => ({
    ...await loadCatalogueDetails(admin), canManagePhotos: access.canManagePhotos,
  }));
}

export function POST(request) {
  return handle(request, true, async (admin, access) => {
    if (Number(request.headers.get("content-length")) > MAX_PRODUCT_PHOTO_BYTES + 65536) {
      throw Object.assign(new Error("Photo must be no larger than 3 MB."), { status: 413 });
    }
    const form = await request.formData();
    return uploadCataloguePhoto(admin, access.user, form.get("itemCode"), form.get("photo"));
  });
}

export function DELETE(request) {
  return handle(request, true, async (admin) => {
    await deleteCataloguePhoto(admin, new URL(request.url).searchParams.get("photoId"));
    return {};
  });
}
