import { createClient } from "@supabase/supabase-js";
import { canViewManagementReports } from "../../lib/moduleAccess.js";
import {
  canOpenMonthlyAttendance,
  isMonthlyAttendanceSubject,
} from "../../lib/monthlyAttendanceReport.js";
import {
  buildMonthlyAttendanceReportForUser,
  listMonthlyAttendanceSubjects,
} from "../../lib/monthlyAttendanceReportServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

function parseMonth(value, today) {
  const month = String(value || today || "").trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month. Use YYYY-MM.");
  return month;
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
    const today = getKsaDateString();
    const month = parseMonth(url.searchParams.get("month") || today, today);
    const requestedUserId = String(url.searchParams.get("userId") || "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    if (!canOpenMonthlyAttendance(profile)) {
      return Response.json(
        { success: false, error: "Not authorized" },
        { status: 403 },
      );
    }

    const canPickUsers = canViewManagementReports(profile.role);
    if (!canPickUsers && requestedUserId && requestedUserId !== user.id) {
      return Response.json(
        { success: false, error: "Not authorized to view other users" },
        { status: 403 },
      );
    }

    const availableUsers = canPickUsers ? await listMonthlyAttendanceSubjects(admin) : [];
    let userId = canPickUsers ? requestedUserId : user.id;
    if (canPickUsers && !userId) {
      userId = isMonthlyAttendanceSubject(profile)
        ? user.id
        : (availableUsers[0]?.userId || "");
    }

    if (!userId) {
      return Response.json({
        success: true,
        report: null,
        availableUsers,
        error: "No salesman or collector is available.",
      });
    }

    const report = await buildMonthlyAttendanceReportForUser(admin, {
      userId,
      month,
      today,
    });

    return Response.json({ success: true, report, availableUsers });
  } catch (error) {
    const message = error.message || "Unable to load monthly attendance";
    const status = message === "Choose a salesman or collector." ? 403 : 400;
    return Response.json({ success: false, error: message }, { status });
  }
}
