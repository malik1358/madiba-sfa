import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeVisitReportEmailUserIds,
  parseReportDateParam,
  runDailyVisitReportEmailCycle,
} from "../../../lib/dailyVisitReportEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function canSendVisitReportEmail(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return role === "admin" || role === "manager";
}

async function requireSenderAccess(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || !canSendVisitReportEmail(profile)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only admin or manager can send visit report emails." },
        { status: 403 },
      ),
    };
  }

  return { user, profile };
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireSenderAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const userIds = normalizeVisitReportEmailUserIds(body?.userIds || body?.userId);
    if (!userIds.length) {
      return NextResponse.json(
        { success: false, error: "Select at least one user to email." },
        { status: 400 },
      );
    }

    if (!String(body?.date || "").trim()) {
      return NextResponse.json(
        { success: false, error: "Report date is required." },
        { status: 400 },
      );
    }

    let date = "";
    try {
      date = parseReportDateParam(body.date);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error.message || "Invalid report date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const result = await runDailyVisitReportEmailCycle(admin, { date, userIds });
    if (result.skipped) {
      return NextResponse.json(
        { success: false, error: "Email is not configured on the server.", ...result },
        { status: 503 },
      );
    }

    const failedCount = Number(result.failedCount || 0);
    return NextResponse.json(
      { success: failedCount === 0, ...result },
      { status: failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to send daily visit report email." },
      { status: 500 },
    );
  }
}
