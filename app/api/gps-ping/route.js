import { createClient } from "@supabase/supabase-js";
import { buildGpsActivityNote } from "../../lib/geo.js";
import { shouldRequireTransactionGps } from "../../lib/moduleAccess.js";
import {
  isWithinActiveWorkSession,
  ksaDayBounds,
  getKsaDateString,
  logEventTimestamp,
} from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
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

function parseLocation(body) {
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracy = Number(body?.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Valid latitude and longitude are required.");
  }

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: Number.isFinite(accuracy) ? Number(accuracy.toFixed(1)) : null,
  };
}

async function hasEndedWorkday(admin, userId) {
  const reportDate = getKsaDateString();
  const { startIso, endIso } = ksaDayBounds(reportDate);

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("entry_type", "END_OF_DAY")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function loadActiveWorkSession(admin, userId) {
  const reportDate = getKsaDateString();
  const { startIso, endIso } = ksaDayBounds(reportDate);

  const { data: logs, error } = await admin
    .from("daily_activity_logs")
    .select("entry_type,note,created_at")
    .eq("user_id", userId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = logs || [];
  const loginLog = rows.find((row) => row.entry_type === "MORNING_ATTENDANCE");
  const logoutLog = [...rows].reverse().find((row) => row.entry_type === "END_OF_DAY");

  return {
    loginAt: loginLog
      ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString()
      : null,
    logoutAt: logoutLog
      ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString()
      : null,
    userLogs: rows,
  };
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const location = parseLocation(body);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!shouldRequireTransactionGps(normalizeRole(profile?.role))) {
      return Response.json({ success: true, skipped: true, reason: "role_exempt" });
    }

    const workSession = await loadActiveWorkSession(admin, user.id);
    if (!isWithinActiveWorkSession(workSession)) {
      return Response.json({ success: true, skipped: true, reason: "outside_active_work_session" });
    }

    if (await hasEndedWorkday(admin, user.id)) {
      return Response.json({ success: true, skipped: true, reason: "workday_ended" });
    }

    const source = String(body?.source || "native_idle").trim() || "native_idle";
    const { error: insertError } = await admin.from("daily_activity_logs").insert({
      user_id: user.id,
      entry_type: "GPS_PING",
      note: buildGpsActivityNote("GPS_PING", location, { source }),
    });

    if (insertError) throw insertError;

    return Response.json({
      success: true,
      captured_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to save GPS ping." },
      { status: 400 },
    );
  }
}
