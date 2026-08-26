import { createClient } from "@supabase/supabase-js";
import { runAutoCloseWorkdaysCycle } from "../../lib/autoCloseWorkdaysServer.js";
import {
  formatCollectorDisplayName,
  parseGpsFromActivityNote,
  summarizeRouteDistanceKm,
} from "../../lib/geo.js";
import {
  calculateWorkingHoursMinutes,
  deriveActivityStatus,
  extractLunchTimes,
  filterLogsByKsaEventDate,
  formatWorkingHours,
  getKsaDateString,
  ksaDayBounds,
  logEventIso,
  logEventTimestamp,
} from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIELD_ROLES = new Set([
  "admin",
  "manager",
  "salesman",
  "collector",
  "invoice-maker",
  "invoice_maker",
  "product-promoter",
  "product_promoter",
]);

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

function buildUserActivityRow(profile, logs, collections, orders, reportDate, options = {}) {
  const userId = profile.id;
  const userLogs = filterLogsByKsaEventDate(logs.filter((row) => row.user_id === userId), reportDate);
  const userCollections = collections.filter((row) => row.created_by === userId);
  const userOrders = orders.filter((row) => row.created_by === userId);

  const loginLog = userLogs.find((row) => row.entry_type === "MORNING_ATTENDANCE");
  const logoutLog = [...userLogs].reverse().find((row) => row.entry_type === "END_OF_DAY");
  const autoLogoutLog = logoutLog && (() => {
    try {
      const parsed = JSON.parse(String(logoutLog.note || ""));
      return Boolean(parsed?.autoClosed);
    } catch {
      return false;
    }
  })();

  const { lunchOutAt, lunchInAt } = extractLunchTimes(userLogs);

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

  const loginAt = loginLog
    ? logEventIso(loginLog)
    : null;
  const logoutAt = logoutLog ? logEventIso(logoutLog) : null;

  const lastActivityTs = Math.max(
    ...userLogs.map((row) => logEventTimestamp(row)),
    ...userCollections.map((row) => Date.parse(String(row.saved_at || "")) || 0),
    ...userOrders.map((row) => Date.parse(String(row.updated_at || row.submitted_at || row.created_at || "")) || 0),
    0,
  );
  const lastActivityAt = lastActivityTs ? new Date(lastActivityTs).toISOString() : null;

  const activityStatus = deriveActivityStatus({
    loginAt,
    logoutAt,
    userLogs,
    collections: userCollections,
    orders: userOrders,
    reportDate,
  });

  const hasActivity = userLogs.length > 0
    || userCollections.length > 0
    || userOrders.length > 0
    || Boolean(loginAt);

  const workingHoursMinutes = calculateWorkingHoursMinutes({
    loginAt,
    lunchOutAt,
    lunchInAt,
    logoutAt,
    openEndedAt: !logoutAt && options.isToday ? new Date().toISOString() : null,
  });

  return {
    userId,
    userName: formatCollectorDisplayName(profile),
    role: profile.role || "",
    email: profile.email || "",
    salesmanCode: profile.salesman_code || "",
    loginAt,
    logoutAt,
    logoutAutoClosed: autoLogoutLog,
    lunchOutAt,
    lunchInAt,
    workingHoursMinutes,
    workingHoursLabel: formatWorkingHours(workingHoursMinutes),
    lastActivityAt,
    visitReports,
    collections: userCollections.length,
    ordersSubmitted: Math.max(orderSubmitEvents, submittedOrders),
    ordersDraft: Math.max(orderDraftEvents, draftOrders),
    prospectFollowUps,
    gpsPingCount: userLogs.filter((row) => row.entry_type === "GPS_PING").length,
    routeDistanceKm,
    totalActivities: userLogs.length,
    activityStatus,
    hasActivity,
  };
}

async function loadActivityLogs(admin, startIso, endIso, userIdFilter, reportDate) {
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  let query = admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .gte("created_at", widenedStart.toISOString())
    .lte("created_at", widenedEnd.toISOString())
    .order("created_at", { ascending: true });

  if (userIdFilter) query = query.eq("user_id", userIdFilter);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return filterLogsByKsaEventDate(data || [], reportDate);
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

async function loadFieldProfiles(admin, userIdFilter) {
  if (userIdFilter) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name,email,is_active")
      .eq("id", userIdFilter)
      .maybeSingle();
    if (error) throw error;
    return data ? [data] : [];
  }

  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,is_active")
    .eq("is_active", true);

  if (error) throw error;

  return (data || []).filter((row) => FIELD_ROLES.has(normalizeRole(row.role)));
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

    try {
      await runAutoCloseWorkdaysCycle(admin);
    } catch (autoCloseError) {
      console.error("Auto-close workdays before user activity report failed:", autoCloseError);
    }

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllUsers(profile);
    const restrictToSelf = !viewAll;
    const userIdFilter = userId || (restrictToSelf ? user.id : "");

    if (!viewAll && userId && userId !== user.id) {
      throw new Error("You do not have access to other users' activity.");
    }

    const { startIso, endIso } = ksaDayBounds(date);

    const [logs, collections, orders, profiles] = await Promise.all([
      loadActivityLogs(admin, startIso, endIso, userIdFilter || null, date),
      loadCollectionVisits(admin, startIso, endIso, userIdFilter || null),
      loadSalesOrders(admin, startIso, endIso, userIdFilter || null),
      loadFieldProfiles(admin, userIdFilter || null),
    ]);

    const isToday = date === getKsaDateString();

    const users = profiles
      .map((row) => buildUserActivityRow(row, logs, collections, orders, date, { isToday }))
      .sort((left, right) => {
        const rank = {
          not_logged_in: 0,
          idle: 1,
          active: 2,
          on_lunch: 3,
          logged_in: 4,
          ended: 5,
        };
        const leftRank = rank[left.activityStatus] ?? 9;
        const rightRank = rank[right.activityStatus] ?? 9;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.userName.localeCompare(right.userName);
      });

    const activeUsers = users.filter((row) => row.hasActivity);

    return Response.json({
      success: true,
      date,
      timezone: "Asia/Riyadh",
      isToday: date === getKsaDateString(),
      userCount: activeUsers.length,
      totals: {
        visitReports: activeUsers.reduce((sum, row) => sum + row.visitReports, 0),
        collections: activeUsers.reduce((sum, row) => sum + row.collections, 0),
        ordersSubmitted: activeUsers.reduce((sum, row) => sum + row.ordersSubmitted, 0),
        routeDistanceKm: activeUsers.reduce((sum, row) => sum + Number(row.routeDistanceKm || 0), 0),
        workingHoursMinutes: activeUsers.reduce((sum, row) => sum + Number(row.workingHoursMinutes || 0), 0),
        notLoggedIn: users.filter((row) => row.activityStatus === "not_logged_in").length,
        idleNow: users.filter((row) => row.activityStatus === "idle").length,
        activeNow: users.filter((row) => row.activityStatus === "active").length,
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
