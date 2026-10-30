import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadBiOverviewBundle, rebuildSalesBiCube } from "../../../lib/categoryGrowthServer.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";
import { resolveSalesScopeForUserId } from "../../user/sales-scope/route.js";
import {
  applyBiSalesmanScope,
  buildBiViewerMeta,
  canViewBusinessDashboard,
  canViewBiProfit,
  emptyCategoryGrowthPayload,
  isBiTeamScopedViewer,
  stripBiProfit,
} from "../../../lib/businessDashboardAccess.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

function stripBundleProfit(bundle) {
  if (!bundle || typeof bundle !== "object") return bundle;
  return {
    ...bundle,
    growth: stripBiProfit(bundle.growth),
    customer: stripBiProfit(bundle.customer),
    item: stripBiProfit(bundle.item),
    salesman: stripBiProfit(bundle.salesman),
  };
}

async function buildResponse(request, filters) {
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
  }

  const user = await getAuthUser(request);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profile = await getProfile(admin, user.id);
  if (!canViewBusinessDashboard(profile)) {
    throw new Error("You do not have access to Business Intelligence.");
  }

  const scope = await resolveSalesScopeForUserId(admin, user.id);
  const viewer = buildBiViewerMeta(profile);
  const allowProfit = canViewBiProfit(profile);
  const teamScoped = isBiTeamScopedViewer(profile);
  const { filters: scopedFilters, empty } = applyBiSalesmanScope(filters, scope, profile);
  const asOfDate = getKsaDateString();

  if (empty) {
    const emptyReport = emptyCategoryGrowthPayload({ asOfDate, filters: scopedFilters });
    return Response.json({
      success: true,
      timezone: "Asia/Riyadh",
      asOfDate,
      viewer,
      growth: emptyReport,
      customer: emptyReport,
      item: emptyReport,
      salesman: emptyReport,
      catalogs: emptyReport.catalogs,
      meta: emptyReport.meta,
    });
  }

  const bundle = await loadBiOverviewBundle(admin, {
    asOfDate,
    filters: scopedFilters,
    catalogMatchedOnly: teamScoped,
    includeProfit: allowProfit,
  });

  if (bundle?.meta?.stale) {
    after(async () => {
      try {
        await rebuildSalesBiCube(admin);
      } catch (error) {
        console.error("Refreshing stale sales BI cube failed:", error);
      }
    });
  }

  const payload = allowProfit ? bundle : stripBundleProfit(bundle);

  return Response.json({
    success: true,
    timezone: "Asia/Riyadh",
    asOfDate,
    viewer,
    ...payload,
  });
}

export async function GET(request) {
  try {
    return await buildResponse(request, {});
  } catch (error) {
    console.error("Error building BI overview:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load business dashboard." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return await buildResponse(request, body?.filters || body || {});
  } catch (error) {
    console.error("Error building BI overview:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load business dashboard." },
      { status: 400 },
    );
  }
}
