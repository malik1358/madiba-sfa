import { isManagementRole } from "../../lib/moduleAccess.js";
import { createClient } from "@supabase/supabase-js";
import { loadInactivityEmailLog } from "../../lib/inactivityEmailServer.js";
import {
  resolveSubordinateUserIds,
  resolveVisitReportAudience,
} from "../../lib/salesHierarchy.js";
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
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

function canViewAllUsers(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return isManagementRole(role) || role === "collector";
}

function parseReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

async function loadSubordinateIds(admin, profile, viewAll) {
  if (viewAll) return new Set();

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role")
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  return resolveSubordinateUserIds(
    usersRes.data?.users || [],
    profile,
    profilesRes.data || [],
  );
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
    const subordinateIds = await loadSubordinateIds(admin, profile, viewAll);
    const audience = resolveVisitReportAudience({
      actorUserId: user.id,
      requestedUserId: userId,
      viewAll,
      subordinateIds,
    });

    if (!audience.allowed) {
      throw new Error("You do not have access to other users' inactivity email logs.");
    }

    const log = await loadInactivityEmailLog(admin, {
      reportDate: date,
      userId: typeof audience.userIdFilter === "string" ? audience.userIdFilter : user.id,
    });

    return Response.json({
      success: true,
      ...log,
    });
  } catch (error) {
    console.error("Error loading inactivity email log:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load inactivity email log" },
      { status: 400 },
    );
  }
}
