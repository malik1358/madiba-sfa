import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadCatalogueDetails, requireCatalogueAccess } from "../../lib/productCatalogueServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const access = await requireCatalogueAccess(admin, request);
    return json({ success: true, ...await loadCatalogueDetails(admin), canManagePhotos: access.canManagePhotos });
  } catch (error) {
    if (!error.status) console.error("Product catalogue request failed:", error.message);
    return json({ success: false, error: error.status ? error.message : "Unable to load product packing. Please try again or contact an administrator." }, error.status || 500);
  }
}
