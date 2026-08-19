import { createClient } from "@supabase/supabase-js";
import {
  CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
  customerHasSavedLocation,
  distanceFromCustomerKm,
  isFarFromCustomer,
} from "../../lib/customerLocation.js";
import {
  enrichVisitsWithDistances,
  extractAreaFromActivityNote,
  extractStreetFromActivityNote,
  formatCollectorDisplayName,
  computeSpeedKmh,
  hasGpsCoordinates,
  parseGpsFromActivityNote,
  summarizeRouteDistanceKm,
} from "../../lib/geo.js";
import { filterLogsByKsaEventDate, getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const maxDuration = 60;

const ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "ORDER_SUBMITTED",
  "GPS_PING",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
];

const WORKDAY_GPS_ENTRY_TYPES = new Set([
  "GPS_PING",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
]);

const TRANSACTION_LABELS = {
  COLLECTION_VISIT: "Collection visit",
  VISIT_REPORT: "Visit report",
  ORDER_DRAFT: "Order draft",
  ORDER_EDITED: "Order edited",
  ORDER_SUBMITTED: "Order submitted",
  MORNING_ATTENDANCE: "Login",
  END_OF_DAY: "Logout",
  LUNCH_BREAK_OUT: "Lunch out",
  LUNCH_BREAK_IN: "Lunch in",
  GPS_PING: "Idle GPS ping",
};

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
    .select("id,role,salesman_code,salesman_name,email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

function canViewAllUsers(profile) {
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

function parseActivityNote(note) {
  if (!note) return null;
  try {
    return typeof note === "string" ? JSON.parse(note) : note;
  } catch {
    return null;
  }
}

function buildEntryBase({
  id,
  userId,
  savedAt,
  customerCode,
  transactionType,
  latitude,
  longitude,
  meta = {},
}) {
  return {
    id,
    user_id: userId,
    saved_at: savedAt,
    customer_code: normalizeCode(customerCode),
    transaction_type: transactionType,
    latitude,
    longitude,
    meta,
  };
}

async function loadCollectionVisitEntries(admin, startIso, endIso, userIdFilter) {
  let query = admin
    .from("collection_visits")
    .select("id,customer_code,visit_outcome,amount_received,saved_at,latitude,longitude,created_by")
    .gte("saved_at", startIso)
    .lte("saved_at", endIso)
    .order("saved_at", { ascending: true });

  if (userIdFilter) query = query.eq("created_by", userIdFilter);

  let { data, error } = await query;
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await admin
      .from("collection_visits")
      .select("id,customer_code,visit_outcome,amount_received,saved_at,created_by")
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true }));
  }

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return (data || []).map((row) => buildEntryBase({
    id: `collection-${row.id}`,
    userId: row.created_by,
    savedAt: row.saved_at,
    customerCode: row.customer_code,
    transactionType: "COLLECTION_VISIT",
    latitude: row.latitude,
    longitude: row.longitude,
    meta: {
      visitOutcome: row.visit_outcome,
      amountReceived: Number(row.amount_received || 0),
    },
  }));
}

async function loadActivityLogEntries(admin, startIso, endIso, userIdFilter, reportDate) {
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  let query = admin
    .from("daily_activity_logs")
    .select("id,user_id,entry_type,note,created_at")
    .in("entry_type", ACTIVITY_ENTRY_TYPES)
    .gte("created_at", widenedStart.toISOString())
    .lte("created_at", widenedEnd.toISOString())
    .order("created_at", { ascending: true });

  if (userIdFilter) query = query.eq("user_id", userIdFilter);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { entries: [], orderIds: [] };
    throw error;
  }

  const filteredLogs = filterLogsByKsaEventDate(data || [], reportDate);
  const orderIds = [];

  const entries = filteredLogs.map((row) => {
    const parsed = parseActivityNote(row.note) || {};
    const gps = parseGpsFromActivityNote(row.note) || {};
    const customerCode = parsed.customer_code || parsed.customerCode || "";
    const orderId = parsed.order_id || parsed.orderId || null;
    if (orderId) orderIds.push(Number(orderId));

    return buildEntryBase({
      id: `activity-${row.id}`,
      userId: row.user_id,
      savedAt: parsed.captured_at || parsed.capturedAt || row.created_at,
      customerCode,
      transactionType: String(row.entry_type || parsed.action || "ACTIVITY").toUpperCase(),
      latitude: gps.latitude,
      longitude: gps.longitude,
      meta: {
        orderId,
        outcome: parsed.outcome || null,
        activityNote: row.note,
        autoClosed: Boolean(parsed.autoClosed),
      },
    });
  });

  return { entries, orderIds: [...new Set(orderIds.filter(Boolean))] };
}

async function hydrateOrderCustomers(admin, orderIds) {
  if (!orderIds.length) return new Map();

  const { data, error } = await admin
    .from("sales_orders")
    .select("id,customer_code,customer_name")
    .in("id", orderIds);

  if (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }

  return new Map((data || []).map((row) => [Number(row.id), row]));
}

function enrichEntries(entries, customerMap, profileMap) {
  const sorted = [...entries].sort(
    (left, right) => new Date(left.saved_at).getTime() - new Date(right.saved_at).getTime(),
  );

  const withRoute = enrichVisitsWithDistances(sorted);

  return withRoute.map((entry, index) => {
    const customer = customerMap.get(normalizeCode(entry.customer_code)) || {};
    const profile = profileMap.get(entry.user_id) || {};
    const entryLocation = { latitude: entry.latitude, longitude: entry.longitude };
    const distanceKm = distanceFromCustomerKm(entryLocation, customer);
    const farFromCustomer = isFarFromCustomer(entryLocation, customer);
    const previous = index > 0 ? withRoute[index - 1] : null;
    const speedKmh = previous
      ? computeSpeedKmh(entry.distanceFromPreviousKm, previous.saved_at, entry.saved_at)
      : null;
    const area = String(customer.area || extractAreaFromActivityNote(entry.meta?.activityNote) || "").trim();
    const street = extractStreetFromActivityNote(entry.meta?.activityNote);

    return {
      id: entry.id,
      visitSequence: entry.visitSequence,
      savedAt: entry.saved_at,
      userId: entry.user_id,
      userName: formatCollectorDisplayName(profile),
      customerCode: entry.customer_code,
      customerName: customer.customer_name || entry.customer_code || "",
      transactionType: entry.transaction_type,
      transactionLabel: TRANSACTION_LABELS[entry.transaction_type] || entry.transaction_type,
      visitOutcome: entry.meta?.visitOutcome || entry.meta?.outcome || null,
      amountReceived: Number(entry.meta?.amountReceived || 0),
      orderId: entry.meta?.orderId || null,
      logoutAutoClosed: entry.transaction_type === "END_OF_DAY" && entry.meta?.autoClosed,
      entryLatitude: entry.latitude,
      entryLongitude: entry.longitude,
      customerLatitude: customer.latitude,
      customerLongitude: customer.longitude,
      hasEntryGps: hasGpsCoordinates(entry),
      hasCustomerLocation: customerHasSavedLocation(customer),
      distanceFromCustomerKm: distanceKm,
      distanceFromPreviousKm: entry.distanceFromPreviousKm,
      speedKmh,
      area,
      street,
      isFarFromCustomer: farFromCustomer,
      farThresholdKm: CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
    };
  });
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

    const profile = await getProfile(admin, user.id);
    const viewAll = canViewAllUsers(profile);
    const restrictToSelf = !viewAll;
    const userIdFilter = userId || (restrictToSelf ? user.id : "");

    if (!viewAll && userId && userId !== user.id) {
      throw new Error("You do not have access to other users' visit reports.");
    }

    const { startIso, endIso } = ksaDayBounds(date);

    const [collectionEntries, activityResult, allCollectionEntries, allActivityResult] = await Promise.all([
      loadCollectionVisitEntries(admin, startIso, endIso, userIdFilter || null),
      loadActivityLogEntries(admin, startIso, endIso, userIdFilter || null, date),
      loadCollectionVisitEntries(admin, startIso, endIso, null),
      loadActivityLogEntries(admin, startIso, endIso, null, date),
    ]);

    const orderMap = await hydrateOrderCustomers(admin, activityResult.orderIds);
    const activityEntries = activityResult.entries.map((entry) => {
      if (entry.customer_code || !entry.meta?.orderId) return entry;
      const order = orderMap.get(Number(entry.meta.orderId));
      if (!order) return entry;
      return {
        ...entry,
        customer_code: order.customer_code,
        meta: {
          ...entry.meta,
          customerName: order.customer_name,
        },
      };
    });

    const rawEntries = [...collectionEntries, ...activityEntries].filter((entry) => (
      entry.customer_code || WORKDAY_GPS_ENTRY_TYPES.has(entry.transaction_type)
    ));
    const userIds = [...new Set(rawEntries.map((entry) => entry.user_id).filter(Boolean))];
    const customerCodes = [...new Set(rawEntries.map((entry) => normalizeCode(entry.customer_code)).filter(Boolean))];

    const [{ data: profiles, error: profilesError }, { data: customers, error: customersError }] = await Promise.all([
      userIds.length
        ? admin.from("profiles").select("id,salesman_code,salesman_name,role,email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      customerCodes.length
        ? admin.from("customers").select("customer_code,customer_name,latitude,longitude,area").in("customer_code", customerCodes)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) throw profilesError;
    if (customersError && !isMissingTableError(customersError)) throw customersError;

    const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
    const customerMap = new Map((customers || []).map((row) => [normalizeCode(row.customer_code), row]));

    const grouped = new Map();
    rawEntries.forEach((entry) => {
      const key = entry.user_id || "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });

    const users = [...grouped.entries()].map(([entryUserId, rows]) => {
      const enrichedEntries = enrichEntries(rows, customerMap, profileMap);
      return {
        userId: entryUserId,
        userName: formatCollectorDisplayName(profileMap.get(entryUserId) || {}),
        visitCount: enrichedEntries.length,
        farFromCustomerCount: enrichedEntries.filter((entry) => entry.isFarFromCustomer).length,
        totalRouteDistanceKm: summarizeRouteDistanceKm(rows),
        entries: enrichedEntries,
      };
    }).sort((left, right) => left.userName.localeCompare(right.userName));

    const allDayUserIds = [...new Set([
      ...allCollectionEntries.map((entry) => entry.user_id),
      ...allActivityResult.entries.map((entry) => entry.user_id),
    ].filter(Boolean))];
    const { data: dayProfiles } = allDayUserIds.length
      ? await admin.from("profiles").select("id,salesman_code,salesman_name,role,email").in("id", allDayUserIds)
      : { data: [] };

    const availableUsers = (dayProfiles || []).map((row) => ({
      userId: row.id,
      userName: formatCollectorDisplayName(row),
    })).sort((left, right) => left.userName.localeCompare(right.userName));

    const flatEntries = users.flatMap((entryUser) => entryUser.entries || []);

    return Response.json({
      success: true,
      date,
      thresholdKm: CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
      visitCount: flatEntries.length,
      userCount: users.length,
      farFromCustomerCount: flatEntries.filter((entry) => entry.isFarFromCustomer).length,
      totalRouteDistanceKm: users.reduce((sum, entryUser) => sum + Number(entryUser.totalRouteDistanceKm || 0), 0),
      availableUsers,
      users,
    });
  } catch (error) {
    console.error("Error building daily visit report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load daily visit report" },
      { status: 400 },
    );
  }
}
