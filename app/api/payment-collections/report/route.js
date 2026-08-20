import { createClient } from "@supabase/supabase-js";
import {
  enrichVisitsWithDistances,
  formatCollectionUserDisplayName,
  formatCollectionUserRoleLabel,
  formatCollectorDisplayName,
  hasGpsCoordinates,
  isCollectionReportCollector,
  isCollectionReportSalesman,
  nearestActivityGps,
  parseGpsFromActivityNote,
  summarizeRouteDistanceKm,
} from "../../../lib/geo.js";
import { getKsaDateString, ksaDayBounds } from "../../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || message.includes("column") && message.includes("does not exist");
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
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

function canViewAllCollectors(profile) {
  const role = String(profile?.role || "").toLowerCase();
  return role === "admin" || role === "manager" || role === "collector";
}

function parseReportDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

function parseUserRoleFilter(value) {
  const role = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (role === "collector" || role === "salesman") return role;
  return "";
}

function formatOutcome(value) {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function profileMatchesUserRoleFilter(profile, userRoleFilter) {
  if (!userRoleFilter) return true;
  if (userRoleFilter === "salesman") return isCollectionReportSalesman(profile);
  if (userRoleFilter === "collector") return isCollectionReportCollector(profile);
  return true;
}

async function loadCollectionFieldUsers(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,email")
    .in("role", ["collector", "salesman"]);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadActivityGpsByUser(admin, userIds, startIso, endIso) {
  if (!userIds.length) return new Map();

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("user_id,note,created_at")
    .in("user_id", userIds)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }

  const grouped = new Map();
  (data || []).forEach((row) => {
    const gps = parseGpsFromActivityNote(row.note);
    if (!gps) return;

    const capturedTs = gps.capturedTs || new Date(row.created_at).getTime();
    const point = { ...gps, capturedTs };
    const key = row.user_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(point);
  });

  grouped.forEach((points) => {
    points.sort((left, right) => left.capturedTs - right.capturedTs);
  });

  return grouped;
}

function applyNearestActivityGpsFallback(visit, activityGpsByUser) {
  if (hasGpsCoordinates(visit)) return visit;

  const points = activityGpsByUser.get(visit.created_by) || [];
  const nearest = nearestActivityGps(points, visit.saved_at);
  if (!nearest) return visit;

  return {
    ...visit,
    latitude: nearest.latitude,
    longitude: nearest.longitude,
    gps_accuracy_meters: nearest.accuracy,
    gpsSource: "activity_log_fallback",
  };
}

const VISIT_SELECT_WITH_GPS = "id,customer_code,visit_outcome,payment_status,amount_received,next_visit_at,saved_at,latitude,longitude,gps_accuracy_meters,created_by";
const VISIT_SELECT_WITHOUT_GPS = "id,customer_code,visit_outcome,payment_status,amount_received,next_visit_at,saved_at,created_by";

async function queryCollectionVisits(admin, {
  startIso,
  endIso,
  collectorId,
  userId,
  restrictToUser,
  includeGps,
}) {
  const selectFields = includeGps ? VISIT_SELECT_WITH_GPS : VISIT_SELECT_WITHOUT_GPS;
  let visitQuery = admin
    .from("collection_visits")
    .select(selectFields)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso)
    .order("saved_at", { ascending: true });

  if (collectorId) {
    visitQuery = visitQuery.eq("created_by", collectorId);
  } else if (restrictToUser) {
    visitQuery = visitQuery.eq("created_by", userId);
  }

  const { data, error } = await visitQuery;
  return { data, error };
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
    const collectorId = String(url.searchParams.get("collectorId") || "").trim();
    const userRoleFilter = parseUserRoleFilter(url.searchParams.get("userRole"));

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllCollectors(profile);

    if (!viewAll) {
      throw new Error("You do not have access to collection route reports.");
    }

    const { startIso, endIso } = ksaDayBounds(date);

    let gpsColumnsAvailable = true;

    let visitQueryResult = await queryCollectionVisits(admin, {
      startIso,
      endIso,
      collectorId,
      userId: user.id,
      restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
      includeGps: true,
    });

    if (visitQueryResult.error && isMissingColumnError(visitQueryResult.error)) {
      gpsColumnsAvailable = false;
      visitQueryResult = await queryCollectionVisits(admin, {
        startIso,
        endIso,
        collectorId,
        userId: user.id,
        restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
        includeGps: false,
      });
    }

    const { data: visits, error: visitsError } = visitQueryResult;
    if (visitsError) {
      if (isMissingTableError(visitsError)) {
        throw new Error("Collection tables are not initialized in this environment yet.");
      }
      throw visitsError;
    }

    const visitRows = Array.isArray(visits) ? visits : [];

    const { data: allDayVisits, error: allDayError } = await (String(profile.role || "").toLowerCase() === "collector"
      ? admin
        .from("collection_visits")
        .select("created_by")
        .gte("saved_at", startIso)
        .lte("saved_at", endIso)
        .eq("created_by", user.id)
      : admin
        .from("collection_visits")
        .select("created_by")
        .gte("saved_at", startIso)
        .lte("saved_at", endIso));

    if (allDayError) {
      if (isMissingTableError(allDayError)) {
        throw new Error("Collection tables are not initialized in this environment yet.");
      }
      throw allDayError;
    }

    const allCollectorIds = [...new Set((allDayVisits || []).map((row) => row.created_by).filter(Boolean))];
    const customerCodes = [...new Set(visitRows.map((row) => normalizeCode(row.customer_code)).filter(Boolean))];

    const [fieldUsers, { data: visitDayProfiles, error: visitDayProfilesError }, { data: customers, error: customersError }] = await Promise.all([
      loadCollectionFieldUsers(admin),
      allCollectorIds.length
        ? admin.from("profiles").select("id,salesman_code,salesman_name,role,email").in("id", allCollectorIds)
        : Promise.resolve({ data: [], error: null }),
      customerCodes.length
        ? admin.from("customers").select("customer_code,customer_name").in("customer_code", customerCodes)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (visitDayProfilesError) throw visitDayProfilesError;
    if (customersError && !isMissingTableError(customersError)) throw customersError;

    const profileMap = new Map();
    [...fieldUsers, ...(visitDayProfiles || [])].forEach((row) => {
      if (row?.id) profileMap.set(row.id, row);
    });
    const customerMap = new Map(
      (customers || []).map((row) => [normalizeCode(row.customer_code), row.customer_name || ""]),
    );

    const activityGpsByUser = await loadActivityGpsByUser(admin, allCollectorIds, startIso, endIso);
    const visitRowsWithGpsFallback = visitRows
      .filter((visit) => {
        if (!userRoleFilter) return true;
        const visitProfile = profileMap.get(visit.created_by) || {};
        return profileMatchesUserRoleFilter(visitProfile, userRoleFilter);
      })
      .map((visit) => applyNearestActivityGpsFallback(visit, activityGpsByUser));

    const grouped = new Map();
    visitRowsWithGpsFallback.forEach((visit) => {
      const key = visit.created_by || "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(visit);
    });

    const collectors = [...grouped.entries()].map(([createdBy, rows]) => {
      const collectorProfile = profileMap.get(createdBy) || {};
      const userName = formatCollectorDisplayName(collectorProfile);
      const userRole = String(collectorProfile.role || "").trim().toLowerCase().replace(/_/g, "-");
      const userRoleLabel = formatCollectionUserRoleLabel(collectorProfile.role);
      const enrichedVisits = enrichVisitsWithDistances(rows).map((visit) => ({
        id: visit.id,
        visitSequence: visit.visitSequence,
        userName,
        customerCode: visit.customer_code,
        customerName: customerMap.get(normalizeCode(visit.customer_code)) || visit.customer_code,
        visitOutcome: visit.visit_outcome,
        visitOutcomeLabel: formatOutcome(visit.visit_outcome),
        paymentStatus: visit.payment_status,
        amountReceived: Number(visit.amount_received || 0),
        nextVisitAt: visit.next_visit_at || null,
        savedAt: visit.saved_at,
        latitude: visit.latitude,
        longitude: visit.longitude,
        gpsAccuracyMeters: visit.gps_accuracy_meters,
        hasGps: visit.hasGps,
        gpsSource: visit.gpsSource || (visit.hasGps ? "collection_visit" : null),
        distanceFromPreviousKm: visit.distanceFromPreviousKm,
      }));

      return {
        collectorId: createdBy,
        collectorName: userName,
        userRole,
        userRoleLabel,
        salesmanCode: collectorProfile.salesman_code || "",
        visitCount: enrichedVisits.length,
        gpsVisitCount: enrichedVisits.filter((visit) => visit.hasGps).length,
        totalDistanceKm: summarizeRouteDistanceKm(rows),
        visits: enrichedVisits,
      };
    }).sort((left, right) => left.collectorName.localeCompare(right.collectorName));

    const availableUserIds = new Set([
      ...fieldUsers.map((row) => row.id),
      ...allCollectorIds,
    ]);
    if (collectorId) availableUserIds.add(collectorId);

    const availableCollectors = [...availableUserIds].map((id) => {
      const collectorProfile = profileMap.get(id) || { id, role: "unknown" };
      return {
        collectorId: id,
        collectorName: formatCollectionUserDisplayName(collectorProfile, { includeRole: true }),
        salesmanCode: collectorProfile.salesman_code || "",
        userRole: String(collectorProfile.role || "").trim().toLowerCase().replace(/_/g, "-"),
        userRoleLabel: formatCollectionUserRoleLabel(collectorProfile.role),
      };
    })
      .filter((row) => profileMatchesUserRoleFilter(profileMap.get(row.collectorId) || {}, userRoleFilter))
      .sort((left, right) => left.collectorName.localeCompare(right.collectorName));

    let visibleCollectors = collectors;
    if (collectorId) {
      const selectedProfile = profileMap.get(collectorId) || {};
      const selectedSection = collectors.find((row) => row.collectorId === collectorId) || {
        collectorId,
        collectorName: formatCollectorDisplayName(selectedProfile),
        userRole: String(selectedProfile.role || "").trim().toLowerCase().replace(/_/g, "-"),
        userRoleLabel: formatCollectionUserRoleLabel(selectedProfile.role),
        salesmanCode: selectedProfile.salesman_code || "",
        visitCount: 0,
        gpsVisitCount: 0,
        totalDistanceKm: 0,
        visits: [],
      };
      visibleCollectors = [selectedSection];
    }

    return Response.json({
      success: true,
      date,
      gpsColumnsAvailable,
      migrationHint: gpsColumnsAvailable
        ? null
        : "Apply sql/add_collection_visit_gps.sql in Supabase SQL Editor to enable GPS distance reporting.",
      visitCount: visitRowsWithGpsFallback.length,
      collectorCount: visibleCollectors.length,
      gpsVisitCount: visibleCollectors.reduce((sum, collector) => sum + Number(collector.gpsVisitCount || 0), 0),
      totalDistanceKm: visibleCollectors.reduce((sum, collector) => sum + Number(collector.totalDistanceKm || 0), 0),
      userRoleFilter: userRoleFilter || null,
      availableCollectors,
      collectors: visibleCollectors,
    });
  } catch (error) {
    console.error("Error building collection route report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load collection route report" },
      { status: 400 },
    );
  }
}
