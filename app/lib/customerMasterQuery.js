import { findOutstandingForCustomer, OUTSTANDING_DATASET_KEY } from "./outstanding.js";
import { normalizeCustomerNameKey, resolveCustomerMasterExportFields } from "./customerCode.js";

export function normalizeCustomerMasterSearch(value) {
  return String(value || "").trim();
}

export function normalizeCustomerMasterGpsFilter(rawValue, legacyMissingGps = false) {
  return String(rawValue || (legacyMissingGps ? "without" : "all")).toLowerCase();
}

export function normalizeCustomerMasterActiveFilter(rawValue) {
  const value = String(rawValue || "all").toLowerCase();
  if (value === "active" || value === "inactive") return value;
  return "all";
}

export function normalizeCustomerMasterOutstandingFilter(rawValue) {
  const value = String(rawValue || "all").toLowerCase();
  if (value === "with" || value === "without") return value;
  return "all";
}

export function applyCustomerMasterFilters(query, { search = "", gpsFilter = "all", activeFilter = "all" } = {}) {
  let nextQuery = query;

  if (search) {
    nextQuery = nextQuery.or(`customer_code.ilike.%${search}%,customer_name.ilike.%${search}%`);
  }

  if (activeFilter === "active") {
    nextQuery = nextQuery.eq("is_active", true);
  } else if (activeFilter === "inactive") {
    nextQuery = nextQuery.eq("is_active", false);
  }

  if (gpsFilter === "without" || gpsFilter === "missing") {
    nextQuery = nextQuery.or("latitude.is.null,longitude.is.null,latitude.eq.0,longitude.eq.0");
  } else if (gpsFilter === "with" || gpsFilter === "has") {
    nextQuery = nextQuery
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .gt("latitude", 0)
      .gt("longitude", 0);
  }

  return nextQuery;
}

export function customerHasSavedGps(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

function customerMasterRowScore(row) {
  let score = 0;
  if (customerHasSavedGps(row)) score += 100;
  const date = Date.parse(row?.latest_transaction_date || "");
  if (Number.isFinite(date)) score += date / 1e12;
  const code = String(row?.customer_code || "").trim();
  if (code && !code.includes(" ")) score += 10;
  return score;
}

export function customerMasterDedupeKey(row) {
  const display = resolveCustomerMasterExportFields(row);
  return display.customer_code || normalizeCustomerNameKey(display.customer_name);
}

export function dedupeCustomerMasterRows(rows) {
  const byKey = new Map();

  for (const row of rows || []) {
    const key = customerMasterDedupeKey(row);
    if (!key) continue;

    const display = resolveCustomerMasterExportFields(row);
    const normalized = {
      ...row,
      customer_code: display.customer_code || row.customer_code || "",
      customer_name: display.customer_name || row.customer_name || "",
    };

    const existing = byKey.get(key);
    if (!existing || customerMasterRowScore(normalized) > customerMasterRowScore(existing)) {
      byKey.set(key, normalized);
    }
  }

  return [...byKey.values()].sort((left, right) =>
    String(left.customer_name || "").localeCompare(String(right.customer_name || "")),
  );
}

function parseOutstandingDataset(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "null");
    if (!parsed || typeof parsed !== "object") {
      return { rows: [] };
    }
    return {
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch {
    return { rows: [] };
  }
}

export async function readOutstandingDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;
  return parseOutstandingDataset(data?.setting_value);
}

export function enrichCustomerMasterOutstanding(rows, outstandingDataset) {
  return (rows || []).map((row) => {
    const outstanding = findOutstandingForCustomer(outstandingDataset, row.customer_code, row.customer_name);
    return {
      ...row,
      total_outstanding: Number(outstanding?.total_outstanding || 0),
    };
  });
}

export function applyCustomerMasterOutstandingFilter(rows, outstandingFilter = "all") {
  if (outstandingFilter === "with") {
    return (rows || []).filter((row) => Number(row.total_outstanding || 0) > 0);
  }
  if (outstandingFilter === "without") {
    return (rows || []).filter((row) => Number(row.total_outstanding || 0) <= 0);
  }
  return rows || [];
}

export async function fetchAllFilteredCustomers(admin, filters) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    let query = admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date")
      .order("customer_name", { ascending: true });

    query = applyCustomerMasterFilters(query, filters);

    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const deduped = dedupeCustomerMasterRows(rows);
  const outstandingDataset = await readOutstandingDataset(admin);
  const enriched = enrichCustomerMasterOutstanding(deduped, outstandingDataset);
  return applyCustomerMasterOutstandingFilter(enriched, filters.outstandingFilter);
}

export function customerMasterExportRows(customers) {
  return (customers || []).map((row) => {
    const display = resolveCustomerMasterExportFields(row);
    return {
      "Party Name": display.partyName,
      "Customer Code": display.customer_code,
      "Customer Name": display.customer_name,
      "Salesman Code": row.current_salesman_code || "",
      City: row.city || "",
      Area: row.area || "",
      Lattitude: row.latitude ?? "",
      Longitutde: row.longitude ?? "",
      "GPS Status": customerHasSavedGps(row) ? "With GPS" : "Missing GPS",
      Active: row.is_active ? "Yes" : "No",
      "Total Outstanding": Number(row.total_outstanding || 0),
      "Latest Transaction Date": row.latest_transaction_date || "",
    };
  });
}
