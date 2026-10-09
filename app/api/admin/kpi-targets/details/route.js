import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess, normalizeAccessRole } from "../../../../lib/moduleAccess.js";
import { PERFORMANCE_DISPLAY_KPI_KEYS, normalizeSalesmanCode } from "../../../../lib/performanceKpis.js";
import { isKpiTargetProfile } from "../../../../lib/kpiTargetsTable.js";
import { loadPerformanceKpiActualDetails } from "../../../../lib/performanceKpisServer.js";
import { resolveSalesScopeForUserId } from "../../../user/sales-scope/route.js";
import { getKsaDateString } from "../../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function parseReportDate(value) {
  const raw = String(value || getKsaDateString()).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Invalid month. Use YYYY-MM.");
  return raw;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ success: false, error: "Please login again." }, { status: 401 });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ success: false, error: "Please login again." }, { status: 401 });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,salesman_code")
      .eq("id", user.id)
      .single();
    const role = normalizeAccessRole(profile?.role);
    if (profileError || !profile || isCollectionOnlyAccess({ role, salesmanCode: profile?.salesman_code })) {
      return NextResponse.json({ success: false, error: "KPI details are unavailable for this account." }, { status: 403 });
    }

    const url = new URL(request.url);
    const reportDate = parseReportDate(url.searchParams.get("month"));
    const kpiKey = String(url.searchParams.get("kpi") || "").trim();
    const codes = [...new Set(String(url.searchParams.get("salesmanCodes") || "")
      .split(",").map(normalizeSalesmanCode).filter(Boolean))];
    if (!PERFORMANCE_DISPLAY_KPI_KEYS.includes(kpiKey) || !codes.length || codes.length > 100) {
      return NextResponse.json({ success: false, error: "Invalid KPI detail request." }, { status: 400 });
    }
    const { data: profiles, error: rosterError } = await admin
      .from("profiles")
      .select("salesman_code,salesman_name,role");
    if (rosterError) throw rosterError;
    const allowedCodes = new Set((profiles || [])
      .filter(isKpiTargetProfile)
      .map((row) => normalizeSalesmanCode(row.salesman_code)));
    const scope = await resolveSalesScopeForUserId(admin, user.id);
    const visibleCodes = new Set((scope.visibleSalesmanCodes || []).map(normalizeSalesmanCode));
    if (codes.some((code) => (
      !allowedCodes.has(code) || (!scope.hasAllAccess && !visibleCodes.has(code))
    ))) {
      return NextResponse.json({ success: false, error: "One or more salesmen are outside your KPI scope." }, { status: 403 });
    }

    const reports = await Promise.all(codes.map((salesmanCode) => (
      loadPerformanceKpiActualDetails(admin, { salesmanCode, reportDate, kpiKey })
    )));
    const rows = reports.flatMap((report) => report.rows);
    const actual = Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 100) / 100;
    return NextResponse.json({ success: true, month: reportDate.slice(0, 7), kpiKey, rows, actual }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load KPI transaction details." },
      { status: 400 },
    );
  }
}
