export function normalizeCustomerMasterSearch(value) {
  return String(value || "").trim();
}

export function normalizeCustomerMasterGpsFilter(rawValue, legacyMissingGps = false) {
  return String(rawValue || (legacyMissingGps ? "without" : "all")).toLowerCase();
}

export function applyCustomerMasterFilters(query, { search = "", gpsFilter = "all" } = {}) {
  let nextQuery = query;

  if (search) {
    nextQuery = nextQuery.or(`customer_code.ilike.%${search}%,customer_name.ilike.%${search}%`);
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

  return rows;
}

export function customerHasSavedGps(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

export function customerMasterExportRows(customers) {
  return (customers || []).map((row) => ({
    "Party Name": `${row.customer_code || ""} ${row.customer_name || ""}`.trim(),
    "Customer Code": row.customer_code || "",
    "Customer Name": row.customer_name || "",
    "Salesman Code": row.current_salesman_code || "",
    City: row.city || "",
    Area: row.area || "",
    Lattitude: row.latitude ?? "",
    Longitutde: row.longitude ?? "",
    "GPS Status": customerHasSavedGps(row) ? "With GPS" : "Missing GPS",
    Active: row.is_active ? "Yes" : "No",
    "Latest Transaction Date": row.latest_transaction_date || "",
  }));
}
