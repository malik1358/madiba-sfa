import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { syncItemMasterAnalysis } from "../../../lib/itemMasterAnalysisSync.js";

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

    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await syncItemMasterAnalysis(admin);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Item master analysis sync failed:", error?.message || error);
    return NextResponse.json(
      { success: false, error: error?.message || "Item master analysis sync failed." },
      { status: 500 },
    );
  }
}
