import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { rebuildAllMobileFieldSnapshots } from "../../../lib/server/mobileFieldSnapshot.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const meta = await rebuildAllMobileFieldSnapshots(admin, { trigger: "cron" });

    return NextResponse.json({
      success: true,
      ...meta,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Mobile snapshot rebuild failed." },
      { status: 500 },
    );
  }
}
