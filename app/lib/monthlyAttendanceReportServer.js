import { isFarFromCustomer } from "./customerLocation.js";
import { shouldMarkVisitFarFromCustomer } from "./dailyVisitReportStats.js";
import { formatCollectorDisplayName, parseGpsFromActivityNote } from "./geo.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { sumOrderLineValue } from "./collectionDaySummary.js";
import {
  buildMonthlyAttendanceReport,
  isMonthlyAttendanceSubject,
  resolveMonthlyAttendanceDates,
} from "./monthlyAttendanceReport.js";
import { resolveProspectCustomerCode } from "./prospects.js";
import { getKsaDateString, ksaDayBounds, ksaEventDate } from "./workdayActivity.js";

const ACTIVITY_ENTRY_TYPES = [
  "VISIT_REPORT",
  "PROSPECT_FOLLOW_UP",
  "ORDER_SUBMITTED",
  "MORNING_ATTENDANCE",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "END_OF_DAY",
];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function parseActivityNote(note) {
  if (!note) return null;
  try {
    return typeof note === "string" ? JSON.parse(note) : note;
  } catch {
    return null;
  }
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPaged(admin, table, select, applyFilters) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (from <= 20000) {
    let query = admin.from(table).select(select).range(from, from + pageSize - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function subjectName(profile) {
  const name = String(profile?.salesman_name || "").trim();
  const code = String(profile?.salesman_code || "").trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return formatCollectorDisplayName(profile || {});
}

export function monthlyAttendanceUserSummary(profile) {
  return {
    userId: profile?.id || "",
    userName: subjectName(profile),
    salesmanCode: String(profile?.salesman_code || "").trim(),
    role: String(profile?.role || "").trim(),
  };
}

async function loadProfile(admin, userId) {
  const full = "id,role,salesman_code,salesman_name,email,is_active";
  let result = await admin.from("profiles").select(full).eq("id", userId).maybeSingle();
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select("id,role,salesman_code,salesman_name,email").eq("id", userId).maybeSingle();
  }
  if (result.error) throw result.error;
  if (!result.data) throw new Error("No profile found for this user");
  return result.data;
}

export async function listMonthlyAttendanceSubjects(admin) {
  const full = "id,role,salesman_code,salesman_name,email,is_active";
  let result = await admin.from("profiles").select(full);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select("id,role,salesman_code,salesman_name,email");
  }
  if (result.error) throw result.error;
  return (result.data || [])
    .filter((row) => row.is_active !== false && isMonthlyAttendanceSubject(row))
    .map(monthlyAttendanceUserSummary)
    .sort((left, right) => String(left.userName || "").localeCompare(String(right.userName || "")));
}

async function loadCustomers(admin, codes) {
  const map = new Map();
  for (const chunk of chunkList(codes, 100)) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,latitude,longitude")
      .in("customer_code", chunk);
    if (error) {
      if (isMissingTableError(error) || isMissingSchemaColumn(error)) return map;
      throw error;
    }
    (data || []).forEach((row) => {
      map.set(normalizeCode(row.customer_code), row);
    });
  }
  return map;
}

async function loadOrderValues(admin, orderIds) {
  const values = new Map();
  for (const chunk of chunkList(orderIds, 100)) {
    const { data, error } = await admin
      .from("sales_order_items")
      .select("order_id,line_value,quantity,rate")
      .in("order_id", chunk);
    if (error) {
      if (isMissingTableError(error) || isMissingSchemaColumn(error)) return values;
      throw error;
    }
    (data || []).forEach((line) => {
      const orderId = Number(line?.order_id);
      if (!orderId) return;
      values.set(orderId, Number(values.get(orderId) || 0) + sumOrderLineValue([line]));
    });
  }
  return values;
}

function activityEntry(row) {
  const parsed = parseActivityNote(row.note) || {};
  const gps = parseGpsFromActivityNote(row.note) || {};
  const entryType = String(row.entry_type || parsed.action || "").trim().toUpperCase();
  const prospectFollowUp = entryType === "PROSPECT_FOLLOW_UP";
  const customerCode = parsed.customer_code || parsed.customerCode || (prospectFollowUp
    ? resolveProspectCustomerCode({ id: parsed.prospect_id, offline_id: parsed.offline_id })
    : "");
  const orderId = Number(parsed.order_id || parsed.orderId || 0);
  return {
    id: `activity-${row.id}`,
    savedAt: parsed.captured_at || parsed.capturedAt || row.created_at,
    transactionType: prospectFollowUp ? "VISIT_REPORT" : entryType,
    customerCode: normalizeCode(customerCode),
    latitude: gps.latitude,
    longitude: gps.longitude,
    orderId: Number.isFinite(orderId) && orderId > 0 ? orderId : 0,
    amountReceived: 0,
    orderValue: 0,
    meta: {
      gpsLocationUpdateAccepted: parsed.customer_gps_update_accepted === true
        || parsed.gps_location_update_accepted === true
        || parsed.action === "CUSTOMER_GPS_UPDATE_ACCEPTED",
    },
    ksaDate: ksaEventDate(row),
  };
}

function collectionEntry(row) {
  return {
    id: `collection-${row.id}`,
    savedAt: row.saved_at,
    transactionType: "COLLECTION_VISIT",
    customerCode: normalizeCode(row.customer_code),
    latitude: row.latitude,
    longitude: row.longitude,
    orderId: 0,
    amountReceived: Number(row.amount_received || 0),
    orderValue: 0,
    meta: {
      gpsLocationUpdateAccepted: false,
    },
    ksaDate: getKsaDateString(new Date(row.saved_at)),
  };
}

function markFar(entry, customerMap) {
  const customer = customerMap.get(normalizeCode(entry.customerCode)) || {};
  const far = shouldMarkVisitFarFromCustomer(
    entry,
    isFarFromCustomer(
      { latitude: entry.latitude, longitude: entry.longitude },
      customer,
    ),
  );
  return { ...entry, isFarFromCustomer: far };
}

async function loadCollectionRows(admin, userId, startIso, endIso) {
  try {
    return await fetchPaged(
      admin,
      "collection_visits",
      "id,customer_code,amount_received,saved_at,latitude,longitude,created_by",
      (query) => query
        .eq("created_by", userId)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso)
        .order("saved_at", { ascending: true }),
    );
  } catch (error) {
    if (isMissingTableError(error)) return [];
    if (!isMissingSchemaColumn(error)) throw error;
  }

  try {
    return await fetchPaged(
      admin,
      "collection_visits",
      "id,customer_code,amount_received,saved_at,created_by",
      (query) => query
        .eq("created_by", userId)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso)
        .order("saved_at", { ascending: true }),
    );
  } catch (error) {
    if (isMissingTableError(error) || isMissingSchemaColumn(error)) return [];
    throw error;
  }
}

export async function buildMonthlyAttendanceReportForUser(admin, { userId, month, today = getKsaDateString() } = {}) {
  const profile = await loadProfile(admin, userId);
  if (!isMonthlyAttendanceSubject(profile)) {
    throw new Error("Choose a salesman or collector.");
  }

  const window = resolveMonthlyAttendanceDates(month, today);
  const dates = new Set(window.dates);
  if (!window.dates.length) {
    return {
      ...buildMonthlyAttendanceReport({
        month: window.month,
        user: monthlyAttendanceUserSummary(profile),
        dates: [],
      }),
      throughDate: window.throughDate,
    };
  }

  const { startIso } = ksaDayBounds(window.dates[0]);
  const { endIso } = ksaDayBounds(window.dates[window.dates.length - 1]);
  const widenedStart = new Date(startIso);
  widenedStart.setUTCDate(widenedStart.getUTCDate() - 1);
  const widenedEnd = new Date(endIso);
  widenedEnd.setUTCDate(widenedEnd.getUTCDate() + 1);

  const [activityRows, collectionRows] = await Promise.all([
    fetchPaged(
      admin,
      "daily_activity_logs",
      "id,user_id,entry_type,note,created_at",
      (query) => query
        .eq("user_id", userId)
        .in("entry_type", ACTIVITY_ENTRY_TYPES)
        .gte("created_at", widenedStart.toISOString())
        .lte("created_at", widenedEnd.toISOString())
        .order("created_at", { ascending: true }),
    ).catch((error) => {
      if (isMissingTableError(error)) return [];
      throw error;
    }),
    loadCollectionRows(admin, userId, startIso, endIso),
  ]);

  const activityEntries = (activityRows || [])
    .map(activityEntry)
    .filter((entry) => dates.has(entry.ksaDate));
  const collectionEntries = (collectionRows || [])
    .map(collectionEntry)
    .filter((entry) => dates.has(entry.ksaDate));

  const orderIds = [...new Set(activityEntries.map((entry) => entry.orderId).filter(Boolean))];
  const customerCodes = [...new Set(
    [...activityEntries, ...collectionEntries].map((entry) => entry.customerCode).filter(Boolean),
  )];
  const [customerMap, orderValues] = await Promise.all([
    loadCustomers(admin, customerCodes),
    loadOrderValues(admin, orderIds),
  ]);

  const entriesByDate = {};
  [...activityEntries, ...collectionEntries].forEach((entry) => {
    const orderValue = entry.orderId ? Number(orderValues.get(entry.orderId) || 0) : 0;
    const marked = markFar({ ...entry, orderValue }, customerMap);
    if (!entriesByDate[entry.ksaDate]) entriesByDate[entry.ksaDate] = [];
    entriesByDate[entry.ksaDate].push(marked);
  });

  return {
    ...buildMonthlyAttendanceReport({
      month: window.month,
      user: monthlyAttendanceUserSummary(profile),
      dates: window.dates,
      entriesByDate,
    }),
    throughDate: window.throughDate,
  };
}
