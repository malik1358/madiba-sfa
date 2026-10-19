import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMobileFieldSnapshotForUser } from "../../lib/server/mobileFieldSnapshot.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 });
    }

    const snapshot = await getMobileFieldSnapshotForUser(admin, user.id);

    return NextResponse.json({
      success: true,
      snapshot,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load mobile snapshot.",
    }, { status: 500 });
  }
}
