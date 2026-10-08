import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runKpiTargetsEmailCycle } from "../../../lib/kpiTargetsEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const body = await request.json().catch(() => ({}));
    const month = String(body?.month || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ success: false, error: "Month is required in YYYY-MM format." }, { status: 400 });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await runKpiTargetsEmailCycle(admin, { month, trigger: "manual_monthly_send" });
    return NextResponse.json({ success: result.failedCount === 0, ...result }, {
      status: result.failedCount ? 500 : 200,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "KPI target email send failed.",
    }, { status: 500 });
  }
}