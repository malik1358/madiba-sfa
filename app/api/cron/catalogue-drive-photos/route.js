import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncCatalogueDrivePhotos } from "../../../lib/catalogueDriveSync.js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await syncCatalogueDrivePhotos(admin);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Catalogue Drive photo check failed:", error.message);
    return NextResponse.json({ success: false, error: error.message || "Drive photo check failed." }, { status: 500 });
  }
}
