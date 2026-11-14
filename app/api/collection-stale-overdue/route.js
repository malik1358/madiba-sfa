import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadCollectionStaleOverdueReport } from "../../lib/collectionStaleOverdueEmailServer.js";
import { buildModuleAccess } from "../../lib/moduleAccess.js";
import { loadRoleModuleMatrix } from "../../lib/roleModuleAccessServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json({ success: false, error: "Server configuration is incomplete." }, 500);

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const header = request.headers.get("authorization") || "";
    if (!header.startsWith("Bearer ")) return json({ success: false, error: "Please login again." }, 401);

    const { data: { user }, error } = await admin.auth.getUser(header.slice(7));
    if (error || !user) return json({ success: false, error: "Please login again." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,is_active,salesman_code")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    if (profile?.is_active === false) {
      return json({
        success: false,
        error: "You do not have access to this report.",
      }, 403);
    }

    const { matrix } = await loadRoleModuleMatrix(admin);
    const access = buildModuleAccess({
      role: profile?.role,
      salesmanCode: profile?.salesman_code,
      collectionOnlyMetadata: Boolean(
        user.user_metadata?.collection_only || user.app_metadata?.collection_only,
      ),
      roleModuleMatrix: matrix,
    });
    if (!access.canAccess("collectionStaleOverdue")) {
      return json({
        success: false,
        error: "You do not have access to this report.",
      }, 403);
    }

    const report = await loadCollectionStaleOverdueReport(admin);
    return json({
      success: true,
      date: report.date,
      asOf: report.asOf,
      asOfIso: report.asOfIso,
      rows: report.rows,
      summary: report.summary,
      customerCount: report.customerCount,
      groupCount: report.groupCount,
    });
  } catch (error) {
    console.error("Stale overdue collections report failed:", error?.message || error);
    return json({ success: false, error: "Unable to load the stale overdue collections report." }, 500);
  }
}
