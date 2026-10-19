import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runDailyVisitReportEmailCycle } from "../../../lib/dailyVisitReportEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readDateParam(request) {
  const url = new URL(request.url);
  const queryDate = url.searchParams.get("date");
  if (queryDate) return queryDate;
  if (String(request.method || "").toUpperCase() === "GET") return "";

  try {
    const body = await request.json();
    return body?.date || "";
  } catch {
    return "";
  }
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

    const date = await readDateParam(request);
    const result = await runDailyVisitReportEmailCycle(admin, { date });
    const failedCount = Number(result.failedCount || 0);
    return NextResponse.json(
      { success: failedCount === 0, ...result },
      { status: failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Daily visit report email cycle failed." },
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
