import { createClient } from "@supabase/supabase-js";
import { buildBusinessAlerts, buildBusinessKpis, daysSinceIso, summarizeOutstandingRows } from "../../lib/businessDashboard.js";
import { buildOutstandingRow } from "../../lib/outstanding.js";
import { getKsaDateString, ksaDayBounds, filterLogsByKsaEventDate } from "../../lib/workdayActivity.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";
import {
  buildBiViewerMeta,
  canViewBusinessDashboard,
  filterOutstandingForSalesScope,
  isBiTeamScopedViewer,
  summarizeTeamAttendance,
} from "../../lib/businessDashboardAccess.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTSTANDING_DATASET_KEY = "outstanding_customerwise_dataset_v1";

const FIELD_ROLES = new Set(["salesman", "collector"]);
const QUERY_CHUNK = 200;

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

function chunkList(items, size = QUERY_CHUNK) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks.length ? chunks : [[]];
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
      return { uploadedAt: "", rows: [], invoices: [], summary: summarizeOutstandingRows([]) };
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
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    summary: summarizeOutstandingRows(rows),
  };
}

async function loadSalesTotals(admin, reportDate, salesmanCodes = null) {
  const monthStart = monthStartDate(reportDate);
  const codeChunks = salesmanCodes == null ? [null] : chunkList(salesmanCodes);

  if (Array.isArray(salesmanCodes) && salesmanCodes.length === 0) {
    const batchResult = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "active_sales_batch_id")
      .maybeSingle();
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
    return { salesToday: 0, salesMtd: 0, salesImportStaleDays };
  }

  let salesToday = 0;
  let salesMtd = 0;
  let batchResult = null;

  for (const codeChunk of codeChunks) {
    let todayQuery = admin.from("active_sales").select("sales_amount").eq("transaction_date", reportDate);
    let mtdQuery = admin
      .from("active_sales")
      .select("sales_amount")
      .gte("transaction_date", monthStart)
      .lte("transaction_date", reportDate);

    if (codeChunk) {
      todayQuery = todayQuery.in("salesman_code", codeChunk);
      mtdQuery = mtdQuery.in("salesman_code", codeChunk);
    }

    const [todayResult, mtdResult, nextBatch] = await Promise.all([
      todayQuery,
      mtdQuery,
      batchResult
        ? Promise.resolve(batchResult)
        : admin.from("system_settings").select("setting_value").eq("setting_key", "active_sales_batch_id").maybeSingle(),
    ]);

    batchResult = nextBatch;
    if (todayResult.error && !isMissingTableError(todayResult.error)) throw todayResult.error;
    if (mtdResult.error && !isMissingTableError(mtdResult.error)) throw mtdResult.error;

    salesToday += (todayResult.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);
    salesMtd += (mtdResult.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);
  }

  let salesImportStaleDays = null;
  const batchId = String(batchResult?.data?.setting_value || "").trim();
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

async function loadCollectionTotals(admin, startIso, endIso, monthStartIso, userIds = null) {
  if (Array.isArray(userIds) && userIds.length === 0) {
    return { collectedToday: 0, collectedMtd: 0, collectionsCount: 0, dayRows: [] };
  }

  const idChunks = userIds == null ? [null] : chunkList(userIds);
  let dayRows = [];
  let collectedMtd = 0;

  for (const idChunk of idChunks) {
    let dayQuery = admin
      .from("collection_visits")
      .select("amount_received,visit_outcome,created_by,saved_at")
      .gte("saved_at", startIso)
      .lte("saved_at", endIso);
    let mtdQuery = admin
      .from("collection_visits")
      .select("amount_received")
      .gte("saved_at", monthStartIso)
      .lte("saved_at", endIso);

    if (idChunk) {
      dayQuery = dayQuery.in("created_by", idChunk);
      mtdQuery = mtdQuery.in("created_by", idChunk);
    }

    const [dayResult, mtdResult] = await Promise.all([dayQuery, mtdQuery]);
    if (dayResult.error && !isMissingTableError(dayResult.error)) throw dayResult.error;
    if (mtdResult.error && !isMissingTableError(mtdResult.error)) throw mtdResult.error;

    dayRows = dayRows.concat(dayResult.data || []);
    collectedMtd += (mtdResult.data || []).reduce((sum, row) => sum + Number(row.amount_received || 0), 0);
  }

  return {
    collectedToday: dayRows.reduce((sum, row) => sum + Number(row.amount_received || 0), 0),
    collectedMtd,
    collectionsCount: dayRows.length,
    dayRows,
  };
}

async function loadOrderTotals(admin, startIso, endIso, userIds = null) {
  if (Array.isArray(userIds) && userIds.length === 0) {
    return {
      ordersSubmitted: 0,
      ordersDraft: 0,
      pendingOrdersTotal: 0,
      pendingOrdersOlder7: 0,
      pendingOrdersOlder30: 0,
      rows: [],
    };
  }

  const idChunks = userIds == null ? [null] : chunkList(userIds);
  let rows = [];

  for (const idChunk of idChunks) {
    let query = admin
      .from("sales_orders")
      .select("id,status,created_at,updated_at,submitted_at,created_by")
      .in("status", ["DRAFT", "SUBMITTED"]);
    if (idChunk) query = query.in("created_by", idChunk);

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) {
        return {
          ordersSubmitted: 0,
          ordersDraft: 0,
          pendingOrdersTotal: 0,
          pendingOrdersOlder7: 0,
          pendingOrdersOlder30: 0,
          rows: [],
        };
      }
      throw error;
    }
    rows = rows.concat(data || []);
  }

  const submittedToday = rows.filter((row) => {
    if (String(row.status || "").toUpperCase() !== "SUBMITTED") return false;
    const ts = Date.parse(String(row.submitted_at || row.updated_at || row.created_at || ""));
    return ts >= Date.parse(startIso) && ts <= Date.parse(endIso);
  }).length;

  const draftRows = rows.filter((row) => String(row.status || "").toUpperCase() === "DRAFT");

  return {
    ordersSubmitted: submittedToday,
    ordersDraft: draftRows.length,
    pendingOrdersTotal: draftRows.length,
    pendingOrdersOlder7: draftRows.filter((row) => daysOld(row.updated_at || row.created_at) >= 7).length,
    pendingOrdersOlder30: draftRows.filter((row) => daysOld(row.updated_at || row.created_at) >= 30).length,
    rows,
  };
}

async function loadActivityLogs(admin, startIso, endIso, reportDate, userIds = null) {
  if (Array.isArray(userIds) && userIds.length === 0) {
    return { visitReports: 0, logs: [] };
  }

  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const idChunks = userIds == null ? [null] : chunkList(userIds);
  let logs = [];

  for (const idChunk of idChunks) {
    let query = admin
      .from("daily_activity_logs")
      .select("id,user_id,entry_type,note,created_at")
      .gte("created_at", widenedStart.toISOString())
      .lte("created_at", widenedEnd.toISOString());
    if (idChunk) query = query.in("user_id", idChunk);

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return { visitReports: 0, logs: [] };
      throw error;
    }
    logs = logs.concat(data || []);
  }

  const filtered = filterLogsByKsaEventDate(logs, reportDate);
  return {
    visitReports: filtered.filter((row) => row.entry_type === "VISIT_REPORT").length,
    logs: filtered,
  };
}

function emptyAttendance() {
  return {
    users: [],
    notLoggedInUsers: [],
    idleUsers: [],
    loggedInCount: 0,
    idleNow: 0,
    activeNow: 0,
    fieldHeadcount: 0,
    routeDistanceKm: 0,
    workingHoursMinutes: 0,
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
    if (!canViewBusinessDashboard(profile)) {
      throw new Error("You do not have access to Business Intelligence.");
    }

    const scope = await resolveSalesScopeForUserId(admin, user.id);
    const viewer = buildBiViewerMeta(profile);
    const teamScoped = isBiTeamScopedViewer(profile);
    const salesmanCodes = teamScoped
      ? [...new Set((scope.visibleSalesmanCodes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))]
      : null;
    const userIds = teamScoped
      ? [...new Set((scope.visibleUserIds || []).map((id) => String(id || "").trim()).filter(Boolean))]
      : null;

    const isToday = reportDate === getKsaDateString();
    const { startIso, endIso } = ksaDayBounds(reportDate);
    const { startIso: monthStartIso } = ksaDayBounds(monthStartDate(reportDate));
    const authHeader = request.headers.get("authorization") || "";

    const [
      salesTotals,
      collectionTotals,
      orderTotals,
      activityTotals,
      outstandingRaw,
      fieldProfilesResult,
    ] = await Promise.all([
      loadSalesTotals(admin, reportDate, salesmanCodes),
      loadCollectionTotals(admin, startIso, endIso, monthStartIso, userIds),
      loadOrderTotals(admin, startIso, endIso, userIds),
      loadActivityLogs(admin, startIso, endIso, reportDate, userIds),
      loadOutstandingSummary(admin),
      admin
        .from("profiles")
        .select("id,role,salesman_name,salesman_code,email")
        .eq("is_active", true),
    ]);

    if (fieldProfilesResult.error) throw fieldProfilesResult.error;

    const outstanding = filterOutstandingForSalesScope(outstandingRaw, scope, { scoped: teamScoped });

    let allFieldProfiles = (fieldProfilesResult.data || []).filter((row) => (
      FIELD_ROLES.has(String(row.role || "").trim().toLowerCase())
    ));

    if (teamScoped) {
      const allowedIds = new Set(userIds || []);
      allFieldProfiles = allFieldProfiles.filter((row) => allowedIds.has(String(row.id || "").trim()));
    }

    let attendance;
    let collectorsActive = 0;

    if (!teamScoped) {
      const activityUrl = new URL("/api/user-activity", url.origin);
      activityUrl.searchParams.set("date", reportDate);
      const userActivityResponse = await fetch(activityUrl.toString(), {
        headers: { Authorization: authHeader },
        cache: "no-store",
      });
      const userActivityPayload = await userActivityResponse.json().catch(() => ({}));
      if (!userActivityResponse.ok || !userActivityPayload.success) {
        throw new Error(userActivityPayload.error || "Unable to load user activity for dashboard.");
      }

      const activityUsers = Array.isArray(userActivityPayload.users) ? userActivityPayload.users : [];
      const fieldUsers = activityUsers.filter((row) => FIELD_ROLES.has(String(row.role || "").trim().toLowerCase()));

      attendance = {
        users: fieldUsers,
        notLoggedInUsers: fieldUsers
          .filter((row) => row.activityStatus === "not_logged_in")
          .map((row) => row.userName || row.email || row.salesmanCode || "User"),
        idleUsers: fieldUsers
          .filter((row) => row.activityStatus === "idle")
          .map((row) => row.userName || row.email || row.salesmanCode || "User"),
        loggedInCount: fieldUsers.filter((row) => row.activityStatus !== "not_logged_in").length,
        idleNow: userActivityPayload.totals?.idleNow || 0,
        activeNow: userActivityPayload.totals?.activeNow || 0,
        fieldHeadcount: allFieldProfiles.length,
        routeDistanceKm: userActivityPayload.totals?.routeDistanceKm || 0,
        workingHoursMinutes: userActivityPayload.totals?.workingHoursMinutes || 0,
      };
      collectorsActive = allFieldProfiles.filter((row) => String(row.role || "").trim().toLowerCase() === "collector").length;
    } else {
      const team = summarizeTeamAttendance({
        profiles: allFieldProfiles,
        logs: activityTotals.logs,
        collections: collectionTotals.dayRows,
        orders: orderTotals.rows,
        reportDate,
        isToday,
      });
      attendance = {
        ...team,
        routeDistanceKm: 0,
        workingHoursMinutes: 0,
      };
      collectorsActive = allFieldProfiles.filter((row) => String(row.role || "").trim().toLowerCase() === "collector").length;
    }

    if (!attendance) attendance = emptyAttendance();

    const fieldHeadcount = attendance.fieldHeadcount || allFieldProfiles.length;
    const loggedInCount = attendance.loggedInCount || 0;

    const kpiInput = {
      salesToday: salesTotals.salesToday,
      salesMtd: salesTotals.salesMtd,
      collectedToday: collectionTotals.collectedToday,
      collectedMtd: collectionTotals.collectedMtd,
      visitReports: activityTotals.visitReports,
      collectionsCount: collectionTotals.collectionsCount,
      ordersSubmitted: orderTotals.ordersSubmitted,
      ordersDraft: orderTotals.ordersDraft,
      fieldHeadcount,
      loggedInCount,
      idleNow: attendance.idleNow || 0,
      activeNow: attendance.activeNow || 0,
      pendingOrdersTotal: orderTotals.pendingOrdersTotal,
      pendingOrdersOlder7: orderTotals.pendingOrdersOlder7,
      pendingOrdersOlder30: orderTotals.pendingOrdersOlder30,
      outstandingTotal: outstanding.summary.totalOutstanding,
      outstandingAbove90: outstanding.summary.above90,
      routeDistanceKm: attendance.routeDistanceKm || 0,
      workingHoursMinutes: attendance.workingHoursMinutes || 0,
    };

    const attendanceRate = fieldHeadcount > 0
      ? Math.round((loggedInCount / fieldHeadcount) * 100)
      : 0;

    const alerts = buildBusinessAlerts({
      reportDate,
      isToday,
      notLoggedInUsers: attendance.notLoggedInUsers || [],
      idleUsers: attendance.idleUsers || [],
      pendingOrdersOlder7: orderTotals.pendingOrdersOlder7,
      pendingOrdersOlder30: orderTotals.pendingOrdersOlder30,
      outstandingStaleDays: outstanding.uploadedAt ? daysSinceIso(outstanding.uploadedAt) : 999,
      outstandingUploadedAt: outstanding.uploadedAt,
      collectorsActive,
      collectedToday: collectionTotals.collectedToday,
      collectionVisitsToday: collectionTotals.collectionsCount,
      attendanceRate,
      fieldHeadcount,
      salesImportStaleDays: salesTotals.salesImportStaleDays,
      draftOrders: orderTotals.ordersDraft,
      outstandingAbove90: outstanding.summary.above90,
    });

    return Response.json({
      success: true,
      date: reportDate,
      isToday,
      timezone: "Asia/Riyadh",
      viewer,
      kpis: buildBusinessKpis(kpiInput),
      alerts,
      meta: {
        outstandingUploadedAt: outstanding.uploadedAt || null,
        outstandingFileName: outstanding.fileName || null,
        customersWithOutstanding: outstanding.summary.customersWithDue,
        redAlerts: alerts.filter((row) => row.severity === "red").length,
        orangeAlerts: alerts.filter((row) => row.severity === "orange").length,
        fieldHeadcount,
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
