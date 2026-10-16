import { createClient } from "@supabase/supabase-js";
import { canViewManagementReports } from "../../../lib/moduleAccess.js";
import { loadReceivableDaysReport } from "../../../lib/receivableDaysServer.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";
import { salesDateKey } from "../../../lib/categoryGrowth.js";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function canViewDashboard(profile) {
  return canViewManagementReports(profile?.role);
}

async function buildResponse(request, body = {}) {
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
  }

  const user = await getAuthUser(request);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profile = await getProfile(admin, user.id);
  if (!canViewDashboard(profile)) {
    throw new Error("Only admin and manager users can view receivable days.");
  }

  const asOfDate = getKsaDateString();
  const report = await loadReceivableDaysReport(admin, {
    asOfDate,
    dateFrom: salesDateKey(body?.dateFrom || body?.filters?.dateFrom),
    dateTo: salesDateKey(body?.dateTo || body?.filters?.dateTo),
  });

  return Response.json({
    success: true,
    timezone: "Asia/Riyadh",
    asOfDate,
    ...report,
  });
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    return await buildResponse(request, {
      dateFrom: url.searchParams.get("dateFrom") || "",
      dateTo: url.searchParams.get("dateTo") || "",
    });
  } catch (error) {
    console.error("Error building receivable days report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load receivable days." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return await buildResponse(request, body || {});
  } catch (error) {
    console.error("Error building receivable days report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load receivable days." },
      { status: 400 },
    );
  }
}
