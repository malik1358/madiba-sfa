import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAppPerformanceCheck } from "../../../lib/appPerformanceCheck.js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    let externalBuildInfoMs = null;
    if (request.method === "POST") {
      try {
        const body = await request.json();
        externalBuildInfoMs = body?.external_build_info_ms;
      } catch {
        externalBuildInfoMs = null;
      }
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await runAppPerformanceCheck(admin, { externalBuildInfoMs });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "App performance check failed." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}
