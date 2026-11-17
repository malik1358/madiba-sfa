import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { syncItemMasterAnalysis } from "../../../lib/itemMasterAnalysisSync.js";
import { isAdminRole } from "../../../lib/moduleAccess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function authorizeSync(request) {
  if (isCronAuthorized(request)) {
    return { ok: true, via: "cron" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, response: json({ success: false, error: "Server configuration is incomplete." }, 500) };
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, response: json({ success: false, error: "Unauthorized" }, 401) };
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, response: json({ success: false, error: "Unauthorized" }, 401) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,is_active")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.is_active === false || !isAdminRole(profile.role)) {
    return {
      ok: false,
      response: json({ success: false, error: "Only admin or report-user can sync Item Master Analysis." }, 403),
    };
  }

  return { ok: true, via: "admin", admin, user, profile };
}

export async function POST(request) {
  try {
    const auth = await authorizeSync(request);
    if (!auth.ok) return auth.response;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);

    const admin = auth.admin || createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await syncItemMasterAnalysis(admin);
    return json({ success: true, via: auth.via, ...result });
  } catch (error) {
    console.error("Admin item master analysis sync failed:", error?.message || error);
    return json(
      { success: false, error: error?.message || "Item master analysis sync failed." },
      500,
    );
  }
}
