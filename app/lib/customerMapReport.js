import { ACTIVE_CUSTOMERS_WINDOW_DAYS, rollingWindowBounds } from "./activeCustomers.js";
import { salesDateKey } from "./categoryGrowth.js";
import { customerHasSavedGps } from "./customerMasterQuery.js";
import { getKsaDateString } from "./workdayActivity.js";

export const CUSTOMER_MAP_BLANK_CITY = "(no city)";
export const CUSTOMER_MAP_BLANK_AREA = "(no area)";
export const CUSTOMER_MAP_SCOPE_ALL = "all";
export const CUSTOMER_MAP_SCOPE_TRADING = "trading";

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCustomerMapScope(rawValue, { activeOnly } = {}) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (value === CUSTOMER_MAP_SCOPE_ALL || value === CUSTOMER_MAP_SCOPE_TRADING) return value;
  // Legacy activeOnly=0 meant show everyone; activeOnly=1 used master is_active.
  if (activeOnly === false || activeOnly === 0 || activeOnly === "0") return CUSTOMER_MAP_SCOPE_ALL;
  return CUSTOMER_MAP_SCOPE_TRADING;
}

export function customerMapTradingWindow(asOfDate = getKsaDateString()) {
  return rollingWindowBounds(asOfDate, ACTIVE_CUSTOMERS_WINDOW_DAYS);
}

export function customerBoughtInWindow(row, window = customerMapTradingWindow()) {
  const purchaseDate = salesDateKey(row?.latest_transaction_date || row?.bought_on);
  if (!purchaseDate || !window?.start || !window?.end) return false;
  return purchaseDate >= window.start && purchaseDate <= window.end;
}

export function customerHasOutstandingBalance(row) {
  return Number(row?.total_outstanding || 0) > 0;
}

export function isCustomerMapTradingActive(row, window = customerMapTradingWindow()) {
  return customerBoughtInWindow(row, window) || customerHasOutstandingBalance(row);
}

export function normalizeCustomerMapLabel(value, blankLabel) {
  const trimmed = String(value || "").trim();
  return trimmed || blankLabel;
}

export function customerMapCityLabel(value) {
  return normalizeCustomerMapLabel(value, CUSTOMER_MAP_BLANK_CITY);
}

export function customerMapAreaLabel(value) {
  return normalizeCustomerMapLabel(value, CUSTOMER_MAP_BLANK_AREA);
}

export function customerMapAreaKey(city, area) {
  return `${customerMapCityLabel(city)}||${customerMapAreaLabel(area)}`;
}

export function parseCustomerMapAreaKey(key) {
  const raw = String(key || "");
  const splitAt = raw.indexOf("||");
  if (splitAt < 0) {
    return { city: CUSTOMER_MAP_BLANK_CITY, area: CUSTOMER_MAP_BLANK_AREA };
  }
  return {
    city: raw.slice(0, splitAt) || CUSTOMER_MAP_BLANK_CITY,
    area: raw.slice(splitAt + 2) || CUSTOMER_MAP_BLANK_AREA,
  };
}

export function normalizeCustomerMapListRow(row, window = customerMapTradingWindow()) {
  if (!row) return null;
  const city = customerMapCityLabel(row.city);
  const area = customerMapAreaLabel(row.area);
  const hasGps = customerHasSavedGps(row);
  const latitude = hasGps ? toFiniteNumber(row.latitude) : null;
  const longitude = hasGps ? toFiniteNumber(row.longitude) : null;
  const boughtInWindow = customerBoughtInWindow(row, window);
  const hasOutstanding = customerHasOutstandingBalance(row);
  return {
    customer_code: String(row.customer_code || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    current_salesman_code: String(row.current_salesman_code || "").trim(),
    city,
    area,
    area_key: customerMapAreaKey(city, area),
    has_gps: hasGps,
    latitude,
    longitude,
    is_active: row.is_active !== false,
    latest_transaction_date: salesDateKey(row.latest_transaction_date) || "",
    total_outstanding: Number(row.total_outstanding || 0),
    bought_in_window: boughtInWindow,
    has_outstanding: hasOutstanding,
    trading_active: boughtInWindow || hasOutstanding,
  };
}

export function normalizeCustomerMapPoint(row) {
  const listRow = normalizeCustomerMapListRow(row);
  if (!listRow?.has_gps || listRow.latitude == null || listRow.longitude == null) return null;
  return listRow;
}

export function filterCustomerMapRows(rows, {
  city = "",
  areaKey = "",
  salesman = "",
  search = "",
  scope = CUSTOMER_MAP_SCOPE_TRADING,
  activeOnly,
  asOfDate = getKsaDateString(),
} = {}) {
  const cityNeedle = String(city || "").trim();
  const areaNeedle = String(areaKey || "").trim();
  const salesmanNeedle = String(salesman || "").trim().toUpperCase();
  const searchNeedle = String(search || "").trim().toUpperCase();
  const normalizedScope = normalizeCustomerMapScope(scope, { activeOnly });
  const window = customerMapTradingWindow(asOfDate);

  return (rows || []).filter((row) => {
    if (normalizedScope === CUSTOMER_MAP_SCOPE_TRADING && !isCustomerMapTradingActive(row, window)) {
      return false;
    }
    if (cityNeedle && customerMapCityLabel(row?.city) !== cityNeedle) return false;
    if (areaNeedle && customerMapAreaKey(row?.city, row?.area) !== areaNeedle) return false;
    if (salesmanNeedle) {
      const code = String(row?.current_salesman_code || "").trim().toUpperCase();
      if (code !== salesmanNeedle) return false;
    }
    if (searchNeedle) {
      const haystack = `${row?.customer_code || ""} ${row?.customer_name || ""}`.toUpperCase();
      if (!haystack.includes(searchNeedle)) return false;
    }
    return true;
  });
}

export function buildCustomerMapAreaRows(rows) {
  const byKey = new Map();

  for (const row of rows || []) {
    const city = customerMapCityLabel(row?.city);
    const area = customerMapAreaLabel(row?.area);
    const key = customerMapAreaKey(city, area);
    const existing = byKey.get(key) || {
      area_key: key,
      city,
      area,
      customers: 0,
      with_gps: 0,
      without_gps: 0,
      latitude_sum: 0,
      longitude_sum: 0,
      gps_points: 0,
    };

    existing.customers += 1;
    if (customerHasSavedGps(row)) {
      existing.with_gps += 1;
      const latitude = toFiniteNumber(row.latitude);
      const longitude = toFiniteNumber(row.longitude);
      if (latitude != null && longitude != null) {
        existing.latitude_sum += latitude;
        existing.longitude_sum += longitude;
        existing.gps_points += 1;
      }
    } else {
      existing.without_gps += 1;
    }
    byKey.set(key, existing);
  }

  return [...byKey.values()]
    .map((row) => ({
      area_key: row.area_key,
      city: row.city,
      area: row.area,
      customers: row.customers,
      with_gps: row.with_gps,
      without_gps: row.without_gps,
      latitude: row.gps_points > 0 ? row.latitude_sum / row.gps_points : null,
      longitude: row.gps_points > 0 ? row.longitude_sum / row.gps_points : null,
    }))
    .sort((left, right) => {
      if (right.customers !== left.customers) return right.customers - left.customers;
      const cityCompare = String(left.city).localeCompare(String(right.city));
      if (cityCompare) return cityCompare;
      return String(left.area).localeCompare(String(right.area));
    });
}

export function buildCustomerMapCityRows(areaRows) {
  const byCity = new Map();
  for (const row of areaRows || []) {
    const city = customerMapCityLabel(row?.city);
    const existing = byCity.get(city) || {
      city,
      areas: 0,
      customers: 0,
      with_gps: 0,
      without_gps: 0,
    };
    existing.areas += 1;
    existing.customers += Number(row.customers || 0);
    existing.with_gps += Number(row.with_gps || 0);
    existing.without_gps += Number(row.without_gps || 0);
    byCity.set(city, existing);
  }

  return [...byCity.values()].sort((left, right) => {
    if (right.customers !== left.customers) return right.customers - left.customers;
    return String(left.city).localeCompare(String(right.city));
  });
}

export function buildCustomerMapListRows(rows, window = customerMapTradingWindow()) {
  return (rows || [])
    .map((row) => normalizeCustomerMapListRow(row, window))
    .filter((row) => row?.customer_code)
    .sort((left, right) => {
      const nameCompare = String(left.customer_name).localeCompare(String(right.customer_name));
      if (nameCompare) return nameCompare;
      return String(left.customer_code).localeCompare(String(right.customer_code));
    });
}

export function customersForAreaKey(listRows, areaKey) {
  const key = String(areaKey || "").trim();
  if (!key) return [];
  return (listRows || []).filter((row) => row.area_key === key);
}

export function buildCustomerMapReport(rows, filters = {}) {
  const asOfDate = salesDateKey(filters.asOfDate) || getKsaDateString();
  const scope = normalizeCustomerMapScope(filters.scope, { activeOnly: filters.activeOnly });
  const window = customerMapTradingWindow(asOfDate);
  const filtered = filterCustomerMapRows(rows, { ...filters, scope, asOfDate });
  const areaRows = buildCustomerMapAreaRows(filtered);
  const cityRows = buildCustomerMapCityRows(areaRows);
  const customers = buildCustomerMapListRows(filtered, window);
  const mapPoints = customers.filter((row) => row.has_gps && row.latitude != null && row.longitude != null);

  const withGps = mapPoints.length;
  const total = customers.length;

  return {
    summary: {
      customers: total,
      with_gps: withGps,
      without_gps: Math.max(0, total - withGps),
      cities: cityRows.length,
      areas: areaRows.length,
      bought_in_window: customers.filter((row) => row.bought_in_window).length,
      with_outstanding: customers.filter((row) => row.has_outstanding).length,
    },
    scope,
    tradingWindow: window,
    cityRows,
    areaRows,
    customers,
    mapPoints,
    salesmen: [...new Set(
      customers
        .map((row) => String(row?.current_salesman_code || "").trim())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right)),
    cities: cityRows.map((row) => row.city),
  };
}

export function customerMapExportRows(areaRows) {
  return (areaRows || []).map((row) => ({
    City: row.city,
    Area: row.area,
    Customers: Number(row.customers || 0),
    "With GPS": Number(row.with_gps || 0),
    "Without GPS": Number(row.without_gps || 0),
  }));
}

export function customerMapCustomerExportRows(listRows) {
  return (listRows || []).map((row) => ({
    Code: row.customer_code,
    Customer: row.customer_name,
    Salesman: row.current_salesman_code || "",
    City: row.city,
    Area: row.area,
    GPS: row.has_gps ? "Yes" : "No",
    Latitude: row.has_gps ? row.latitude : "",
    Longitude: row.has_gps ? row.longitude : "",
  }));
}
