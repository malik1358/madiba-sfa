import { createClient } from "@supabase/supabase-js";
import {
  enrichVisitsWithDistances,
  summarizeRouteDistanceKm,
} from "../../../lib/geo.js";

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

function formatOutcome(value) {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
    const collectorId = String(url.searchParams.get("collectorId") || "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllCollectors(profile);

    if (!viewAll) {
      throw new Error("You do not have access to collection route reports.");
    }

    const startIso = `${date}T00:00:00.000Z`;
    const endIso = `${date}T23:59:59.999Z`;

    let visitQuery = admin
      .from("collection_visits")
      .select("id,customer_code,visit_outcome,payment_status,amount_received,saved_at,latitude,longitude,gps_accuracy_meters,created_by")
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true });

    if (collectorId) {
      visitQuery = visitQuery.eq("created_by", collectorId);
    } else if (String(profile.role || "").toLowerCase() === "collector") {
      visitQuery = visitQuery.eq("created_by", user.id);
    }

    const { data: visits, error: visitsError } = await visitQuery;
    if (visitsError) {
      if (isMissingTableError(visitsError)) {
        throw new Error("Collection tables are not initialized in this environment yet.");
      }
      if (isMissingColumnError(visitsError)) {
        throw new Error("Collection visit GPS columns are missing. Apply migration 20260817000000_add_collection_visit_gps.sql.");
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
      if (isMissingColumnError(allDayError)) {
        throw new Error("Collection visit GPS columns are missing. Apply migration 20260817000000_add_collection_visit_gps.sql.");
      }
      throw allDayError;
    }

    const allCollectorIds = [...new Set((allDayVisits || []).map((row) => row.created_by).filter(Boolean))];
    const customerCodes = [...new Set(visitRows.map((row) => normalizeCode(row.customer_code)).filter(Boolean))];

    const [{ data: profiles, error: profilesError }, { data: customers, error: customersError }] = await Promise.all([
      allCollectorIds.length
        ? admin.from("profiles").select("id,salesman_code,salesman_name,role").in("id", allCollectorIds)
        : Promise.resolve({ data: [], error: null }),
      customerCodes.length
        ? admin.from("customers").select("customer_code,customer_name").in("customer_code", customerCodes)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) throw profilesError;
    if (customersError && !isMissingTableError(customersError)) throw customersError;

    const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
    const customerMap = new Map(
      (customers || []).map((row) => [normalizeCode(row.customer_code), row.customer_name || ""]),
    );

    const availableCollectors = allCollectorIds.map((id) => {
      const collectorProfile = profileMap.get(id) || {};
      return {
        collectorId: id,
        collectorName: collectorProfile.salesman_name || collectorProfile.salesman_code || id,
        salesmanCode: collectorProfile.salesman_code || "",
      };
    }).sort((left, right) => left.collectorName.localeCompare(right.collectorName));

    const grouped = new Map();
    visitRows.forEach((visit) => {
      const key = visit.created_by || "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(visit);
    });

    const collectors = [...grouped.entries()].map(([createdBy, rows]) => {
      const collectorProfile = profileMap.get(createdBy) || {};
      const enrichedVisits = enrichVisitsWithDistances(rows).map((visit) => ({
        id: visit.id,
        visitSequence: visit.visitSequence,
        customerCode: visit.customer_code,
        customerName: customerMap.get(normalizeCode(visit.customer_code)) || visit.customer_code,
        visitOutcome: visit.visit_outcome,
        visitOutcomeLabel: formatOutcome(visit.visit_outcome),
        paymentStatus: visit.payment_status,
        amountReceived: Number(visit.amount_received || 0),
        savedAt: visit.saved_at,
        latitude: visit.latitude,
        longitude: visit.longitude,
        gpsAccuracyMeters: visit.gps_accuracy_meters,
        hasGps: visit.hasGps,
        distanceFromPreviousKm: visit.distanceFromPreviousKm,
      }));

      return {
        collectorId: createdBy,
        collectorName: collectorProfile.salesman_name || collectorProfile.salesman_code || createdBy,
        salesmanCode: collectorProfile.salesman_code || "",
        visitCount: enrichedVisits.length,
        gpsVisitCount: enrichedVisits.filter((visit) => visit.hasGps).length,
        totalDistanceKm: summarizeRouteDistanceKm(rows),
        visits: enrichedVisits,
      };
    }).sort((left, right) => left.collectorName.localeCompare(right.collectorName));

    return Response.json({
      success: true,
      date,
      visitCount: visitRows.length,
      collectorCount: collectors.length,
      totalDistanceKm: collectors.reduce((sum, collector) => sum + Number(collector.totalDistanceKm || 0), 0),
      availableCollectors,
      collectors,
    });
  } catch (error) {
    console.error("Error building collection route report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load collection route report" },
      { status: 400 },
    );
  }
}
