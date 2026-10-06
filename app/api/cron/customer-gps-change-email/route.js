import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runGpsChangeEmailCycle } from "../../../lib/customerGpsChangeEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

async function handleRequest(request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const date = new URL(request.url).searchParams.get("date") || "";
    const result = await runGpsChangeEmailCycle(admin, { date });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "GPS digest failed." }, { status: 500 });
  }
}

export const GET = handleRequest;
export const POST = handleRequest;