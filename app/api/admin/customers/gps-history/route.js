import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMissingGpsAuditError } from "../../../../lib/customerGpsHistory.js";
import { gpsHistoryQuery, hydrateGpsHistory } from "../../../../lib/customerGpsReport.js";
import { getKsaDateString } from "../../../../lib/workdayActivity.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdminAccess(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (profileError || !profile || !["admin", "report-user", "report_user", "manager"].includes(role)) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can access GPS history." }, { status: 403 }) };
  }

  return { user, role };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const customerCode = String(url.searchParams.get("customerCode") || "").trim().toUpperCase();
    if (url.searchParams.has("from") || url.searchParams.has("to") || !customerCode) {
      const today = getKsaDateString();
      const from = url.searchParams.get("from") || `${today.slice(0, 7)}-01`;
      const to = url.searchParams.get("to") || today;
      const rawPage = Number(url.searchParams.get("page") || 1);
      const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const limit = 50;
      const result = await gpsHistoryQuery(admin, {
        from, to, customerCode, count: true,
        acceptedOnly: url.searchParams.get("acceptedOnly") === "true",
      }).range((page - 1) * limit, page * limit - 1);
      if (result.error && isMissingGpsAuditError(result.error)) {
        return NextResponse.json({ success: true, history: [], pagination: { page: 1, limit, total: 0, totalPages: 1 }, migrationHint: "Apply sql/setup_customer_gps_history.sql in Supabase before GPS history can be recorded or reported." });
      }
      if (result.error) throw result.error;
      const history = await hydrateGpsHistory(admin, result.data || []);
      return NextResponse.json({ success: true, history, pagination: { page, limit, total: result.count || 0, totalPages: Math.max(1, Math.ceil((result.count || 0) / limit)) } });
    }
    if (!customerCode) throw new Error("Customer code is required");

    const { data, error } = await admin
      .from("customer_gps_history")
      .select("id,customer_code,latitude,longitude,previous_latitude,previous_longitude,source,updated_by,updated_by_name,created_at")
      .eq("customer_code", customerCode)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error && isMissingGpsAuditError(error)) {
      return NextResponse.json({
        success: true,
        history: [],
        migrationHint: "Apply sql/setup_customer_gps_history.sql in Supabase SQL Editor to store GPS update history.",
      });
    }
    if (error) throw error;

    return NextResponse.json({
      success: true,
      history: Array.isArray(data) ? data : [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load GPS history." },
      { status: 400 },
    );
  }
}
