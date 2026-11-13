import { createClient } from "@supabase/supabase-js";
import { isManagementRole } from "../../../lib/moduleAccess.js";
import { hasActiveGrowthFilters, normalizeGrowthFilters } from "../../../lib/misFilters.js";
import {
  buildFilteredMisReport,
  defaultMisAsOfDate,
  loadMisFilterCatalogs,
  loadPreparedMisReport,
  rebuildPreparedMisReport,
} from "../../../lib/misReportServer.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseAsOfDate(value) {
  const date = String(value || defaultMisAsOfDate(getKsaDateString()) || getKsaDateString()).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid asOf date. Use YYYY-MM-DD.");
  }
  return date;
}

function wantsRebuild(url) {
  const raw = String(url.searchParams.get("rebuild") || url.searchParams.get("refresh") || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
  }
  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

async function getProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

async function requireMisAccess(request) {
  if (!supabaseUrl || !serviceKey) {
    const error = new Error("Supabase is not configured");
    error.status = 500;
    throw error;
  }
  const user = await getAuthUser(request);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profile = await getProfile(admin, user.id);
  if (!isManagementRole(profile.role)) {
    const error = new Error("MIS is available to admin and manager only.");
    error.status = 403;
    throw error;
  }
  return { admin, profile, user };
}

export async function GET(request) {
  try {
    const { admin } = await requireMisAccess(request);
    const url = new URL(request.url);
    const asOfDate = parseAsOfDate(url.searchParams.get("asOf") || url.searchParams.get("date"));
    const rebuild = wantsRebuild(url);

    if (rebuild) {
      const prepared = await rebuildPreparedMisReport(admin, { asOfDate });
      const catalogs = await loadMisFilterCatalogs(admin, { asOfDate }).catch(() => ({}));
      return Response.json({
        success: true,
        prepared: true,
        rebuilt: true,
        filtered: false,
        asOfDate: prepared.asOfDate,
        builtAt: prepared.builtAt,
        catalogs,
        report: prepared.report,
      });
    }

    const loaded = await loadPreparedMisReport(admin, { asOfDate });
    if (!loaded.report) {
      return Response.json({
        success: false,
        prepared: false,
        code: "MIS_NOT_PREPARED",
        asOfDate,
        error: "Month-end MIS is not prepared yet. Tap Refresh to build it once in the backend.",
      }, { status: 404 });
    }

    const catalogs = await loadMisFilterCatalogs(admin, { asOfDate }).catch(() => ({}));
    return Response.json({
      success: true,
      prepared: true,
      rebuilt: false,
      filtered: false,
      asOfDate: loaded.asOfDate,
      builtAt: loaded.builtAt,
      staleRequest: Boolean(loaded.staleRequest),
      message: loaded.message || null,
      catalogs,
      report: loaded.report,
    });
  } catch (error) {
    console.error("MIS report error", error);
    return Response.json(
      { success: false, error: error?.message || "Unable to load MIS report" },
      { status: error?.status || 400 },
    );
  }
}

/** Apply BI slice/dice filters to an ephemeral MIS pack (does not overwrite prepared). */
export async function POST(request) {
  try {
    const { admin } = await requireMisAccess(request);
    const body = await request.json().catch(() => ({}));
    const asOfDate = parseAsOfDate(body?.asOf || body?.date);
    const filters = normalizeGrowthFilters(body?.filters || {});
    if (!hasActiveGrowthFilters(filters)) {
      const loaded = await loadPreparedMisReport(admin, { asOfDate });
      const catalogs = await loadMisFilterCatalogs(admin, { asOfDate }).catch(() => ({}));
      return Response.json({
        success: true,
        prepared: true,
        rebuilt: false,
        filtered: false,
        asOfDate: loaded.asOfDate || asOfDate,
        builtAt: loaded.builtAt || "",
        catalogs,
        report: loaded.report,
      });
    }

    const report = await buildFilteredMisReport(admin, { asOfDate, filters });
    return Response.json({
      success: true,
      prepared: false,
      rebuilt: false,
      filtered: true,
      asOfDate,
      builtAt: new Date().toISOString(),
      catalogs: report.catalogs || {},
      report,
    });
  } catch (error) {
    console.error("MIS filtered report error", error);
    return Response.json(
      { success: false, error: error?.message || "Unable to filter MIS report" },
      { status: error?.status || 400 },
    );
  }
}
