import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readOfflineDataVersion } from "../../lib/offlineDataBroadcast.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Please login again." }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.slice(7);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) {
      return NextResponse.json({ success: false, error: "Please login again." }, { status: 401 });
    }

    const payload = await readOfflineDataVersion(admin);
    return NextResponse.json({
      success: true,
      ...((payload && typeof payload === "object") ? payload : { version: 0, kinds: [] }),
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load offline data version.",
    }, { status: 500 });
  }
}
