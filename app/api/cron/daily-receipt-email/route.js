import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runDailyReceiptEmailCycle } from "../../../lib/dailyReceiptEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
  }
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const env = {
      ...process.env,
      ...(String(body?.to || "").trim() ? { DAILY_RECEIPT_EMAIL_TEST_TO: String(body.to).trim() } : {}),
    };
    const result = await runDailyReceiptEmailCycle(createAdminClient(), { date: body?.date, env });
    return NextResponse.json({ success: !result.failedCount, ...result }, { status: result.failedCount ? 500 : 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error?.message || error) }, { status: 500 });
  }
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const body = { date: url.searchParams.get("date"), to: url.searchParams.get("to") };
  const requestLike = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) });
  return POST(requestLike);
}