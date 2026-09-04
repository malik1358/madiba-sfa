import { createClient } from "@supabase/supabase-js";
import { buildDailyVisitReport } from "../../lib/dailyVisitReportServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const maxDuration = 60;

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

function canViewAllUsers(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return role === "admin" || role === "manager" || role === "collector";
}

function canSendVisitReportEmail(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return role === "admin" || role === "manager";
}

function parseReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    const user = await getAuthUser(request);
    const url = new URL(request.url);
    const date = parseReportDate(url.searchParams.get("date") || getKsaDateString());
    const userId = String(url.searchParams.get("userId") || "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllUsers(profile);
    const restrictToSelf = !viewAll;
    const userIdFilter = userId || (restrictToSelf ? user.id : "");

    if (!viewAll && userId && userId !== user.id) {
      throw new Error("You do not have access to other users' visit reports.");
    }

    const report = await buildDailyVisitReport(admin, { date, userIdFilter });

    return Response.json({
      success: true,
      canSendVisitReportEmail: canSendVisitReportEmail(profile),
      ...report,
    });
  } catch (error) {
    console.error("Error building daily visit report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load daily visit report" },
      { status: 400 },
    );
  }
}
