import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runMatchedReceiptEmailCycle } from "../../../lib/matchedReceiptEmailServer.js";
import { scheduledPreviousDayEmailDates, teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 300;

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch {}
    }
    const to = String(body.to || url.searchParams.get("to") || "").trim();
    const preview = body.preview === true || url.searchParams.get("preview") === "true";
    const explicitDate = String(body.date || url.searchParams.get("date") || "").trim();
    const held = teamEmailWindowSkip(new Date(), { bypass: Boolean(to || preview) });
    if (held) return NextResponse.json(held);
    const dates = explicitDate || to || preview ? [explicitDate] : scheduledPreviousDayEmailDates();
    const admin = createAdminClient();
    const runs = [];
    for (const date of dates) {
      runs.push(await runMatchedReceiptEmailCycle(admin, {
        date,
        preview,
        to,
        now: new Date(),
        env: process.env,
      }));
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
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}