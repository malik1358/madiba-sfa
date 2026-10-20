import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncCatalogueDrivePhotos } from "../../../lib/catalogueDriveSync.js";
import { requireCatalogueAccess } from "../../../lib/productCatalogueServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const access = await requireCatalogueAccess(admin, request, true);
    const result = await syncCatalogueDrivePhotos(admin, { uploadedBy: access.user?.id || null });
    return json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("Catalogue Drive photo update failed:", error.message);
    return json({
      success: false,
      error: error.status ? error.message : "Unable to update photos from Google Drive.",
    }, error.status || 500);
  }
}
