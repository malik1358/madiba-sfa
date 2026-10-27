import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminRole } from "../../../lib/moduleAccess.js";
import { loadItemsSoldAtLossReport } from "../../../lib/itemsSoldAtLossServer.js";
import { normalizeItemsSoldAtLossDate } from "../../../lib/itemsSoldAtLoss.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return json({ success: false, error: "Server configuration is incomplete." }, 500);
    }

    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const header = request.headers.get("authorization") || "";
    if (!header.startsWith("Bearer ")) {
      return json({ success: false, error: "Please login again." }, 401);
    }

    const { data: { user }, error } = await admin.auth.getUser(header.slice(7));
    if (error || !user) {
      return json({ success: false, error: "Please login again." }, 401);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    if (profile?.is_active === false || !isAdminRole(profile?.role)) {
      return json({
        success: false,
        error: "Items sold at loss is available to admin only.",
      }, 403);
    }

    const requestUrl = new URL(request.url);
    const dateFrom = normalizeItemsSoldAtLossDate(requestUrl.searchParams.get("from"));
    const dateTo = normalizeItemsSoldAtLossDate(requestUrl.searchParams.get("to"));
    const report = await loadItemsSoldAtLossReport(admin, { dateFrom, dateTo });
    return json({ success: true, ...report });
  } catch (error) {
    const message = String(error?.message || "");
    if (/From date must not/i.test(message)) {
      return json({ success: false, error: message }, 400);
    }
    console.error("Items sold at loss report failed:", message);
    return json({ success: false, error: "Unable to load items sold at loss." }, 500);
  }
}
