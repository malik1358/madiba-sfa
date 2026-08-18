import { createClient } from "@supabase/supabase-js";
import {
  formatCollectorDisplayName,
  parseGpsFromActivityNote,
  summarizeRouteDistanceKm,
} from "../../lib/geo.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
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

function canViewAllUsers(profile) {
  const role = normalizeRole(profile?.role);
  return role === "admin" || role === "manager" || role === "collector";
}

function parseReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

function gpsPointFromLog(row) {
  const gps = parseGpsFromActivityNote(row?.note);
  if (!gps?.latitude || !gps?.longitude) return null;

  return {
    latitude: gps.latitude,
    longitude: gps.longitude,
    saved_at: gps.capturedAt || row.created_at,
  };
}

function buildUserActivityRow(profile, authUser, logs, collections, orders) {
  const userId = profile.id;
  const userLogs = logs.filter((row) => row.user_id === userId);
  const userCollections = collections.filter((row) => row.created_by === userId);
  const userOrders = orders.filter((row) => row.created_by === userId);

  const loginLog = userLogs.find((row) => row.entry_type === "MORNING_ATTENDANCE");
  const logoutLog = [...userLogs].reverse().find((row) => row.entry_type === "END_OF_DAY");
  const firstLog = userLogs[0] || null;
  const lastLog = userLogs[userLogs.length - 1] || null;

  const visitReports = userLogs.filter((row) => row.entry_type === "VISIT_REPORT").length;
  const orderDraftEvents = userLogs.filter((row) => ["ORDER_DRAFT", "ORDER_EDITED"].includes(row.entry_type)).length;
  const orderSubmitEvents = userLogs.filter((row) => row.entry_type === "ORDER_SUBMITTED").length;
  const prospectFollowUps = userLogs.filter((row) => row.entry_type === "PROSPECT_FOLLOW_UP").length;

  const submittedOrders = userOrders.filter((row) => String(row.status || "").toUpperCase() === "SUBMITTED").length;
  const draftOrders = userOrders.filter((row) => String(row.status || "").toUpperCase() === "DRAFT").length;

  const gpsPoints = userLogs.map(gpsPointFromLog).filter(Boolean);
  const routeDistanceKm = summarizeRouteDistanceKm(
    gpsPoints.map((point, index) => ({
      id: `gps-${index}`,
      saved_at: point.saved_at,
      latitude: point.latitude,
      longitude: point.longitude,
    })),
  );

  const loginAt = loginLog?.created_at
    || authUser?.last_sign_in_at
    || firstLog?.created_at
    || null;
  const logoutAt = logoutLog?.created_at || null;
  const lastActivityAt = lastLog?.created_at
    || userCollections[userCollections.length - 1]?.saved_at
    || userOrders[userOrders.length - 1]?.updated_at
    || null;

  const hasActivity = userLogs.length > 0
    || userCollections.length > 0
    || userOrders.length > 0
    || Boolean(loginAt);

  return {
    userId,
    userName: formatCollectorDisplayName(profile),
    role: profile.role || "",
    email: profile.email || authUser?.email || "",
    salesmanCode: profile.salesman_code || "",
    loginAt,
    logoutAt,
    lastSignInAt: authUser?.last_sign_in_at || null,
    lastActivityAt,
    visitReports,
    collections: userCollections.length,
    ordersSubmitted: Math.max(orderSubmitEvents, submittedOrders),
    ordersDraft: Math.max(orderDraftEvents, draftOrders),
    prospectFollowUps,
    gpsPingCount: userLogs.filter((row) => row.entry_type === "GPS_PING").length,
    routeDistanceKm,
    totalActivities: userLogs.length,
    hasActivity,
  };
}

async function loadActivityLogs(admin, startIso, endIso, userIdFilter) {
  let query = admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: true });

  if (userIdFilter) query = query.eq("user_id", userIdFilter);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return data || [];
}

async function loadCollectionVisits(admin, startIso, endIso, userIdFilter) {
  let query = admin
    .from("collection_visits")
    .select("id,created_by,saved_at")
    .gte("saved_at", startIso)
    .lte("saved_at", endIso);

  if (userIdFilter) query = query.eq("created_by", userIdFilter);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return data || [];
}

async function loadSalesOrders(admin, startIso, endIso, userIdFilter) {
  let query = admin
    .from("sales_orders")
    .select("id,created_by,status,created_at,updated_at,submitted_at")
    .gte("updated_at", startIso)
    .lte("updated_at", endIso);

  if (userIdFilter) query = query.eq("created_by", userIdFilter);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return data || [];
}

async function loadAuthUsersForIds(admin, userIds) {
  const map = new Map();
  const ids = [...new Set((userIds || []).filter(Boolean))];

  await Promise.all(ids.map(async (id) => {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (!error && data?.user) {
      map.set(id, data.user);
    }
  }));

  return map;
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
    const date = parseReportDate(url.searchParams.get("date") || new Date().toISOString().slice(0, 10));
    const userId = String(url.searchParams.get("userId") || "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllUsers(profile);
    const restrictToSelf = !viewAll;
    const userIdFilter = userId || (restrictToSelf ? user.id : "");

    if (!viewAll && userId && userId !== user.id) {
      throw new Error("You do not have access to other users' activity.");
    }

    const startIso = `${date}T00:00:00.000Z`;
    const endIso = `${date}T23:59:59.999Z`;

    const [logs, collections, orders] = await Promise.all([
      loadActivityLogs(admin, startIso, endIso, userIdFilter || null),
      loadCollectionVisits(admin, startIso, endIso, userIdFilter || null),
      loadSalesOrders(admin, startIso, endIso, userIdFilter || null),
    ]);

    const activeUserIds = [...new Set([
      ...logs.map((row) => row.user_id),
      ...collections.map((row) => row.created_by),
      ...orders.map((row) => row.created_by),
      ...(userIdFilter ? [userIdFilter] : []),
    ].filter(Boolean))];

    const { data: profiles, error: profilesError } = activeUserIds.length
      ? await admin
        .from("profiles")
        .select("id,role,salesman_code,salesman_name,email,is_active")
        .in("id", activeUserIds)
      : { data: [], error: null };

    if (profilesError) throw profilesError;

    const authUserMap = await loadAuthUsersForIds(admin, activeUserIds);

    const users = (profiles || [])
      .map((row) => buildUserActivityRow(row, authUserMap.get(row.id), logs, collections, orders))
      .filter((row) => row.hasActivity)
      .sort((left, right) => left.userName.localeCompare(right.userName));

    return Response.json({
      success: true,
      date,
      userCount: users.length,
      totals: {
        visitReports: users.reduce((sum, row) => sum + row.visitReports, 0),
        collections: users.reduce((sum, row) => sum + row.collections, 0),
        ordersSubmitted: users.reduce((sum, row) => sum + row.ordersSubmitted, 0),
        routeDistanceKm: users.reduce((sum, row) => sum + Number(row.routeDistanceKm || 0), 0),
      },
      availableUsers: users.map((row) => ({
        userId: row.userId,
        userName: row.userName,
      })),
      users,
    });
  } catch (error) {
    console.error("Error building user activity report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load user activity report" },
      { status: 400 },
    );
  }
}
