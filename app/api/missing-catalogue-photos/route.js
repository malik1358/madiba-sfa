import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { missingCataloguePhotoReport } from "../../lib/missingCataloguePhotos.js";
import { canViewManagementReports } from "../../lib/moduleAccess.js";
import { isMissingRelationError } from "../../lib/schemaGuards.js";
import { ATTACHMENT_CATEGORIES } from "../../lib/storage/attachmentKeys.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function readAll(admin, table, columns, orderColumn) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await admin.from(table).select(columns).order(orderColumn).range(start, start + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const header = request.headers.get("authorization") || "";
    if (!header.startsWith("Bearer ")) return json({ success: false, error: "Please login again." }, 401);
    const { data: { user }, error } = await admin.auth.getUser(header.slice(7));
    if (error || !user) return json({ success: false, error: "Please login again." }, 401);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role,is_active").eq("id", user.id).single();
    if (profileError) throw profileError;
    if (profile?.is_active === false || !canViewManagementReports(profile?.role)) {
      return json({ success: false, error: "This report is available to admin, manager, and invoice maker." }, 403);
    }

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

    const report = missingCataloguePhotoReport({
      master,
      sheet: Array.isArray(cacheResult.data?.sheet_items) ? cacheResult.data.sheet_items : [],
      priceMap: cacheResult.data?.price_map || {},
      photoCodes,
    });
    return json({ success: true, photosReady, ...report });
  } catch (error) {
    console.error("Missing catalogue photo report failed:", error.message);
    return json({ success: false, error: "Unable to load the missing photo report." }, 500);
  }
}
