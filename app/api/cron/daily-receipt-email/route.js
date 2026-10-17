import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runDailyReceiptEmailCycle } from "../../../lib/dailyReceiptEmailServer.js";
import { scheduledPreviousDayEmailDates, teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

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
    const testTo = String(body?.to || "").trim();
    const held = teamEmailWindowSkip(new Date(), { bypass: Boolean(testTo) });
    if (held) return NextResponse.json(held);
    const env = {
      ...process.env,
      ...(testTo ? { DAILY_RECEIPT_EMAIL_TEST_TO: testTo } : {}),
    };
    const explicitDate = String(body?.date || "").trim();
    const dates = explicitDate || testTo ? [explicitDate] : scheduledPreviousDayEmailDates();
    const admin = createAdminClient();
    const runs = [];
    for (const date of dates) {
      runs.push(await runDailyReceiptEmailCycle(admin, { date, env }));
    }
    const failedCount = runs.reduce((sum, run) => sum + Number(run.failedCount || 0), 0);
    const result = runs[runs.length - 1] || {};
    return NextResponse.json({
      success: !failedCount,
      ...result,
      dates: runs.map((run) => run.date),
      runs,
      failedCount,
    }, { status: failedCount ? 500 : 200 });
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