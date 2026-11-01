import { createClient } from "@supabase/supabase-js";
import { isManagementRole } from "../../../lib/moduleAccess.js";
import { loadLiveMisReport } from "../../../lib/misReportServer.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseAsOfDate(value) {
  const date = String(value || getKsaDateString()).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid asOf date. Use YYYY-MM-DD.");
  }
  return date;
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
    const report = await loadLiveMisReport(admin, { asOfDate });

    return Response.json({ success: true, report });
  } catch (error) {
    console.error("MIS report error", error);
    return Response.json(
      { success: false, error: error?.message || "Unable to load MIS report" },
      { status: 400 },
    );
  }
}
