import { createClient } from "@supabase/supabase-js";
import {
  buildStoredCollectionVisitSummary,
  isPriorityCollectionVisit,
} from "../../../lib/collectionVisitSummary.js";
import {
  buildCollectionQueuePriorityMaps,
  resolveVisitPriorityMeta,
} from "../../../lib/collectionVisitPriority.js";
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
import { filterCollectionQueueInvoices, invoiceHasCashRef, isScheduledRevisitQueueCustomer } from "../../../lib/paymentCollections.js";
import { resolveInvoiceAgingDays, toNumber } from "../../../lib/outstanding.js";
import { getKsaDateString, ksaDayBounds } from "../../../lib/workdayActivity.js";
import { fetchOutstandingAndCollectionRecords } from "../route.js";

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

function countUniqueCustomerVisits(visits) {
  return new Set(
    (visits || [])
      .map((visit) => normalizeCode(visit.customer_code || visit.customerCode))
      .filter(Boolean),
  ).size;
}

async function loadOutstandingContextByCustomer(admin, customerCodes, reportDate) {
  const targets = new Set((customerCodes || []).map((code) => normalizeCode(code)).filter(Boolean));
  if (!targets.size) return new Map();

  const { data: invoiceRows, error } = await admin
    .from("invoices")
    .select("customer_code,due_date,pending_amount,ref_no,salesman_code")
    .gt("pending_amount", 0);

  if (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }

  const { data: customers, error: customersError } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code")
    .in("customer_code", [...targets]);

  if (customersError && !isMissingTableError(customersError)) throw customersError;

  const { data: salesmen, error: salesmenError } = await admin
    .from("profiles")
    .select("salesman_code,salesman_name");

  if (salesmenError) throw salesmenError;

  const customerByCode = new Map(
    (customers || []).map((customer) => [normalizeCode(customer.customer_code), customer]),
  );
  const salesmanNameByCode = new Map(
    (salesmen || []).map((salesman) => [normalizeCode(salesman.salesman_code), String(salesman.salesman_name || "").trim()]),
  );

  const groupedInvoices = new Map();
  (invoiceRows || []).forEach((row) => {
    const customerCode = normalizeCode(row.customer_code);
    if (!targets.has(customerCode)) return;
    if (!groupedInvoices.has(customerCode)) groupedInvoices.set(customerCode, []);
    groupedInvoices.get(customerCode).push({
      pending_amount: row.pending_amount,
      due_date: row.due_date,
      ref_no: row.ref_no,
      salesman_code: row.salesman_code,
    });
  });

  const todayIso = `${reportDate}T00:00:00`;
  const contextByCustomer = new Map();

  targets.forEach((customerCode) => {
    const customer = customerByCode.get(customerCode) || { customer_code: customerCode, customer_name: customerCode };
    const invoices = filterCollectionQueueInvoices(groupedInvoices.get(customerCode) || []);
    const outstanding = {
      outstanding_cash: 0,
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    };

    invoices.forEach((invoice) => {
      const pendingAmount = toNumber(invoice.pending_amount);
      if (pendingAmount <= 0) return;
      if (invoiceHasCashRef(invoice)) outstanding.outstanding_cash += pendingAmount;

      const daysOverdue = resolveInvoiceAgingDays(invoice, todayIso);
      if (daysOverdue <= 30) outstanding.outstanding_0_30 += pendingAmount;
      else if (daysOverdue <= 60) outstanding.outstanding_30_60 += pendingAmount;
      else if (daysOverdue <= 90) outstanding.outstanding_61_90 += pendingAmount;
      else if (daysOverdue <= 120) outstanding.outstanding_91_120 += pendingAmount;
      else outstanding.outstanding_above_120 += pendingAmount;
    });

    const salesmanCode = normalizeCode(invoices[0]?.salesman_code || customer.current_salesman_code || "");
    contextByCustomer.set(customerCode, {
      customer_code: customerCode,
      customer_name: customer.customer_name || customerCode,
      salesman_code: salesmanCode,
      salesman_name: salesmanNameByCode.get(salesmanCode) || salesmanCode,
      ...outstanding,
    });
  });

  return contextByCustomer;
}

function buildVisitReportFields(visit, customerContext, visitNumberForDay, priorityMeta = {}) {
  const queuePriority = Number(priorityMeta.queuePriority || visit.queue_priority || 0);
  const probabilityLabel = String(priorityMeta.probabilityLabel || visit.probability_label || "").trim();
  const probabilityScore = Number(priorityMeta.probabilityScore || visit.probability_score || 0);
  const storedSummary = String(visit.summary_text || "").trim();
  const priority = isPriorityCollectionVisit({ queuePriority, probabilityLabel });
  const customerRow = customerContext || {
    customer_code: visit.customer_code,
    customer_name: visit.customer_code,
    salesman_code: "",
    salesman_name: "",
    outstanding_0_30: 0,
    outstanding_30_60: 0,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
    probability_label: probabilityLabel,
  };

  const whatsappSummary = storedSummary || buildStoredCollectionVisitSummary(customerRow, {
    ...visit,
    visit_number_for_day: visit.visit_number_for_day || visitNumberForDay,
    queue_priority: queuePriority,
    probability_label: probabilityLabel,
  }, {
    visitNumberForDay: visit.visit_number_for_day || visitNumberForDay,
    queuePriority,
    probabilityLabel,
  });

  return {
    whatsappSummary,
    queuePriority: queuePriority || null,
    probabilityLabel: probabilityLabel || null,
    probabilityScore: probabilityScore || null,
    isPriorityCustomer: priority.isPriority,
    priorityReason: priority.reason,
    visitNumberForDay: visit.visit_number_for_day || visitNumberForDay || null,
    hasStoredSummary: Boolean(storedSummary),
    prioritySource: priorityMeta.prioritySource || (queuePriority || probabilityLabel ? "stored" : "unknown"),
    queueRankGap: priorityMeta.queueRankGap ?? null,
    queueCompliance: priorityMeta.queueCompliance || "unknown",
    dueQueueSize: priorityMeta.dueQueueSize ?? null,
    isScheduledRevisit: Boolean(priorityMeta.isScheduledRevisit),
  };
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

const VISIT_SELECT_WITH_GPS = "id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,next_visit_at,remark_arabic,remark_english,saved_at,latitude,longitude,gps_accuracy_meters,created_by,summary_text,queue_priority,probability_score,probability_label,visit_number_for_day";
const VISIT_SELECT_WITHOUT_GPS = "id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,next_visit_at,remark_arabic,remark_english,saved_at,created_by,summary_text,queue_priority,probability_score,probability_label,visit_number_for_day";
const VISIT_SELECT_WITH_GPS_LEGACY = "id,customer_code,visit_outcome,payment_status,amount_received,next_visit_at,saved_at,latitude,longitude,gps_accuracy_meters,created_by";
const VISIT_SELECT_WITHOUT_GPS_LEGACY = "id,customer_code,visit_outcome,payment_status,amount_received,next_visit_at,saved_at,created_by";

async function queryCollectionVisits(admin, {
  startIso,
  endIso,
  collectorId,
  userId,
  restrictToUser,
  includeGps,
  includeReportMeta,
}) {
  const selectFields = includeGps
    ? (includeReportMeta ? VISIT_SELECT_WITH_GPS : VISIT_SELECT_WITH_GPS_LEGACY)
    : (includeReportMeta ? VISIT_SELECT_WITHOUT_GPS : VISIT_SELECT_WITHOUT_GPS_LEGACY);
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
    let reportMetaAvailable = true;

    let visitQueryResult = await queryCollectionVisits(admin, {
      startIso,
      endIso,
      collectorId,
      userId: user.id,
      restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
      includeGps: true,
      includeReportMeta: true,
    });

    if (visitQueryResult.error && isMissingColumnError(visitQueryResult.error)) {
      reportMetaAvailable = false;
      visitQueryResult = await queryCollectionVisits(admin, {
        startIso,
        endIso,
        collectorId,
        userId: user.id,
        restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
        includeGps: true,
        includeReportMeta: false,
      });
    }

    if (visitQueryResult.error && isMissingColumnError(visitQueryResult.error)) {
      gpsColumnsAvailable = false;
      visitQueryResult = await queryCollectionVisits(admin, {
        startIso,
        endIso,
        collectorId,
        userId: user.id,
        restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
        includeGps: false,
        includeReportMeta: reportMetaAvailable,
      });
    }

    if (visitQueryResult.error && isMissingColumnError(visitQueryResult.error)) {
      reportMetaAvailable = false;
      visitQueryResult = await queryCollectionVisits(admin, {
        startIso,
        endIso,
        collectorId,
        userId: user.id,
        restrictToUser: String(profile.role || "").toLowerCase() === "collector" && !collectorId,
        includeGps: false,
        includeReportMeta: false,
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

    const outstandingByCustomer = await loadOutstandingContextByCustomer(admin, customerCodes, date);

    const collectionRecords = await fetchOutstandingAndCollectionRecords(admin, {
      hasAllAccess: true,
      visibleSalesmanCodes: [],
      scopeProfiles: [],
    });
    const priorityMaps = buildCollectionQueuePriorityMaps(collectionRecords, `${date}T12:00:00`);

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
      const enrichedVisits = enrichVisitsWithDistances(rows).map((visit, index) => {
        const customerCode = normalizeCode(visit.customer_code);
        const record = priorityMaps.recordByCode.get(customerCode);
        const priorityMeta = resolveVisitPriorityMeta(visit, priorityMaps, {
          reportDate: date,
          visitNumberForDay: visit.visit_number_for_day || index + 1,
        });
        priorityMeta.isScheduledRevisit = record
          ? isScheduledRevisitQueueCustomer(record, `${date}T12:00:00`)
          : false;

        const reportFields = buildVisitReportFields(
          visit,
          outstandingByCustomer.get(customerCode),
          index + 1,
          priorityMeta,
        );

        return {
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
        whatsappSummary: reportFields.whatsappSummary,
        queuePriority: reportFields.queuePriority,
        probabilityLabel: reportFields.probabilityLabel,
        probabilityScore: reportFields.probabilityScore,
        isPriorityCustomer: reportFields.isPriorityCustomer,
        priorityReason: reportFields.priorityReason,
        visitNumberForDay: reportFields.visitNumberForDay,
        hasStoredSummary: reportFields.hasStoredSummary,
        prioritySource: reportFields.prioritySource,
        queueRankGap: reportFields.queueRankGap,
        queueCompliance: reportFields.queueCompliance,
        dueQueueSize: reportFields.dueQueueSize,
        isScheduledRevisit: reportFields.isScheduledRevisit,
      };
      });

      return {
        collectorId: createdBy,
        collectorName: userName,
        userRole,
        userRoleLabel,
        salesmanCode: collectorProfile.salesman_code || "",
        visitCount: enrichedVisits.length,
        uniqueCustomerVisitCount: countUniqueCustomerVisits(rows),
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
        uniqueCustomerVisitCount: 0,
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
      reportMetaAvailable,
      migrationHint: gpsColumnsAvailable
        ? (reportMetaAvailable
          ? null
          : "Apply supabase/migrations/20260824120000_collection_visit_report_meta.sql in Supabase SQL Editor to store WhatsApp summaries and priority at visit time.")
        : "Apply sql/add_collection_visit_gps.sql in Supabase SQL Editor to enable GPS distance reporting.",
      visitCount: visitRowsWithGpsFallback.length,
      uniqueCustomerVisitCount: countUniqueCustomerVisits(visitRowsWithGpsFallback),
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
