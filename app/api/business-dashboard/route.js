import { createClient } from "@supabase/supabase-js";
import { buildBusinessAlerts, buildBusinessKpis, daysSinceIso, summarizeOutstandingRows } from "../../lib/businessDashboard.js";
import { buildOutstandingRow } from "../../lib/outstanding.js";
import { getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTSTANDING_DATASET_KEY = "outstanding_customerwise_dataset_v1";

const FIELD_ROLES = new Set(["salesman", "collector"]);

function parseReportDate(value) {
  const date = String(value || getKsaDateString()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function daysOld(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
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

function canViewDashboard(profile) {
  const role = String(profile?.role || "").trim().toLowerCase();
  return role === "admin" || role === "manager";
}

function monthStartDate(reportDate) {
  return `${reportDate.slice(0, 7)}-01`;
}

async function loadOutstandingSummary(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { uploadedAt: "", rows: [], summary: summarizeOutstandingRows([]) };
    }
    throw error;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(String(data?.setting_value || "{}"));
  } catch {
    parsed = {};
  }

  const rows = Array.isArray(parsed.rows) ? parsed.rows.map(buildOutstandingRow) : [];
  return {
    uploadedAt: String(parsed.uploadedAt || ""),
    fileName: String(parsed.fileName || ""),
    rows,
    summary: summarizeOutstandingRows(rows),
  };
}

async function loadSalesTotals(admin, reportDate) {
  const monthStart = monthStartDate(reportDate);

  const [todayResult, mtdResult, batchResult] = await Promise.all([
    admin.from("active_sales").select("sales_amount").eq("transaction_date", reportDate),
    admin.from("active_sales").select("sales_amount").gte("transaction_date", monthStart).lte("transaction_date", reportDate),
    admin.from("system_settings").select("setting_value").eq("setting_key", "active_sales_batch_id").maybeSingle(),
  ]);

  if (todayResult.error && !isMissingTableError(todayResult.error)) throw todayResult.error;
  if (mtdResult.error && !isMissingTableError(mtdResult.error)) throw mtdResult.error;

  const salesToday = (todayResult.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);
  const salesMtd = (mtdResult.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);

  let salesImportStaleDays = null;
  const batchId = String(batchResult.data?.setting_value || "").trim();
  if (batchId) {
    const { data: batch } = await admin
      .from("import_batches")
      .select("updated_at,created_at")
      .eq("id", batchId)
      .maybeSingle();
    const batchDate = batch?.updated_at || batch?.created_at || null;
    salesImportStaleDays = batchDate ? daysSinceIso(batchDate) : null;
  }

  return { salesToday, salesMtd, salesImportStaleDays };
}

async function loadCollectionTotals(admin, startIso, endIso, monthStartIso) {
  const [dayResult, mtdResult] = await Promise.all([
    admin
      .from("collection_visits")
      .select("amount_received,visit_outcome")
      .gte("saved_at", startIso)
      .lte("saved_at", endIso),
    admin
      .from("collection_visits")
      .select("amount_received")
      .gte("saved_at", monthStartIso)
      .lte("saved_at", endIso),
  ]);

  if (dayResult.error && !isMissingTableError(dayResult.error)) throw dayResult.error;
  if (mtdResult.error && !isMissingTableError(mtdResult.error)) throw mtdResult.error;

  const dayRows = dayResult.data || [];
  const collectedToday = dayRows.reduce((sum, row) => sum + Number(row.amount_received || 0), 0);

  return {
    collectedToday,
    collectedMtd: (mtdResult.data || []).reduce((sum, row) => sum + Number(row.amount_received || 0), 0),
    collectionsCount: dayRows.length,
  };
}

async function loadOrderTotals(admin, startIso, endIso) {
  const { data, error } = await admin
    .from("sales_orders")
    .select("id,status,created_at,updated_at,submitted_at")
    .in("status", ["DRAFT", "SUBMITTED"]);

  if (error) {
    if (isMissingTableError(error)) {
      return {
        ordersSubmitted: 0,
        ordersDraft: 0,
        pendingOrdersTotal: 0,
        pendingOrdersOlder7: 0,
        pendingOrdersOlder30: 0,
      };
    }
    throw error;
  }

  const rows = data || [];
  const submittedToday = rows.filter((row) => {
    if (String(row.status || "").toUpperCase() !== "SUBMITTED") return false;
    const ts = Date.parse(String(row.submitted_at || row.updated_at || row.created_at || ""));
    return ts >= Date.parse(startIso) && ts <= Date.parse(endIso);
  }).length;

  const draftRows = rows.filter((row) => String(row.status || "").toUpperCase() === "DRAFT");
  const pendingRows = rows.filter((row) => String(row.status || "").toUpperCase() === "DRAFT");

  return {
    ordersSubmitted: submittedToday,
    ordersDraft: draftRows.length,
    pendingOrdersTotal: pendingRows.length,
    pendingOrdersOlder7: pendingRows.filter((row) => daysOld(row.updated_at || row.created_at) >= 7).length,
    pendingOrdersOlder30: pendingRows.filter((row) => daysOld(row.updated_at || row.created_at) >= 30).length,
  };
}

async function loadActivityTotals(admin, startIso, endIso) {
  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("entry_type")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (error) {
    if (isMissingTableError(error)) return { visitReports: 0 };
    throw error;
  }

  return {
    visitReports: (data || []).filter((row) => row.entry_type === "VISIT_REPORT").length,
  };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const url = new URL(request.url);
    const reportDate = parseReportDate(url.searchParams.get("date"));

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    if (!canViewDashboard(profile)) {
      throw new Error("Only admin and manager users can view the business dashboard.");
    }

    const isToday = reportDate === getKsaDateString();
    const { startIso, endIso } = ksaDayBounds(reportDate);
    const { startIso: monthStartIso } = ksaDayBounds(monthStartDate(reportDate));

    const activityUrl = new URL("/api/user-activity", url.origin);
    activityUrl.searchParams.set("date", reportDate);

    const authHeader = request.headers.get("authorization") || "";

    const [
      salesTotals,
      collectionTotals,
      orderTotals,
      activityTotals,
      outstanding,
      userActivityResponse,
      fieldProfilesResult,
    ] = await Promise.all([
      loadSalesTotals(admin, reportDate),
      loadCollectionTotals(admin, startIso, endIso, monthStartIso),
      loadOrderTotals(admin, startIso, endIso),
      loadActivityTotals(admin, startIso, endIso),
      loadOutstandingSummary(admin),
      fetch(activityUrl.toString(), {
        headers: { Authorization: authHeader },
        cache: "no-store",
      }),
      admin
        .from("profiles")
        .select("id,role,salesman_name,salesman_code,email")
        .eq("is_active", true),
    ]);

    if (fieldProfilesResult.error) throw fieldProfilesResult.error;

    const userActivityPayload = await userActivityResponse.json().catch(() => ({}));
    if (!userActivityResponse.ok || !userActivityPayload.success) {
      throw new Error(userActivityPayload.error || "Unable to load user activity for dashboard.");
    }

    const fieldProfiles = (fieldProfilesResult.data || []).filter((row) => FIELD_ROLES.has(String(row.role || "").trim().toLowerCase()));
    const activityUsers = Array.isArray(userActivityPayload.users) ? userActivityPayload.users : [];
    const fieldUsers = activityUsers.filter((row) => FIELD_ROLES.has(String(row.role || "").trim().toLowerCase()));

    const notLoggedInUsers = fieldUsers
      .filter((row) => row.activityStatus === "not_logged_in")
      .map((row) => row.userName || row.email || row.salesmanCode || "User");

    const idleUsers = fieldUsers
      .filter((row) => row.activityStatus === "idle")
      .map((row) => row.userName || row.email || row.salesmanCode || "User");

    const loggedInCount = fieldUsers.filter((row) => row.activityStatus !== "not_logged_in").length;
    const collectorsActive = fieldProfiles.filter((row) => String(row.role || "").trim().toLowerCase() === "collector").length;

    const kpiInput = {
      salesToday: salesTotals.salesToday,
      salesMtd: salesTotals.salesMtd,
      collectedToday: collectionTotals.collectedToday,
      collectedMtd: collectionTotals.collectedMtd,
      visitReports: activityTotals.visitReports,
      collectionsCount: collectionTotals.collectionsCount,
      ordersSubmitted: orderTotals.ordersSubmitted,
      ordersDraft: orderTotals.ordersDraft,
      fieldHeadcount: fieldProfiles.length,
      loggedInCount,
      idleNow: userActivityPayload.totals?.idleNow || 0,
      activeNow: userActivityPayload.totals?.activeNow || 0,
      pendingOrdersTotal: orderTotals.pendingOrdersTotal,
      pendingOrdersOlder7: orderTotals.pendingOrdersOlder7,
      pendingOrdersOlder30: orderTotals.pendingOrdersOlder30,
      outstandingTotal: outstanding.summary.totalOutstanding,
      outstandingAbove90: outstanding.summary.above90,
      routeDistanceKm: userActivityPayload.totals?.routeDistanceKm || 0,
      workingHoursMinutes: userActivityPayload.totals?.workingHoursMinutes || 0,
    };

    const attendanceRate = fieldProfiles.length > 0
      ? Math.round((loggedInCount / fieldProfiles.length) * 100)
      : 0;

    const alerts = buildBusinessAlerts({
      reportDate,
      isToday,
      notLoggedInUsers,
      idleUsers,
      pendingOrdersOlder7: orderTotals.pendingOrdersOlder7,
      pendingOrdersOlder30: orderTotals.pendingOrdersOlder30,
      outstandingStaleDays: outstanding.uploadedAt ? daysSinceIso(outstanding.uploadedAt) : 999,
      outstandingUploadedAt: outstanding.uploadedAt,
      collectorsActive,
      collectedToday: collectionTotals.collectedToday,
      collectionVisitsToday: collectionTotals.collectionsCount,
      attendanceRate,
      fieldHeadcount: fieldProfiles.length,
      salesImportStaleDays: salesTotals.salesImportStaleDays,
      draftOrders: orderTotals.ordersDraft,
      outstandingAbove90: outstanding.summary.above90,
    });

    return Response.json({
      success: true,
      date: reportDate,
      isToday,
      timezone: "Asia/Riyadh",
      kpis: buildBusinessKpis(kpiInput),
      alerts,
      meta: {
        outstandingUploadedAt: outstanding.uploadedAt || null,
        outstandingFileName: outstanding.fileName || null,
        customersWithOutstanding: outstanding.summary.customersWithDue,
        redAlerts: alerts.filter((row) => row.severity === "red").length,
        orangeAlerts: alerts.filter((row) => row.severity === "orange").length,
        fieldHeadcount: fieldProfiles.length,
        attendanceRate,
      },
    });
  } catch (error) {
    console.error("Error building business dashboard:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load business dashboard." },
      { status: 400 },
    );
  }
}
