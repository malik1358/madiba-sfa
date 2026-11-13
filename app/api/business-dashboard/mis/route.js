import { createClient } from "@supabase/supabase-js";
import { isManagementRole } from "../../../lib/moduleAccess.js";
import {
  defaultMisAsOfDate,
  buildLiveFilteredMisReport,
  loadMisFilterCatalogs,
  loadPreparedMisReport,
  rebuildPreparedMisReport,
} from "../../../lib/misReportServer.js";
import { hasActiveGrowthFilters, normalizeGrowthFilters } from "../../../lib/categoryGrowth.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 90;

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

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Supabase is not configured" }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const profile = await getProfile(admin, user.id);
    if (!isManagementRole(profile.role)) {
      return Response.json({ success: false, error: "MIS is available to admin and manager only." }, { status: 403 });
    }

    const url = new URL(request.url);
    const asOfDate = parseAsOfDate(url.searchParams.get("asOf") || url.searchParams.get("date"));
    const rebuild = wantsRebuild(url);
    const wantCatalogs = ["1", "true", "yes"].includes(String(url.searchParams.get("catalogs") || "").trim().toLowerCase());

    if (rebuild) {
      const prepared = await rebuildPreparedMisReport(admin, { asOfDate });
      const catalogs = wantCatalogs ? await loadMisFilterCatalogs(admin) : undefined;
      return Response.json({
        success: true,
        prepared: true,
        rebuilt: true,
        asOfDate: prepared.asOfDate,
        builtAt: prepared.builtAt,
        report: prepared.report,
        catalogs,
      });
    }

    if (wantCatalogs && !rebuild) {
      const catalogs = await loadMisFilterCatalogs(admin);
      const loaded = await loadPreparedMisReport(admin, { asOfDate });
      if (!loaded.report) {
        return Response.json({
          success: true,
          prepared: false,
          catalogs,
          asOfDate,
        });
      }
      return Response.json({
        success: true,
        prepared: true,
        rebuilt: false,
        asOfDate: loaded.asOfDate,
        builtAt: loaded.builtAt,
        staleRequest: Boolean(loaded.staleRequest),
        message: loaded.message || null,
        report: loaded.report,
        catalogs,
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

    return Response.json({
      success: true,
      prepared: true,
      rebuilt: false,
      asOfDate: loaded.asOfDate,
      builtAt: loaded.builtAt,
      staleRequest: Boolean(loaded.staleRequest),
      message: loaded.message || null,
      report: loaded.report,
    });
  } catch (error) {
    console.error("MIS report error", error);
    return Response.json(
      { success: false, error: error?.message || "Unable to load MIS report" },
      { status: 400 },
    );
  }

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Supabase is not configured" }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const profile = await getProfile(admin, user.id);
    if (!isManagementRole(profile.role)) {
      return Response.json({ success: false, error: "MIS is available to admin and manager only." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const asOfDate = parseAsOfDate(body?.asOf || body?.date);
    const filters = normalizeGrowthFilters(body?.filters || {});
    const live = await buildLiveFilteredMisReport(admin, {
      asOfDate,
      filters: hasActiveGrowthFilters(filters) ? filters : null,
    });

    return Response.json({
      success: true,
      prepared: false,
      live: true,
      filtered: hasActiveGrowthFilters(filters),
      asOfDate: live.asOfDate,
      builtAt: live.builtAt,
      report: live.report,
      catalogs: live.catalogs,
    });
  } catch (error) {
    console.error("MIS live filter error", error);
    return Response.json(
      { success: false, error: error?.message || "Unable to build filtered MIS" },
      { status: 400 },
    );
  }
}
