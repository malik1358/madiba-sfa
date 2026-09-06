import {
  CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
  customerHasSavedLocation,
  distanceFromCustomerKm,
  isFarFromCustomer,
} from "./customerLocation.js";
import {
  enrichVisitsWithDistances,
  extractAreaFromActivityNote,
  extractStreetFromActivityNote,
  formatCollectorDisplayName,
  formatGpsCapturePlatformLabel,
  computeSpeedKmh,
  resolveWaitingMinutesFromPreviousVisit,
  computeEstimatedTransitHours,
  haversineDistanceKm,
  findPreviousWaitingAnchorRow,
  hasGpsCoordinates,
  inferGpsCapturePlatformFromNote,
  parseGpsFromActivityNote,
  summarizeRouteDistanceKm,
} from "./geo.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { loadCollectionDaySummaryForUser } from "./collectionDaySummaryServer.js";
import { buildDayRoutePoints } from "./dayRouteMap.js";
import { assignOnSiteVisitNumbers, buildVisitDaySplit, loginLogoutLocationNotes } from "./dailyVisitReportStats.js";
import { filterLogsByKsaEventDate, ksaDayBounds } from "./workdayActivity.js";

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

const ENTRY_COUNT_EXCLUDED_TYPES = new Set(["GPS_PING", "VISIT_REPORT"]);

const FIELD_CUSTOMER_TYPES = new Set([
  "COLLECTION_VISIT",
  "VISIT_REPORT",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "ORDER_SUBMITTED",
]);

export function buildFieldVisitStats(entries = []) {
  const byCode = new Map();
  (entries || []).forEach((entry) => {
    const type = String(entry?.transactionType || entry?.transaction_type || "").trim().toUpperCase();
    if (!FIELD_CUSTOMER_TYPES.has(type)) return;
    const code = normalizeCode(entry?.customerCode || entry?.customer_code);
    if (!code) return;
    const existing = byCode.get(code) || {
      customerCode: code,
      customerName: "",
      amountCollected: 0,
    };
    const name = String(entry?.customerName || entry?.customer_name || "").trim();
    if (name) existing.customerName = existing.customerName || name;
    if (type === "COLLECTION_VISIT") {
      const amount = Number(entry?.amountReceived ?? entry?.amount_received ?? 0);
      if (Number.isFinite(amount) && amount > 0) existing.amountCollected += amount;
    }
    byCode.set(code, existing);
  });

  const customers = [...byCode.values()].sort((left, right) => (
    left.customerName.localeCompare(right.customerName) || left.customerCode.localeCompare(right.customerCode)
  ));

  return {
    uniqueCustomers: customers.length,
    customers,
  };
}

export function countsTowardDailyVisitEntryStats(entry) {
  const type = String(entry?.transactionType || entry?.transaction_type || "").trim().toUpperCase();
  return !ENTRY_COUNT_EXCLUDED_TYPES.has(type);
}

export function countDailyVisitEntries(entries) {
  return (entries || []).filter(countsTowardDailyVisitEntryStats).length;
}

export function countFarFromCustomerEntries(entries) {
  return (entries || []).filter((entry) => (
    countsTowardDailyVisitEntryStats(entry) && Boolean(entry?.isFarFromCustomer)
  )).length;
}

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
  const timelineForWaiting = withRoute.map((entry) => ({
    savedAt: entry.saved_at,
    saved_at: entry.saved_at,
    transactionType: entry.transaction_type,
    latitude: entry.latitude,
    longitude: entry.longitude,
  }));

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
    const waitingMinutesFromPrevious = resolveWaitingMinutesFromPreviousVisit(timelineForWaiting, index);
    const previousAnchor = findPreviousWaitingAnchorRow(timelineForWaiting, index);
    const anchorDistanceKm = previousAnchor && hasGpsCoordinates(previousAnchor) && hasGpsCoordinates(entry)
      ? haversineDistanceKm(
        Number(previousAnchor.latitude),
        Number(previousAnchor.longitude),
        Number(entry.latitude),
        Number(entry.longitude),
      )
      : null;
    const estimatedTransitMinutesFromPrevious = anchorDistanceKm === null
      ? null
      : Math.round((computeEstimatedTransitHours(anchorDistanceKm) || 0) * 60);
    const area = String(customer.area || extractAreaFromActivityNote(entry.meta?.activityNote) || "").trim();
    const street = extractStreetFromActivityNote(entry.meta?.activityNote);
    const capturePlatform = entry.meta?.activityNote
      ? inferGpsCapturePlatformFromNote(entry.meta?.activityNote)
      : null;

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
      waitingMinutesFromPrevious,
      estimatedTransitMinutesFromPrevious,
      area,
      street,
      capturePlatform,
      capturePlatformLabel: capturePlatform ? formatGpsCapturePlatformLabel(capturePlatform) : null,
      isFarFromCustomer: farFromCustomer,
      farThresholdKm: CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
    };
  });
}

function emptyUserReport(userId, profile) {
  return {
    userId,
    userName: formatCollectorDisplayName(profile || {}),
    email: String(profile?.report_email || profile?.email || "").trim(),
    reportEmail: String(profile?.report_email || "").trim(),
    visitCount: 0,
    farFromCustomerCount: 0,
    totalRouteDistanceKm: 0,
    entries: [],
    idleGaps: [],
    routePoints: [],
    daySummary: null,
  };
}

async function loadProfilesById(admin, userIds, { includeActive = false } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const extra = includeActive ? ",is_active" : "";
  const full = `id,salesman_code,salesman_name,role,email,report_email${extra}`;
  const fallback = `id,salesman_code,salesman_name,role,email${extra}`;

  let result = await admin.from("profiles").select(full).in("id", ids);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback).in("id", ids);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

export async function buildDailyVisitReport(admin, { date, userIdFilter = "" } = {}) {
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

  const [profiles, customersResult] = await Promise.all([
    userIds.length ? loadProfilesById(admin, userIds) : Promise.resolve([]),
    customerCodes.length
      ? admin.from("customers").select("customer_code,customer_name,latitude,longitude,area").in("customer_code", customerCodes)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const { data: customers, error: customersError } = customersResult;
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
    const enrichedEntries = assignOnSiteVisitNumbers(enrichEntries(rows, customerMap, profileMap));
    const profile = profileMap.get(entryUserId) || {};
    return {
      userId: entryUserId,
      userName: formatCollectorDisplayName(profile),
      email: String(profile.email || "").trim(),
      reportEmail: String(profile.report_email || "").trim(),
      visitCount: countDailyVisitEntries(enrichedEntries),
      farFromCustomerCount: countFarFromCustomerEntries(enrichedEntries),
      totalRouteDistanceKm: summarizeRouteDistanceKm(rows),
      entries: enrichedEntries,
    };
  }).sort((left, right) => left.userName.localeCompare(right.userName));

  const allDayUserIds = [...new Set([
    ...allCollectionEntries.map((entry) => entry.user_id),
    ...allActivityResult.entries.map((entry) => entry.user_id),
    ...(userIdFilter ? [userIdFilter] : []),
  ].filter(Boolean))];
  const dayProfiles = allDayUserIds.length
    ? await loadProfilesById(admin, allDayUserIds)
    : [];

  const dayProfileMap = new Map((dayProfiles || []).map((row) => [row.id, row]));
  const availableUsers = (dayProfiles || []).map((row) => ({
    userId: row.id,
    userName: formatCollectorDisplayName(row),
    reportEmail: String(row.report_email || "").trim(),
    email: String(row.email || "").trim(),
  })).sort((left, right) => left.userName.localeCompare(right.userName));

  const summaryUserIds = userIdFilter
    ? [userIdFilter]
    : [...new Set(users.map((entryUser) => entryUser.userId).filter(Boolean))];

  const summaryEntries = await Promise.all(
    summaryUserIds.map(async (entryUserId) => {
      const reportUser = users.find((entryUser) => entryUser.userId === entryUserId);
      const activities = (grouped.get(entryUserId) || [])
        .filter((row) => String(row.transaction_type || "").toUpperCase() !== "GPS_PING")
        .map((row) => ({ saved_at: row.saved_at }));
      const summaryPayload = await loadCollectionDaySummaryForUser(admin, entryUserId, date, {
        activities,
        fieldVisitStats: buildFieldVisitStats(reportUser?.entries || []),
      });
      return [entryUserId, summaryPayload.daySummary];
    }),
  );
  const summaryByUserId = new Map(summaryEntries);

  const usersWithSummary = users.map((entryUser) => {
    const daySummary = summaryByUserId.get(entryUser.userId) || null;
    const idleGaps = daySummary?.idleGaps || [];
    return {
      ...entryUser,
      daySummary,
      idleGaps,
      activitySplit: buildVisitDaySplit(entryUser.entries, daySummary?.stats || {}),
      locationNotes: loginLogoutLocationNotes(entryUser.entries),
      routePoints: buildDayRoutePoints(entryUser.entries, idleGaps),
    };
  });

  if (userIdFilter && !usersWithSummary.some((entryUser) => entryUser.userId === userIdFilter)) {
    usersWithSummary.push({
      ...emptyUserReport(userIdFilter, dayProfileMap.get(userIdFilter) || {}),
      daySummary: summaryByUserId.get(userIdFilter) || null,
    });
    usersWithSummary.sort((left, right) => left.userName.localeCompare(right.userName));
  }

  const flatEntries = usersWithSummary.flatMap((entryUser) => entryUser.entries || []);

  return {
    date,
    thresholdKm: CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
    visitCount: countDailyVisitEntries(flatEntries),
    userCount: usersWithSummary.length,
    farFromCustomerCount: countFarFromCustomerEntries(flatEntries),
    totalRouteDistanceKm: usersWithSummary.reduce((sum, entryUser) => sum + Number(entryUser.totalRouteDistanceKm || 0), 0),
    daySummary: usersWithSummary.length === 1 ? usersWithSummary[0].daySummary : null,
    availableUsers,
    users: usersWithSummary,
  };
}

const FIELD_REPORT_ROLES = new Set(["salesman", "collector"]);

export function shouldEmailVisitReportForRole(role) {
  return FIELD_REPORT_ROLES.has(String(role || "").trim().toLowerCase());
}

export async function loadProfilesForVisitReportEmails(admin) {
  const extra = "id,role,salesman_code,salesman_name,email,report_email,is_active";
  const fallback = "id,role,salesman_code,salesman_name,email,is_active";
  let result = await admin.from("profiles").select(extra);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback);
  }
  if (result.error) throw result.error;
  return (result.data || []).filter((row) => row.is_active !== false);
}
