import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canViewManagementReports } from "../../lib/moduleAccess.js";
import { loadActiveCustomersReport } from "../../lib/activeCustomersServer.js";

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
    if (profile?.is_active === false || !canViewManagementReports(profile?.role)) {
      return json({
        success: false,
        error: "This report is available to admin, manager, and invoice maker.",
      }, 403);
    }

    const report = await loadActiveCustomersReport(admin);
    return json({ success: true, ...report });
  } catch (error) {
    const message = String(error?.message || "");
    console.error("Active customers report failed:", message);
    if (/Active sales are not available/i.test(message)) {
      return json({ success: false, error: message }, 500);
    }
    return json({ success: false, error: "Unable to load active customers." }, 500);
  }
}
