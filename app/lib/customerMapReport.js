import { customerHasSavedGps } from "./customerMasterQuery.js";

export const CUSTOMER_MAP_BLANK_CITY = "(no city)";
export const CUSTOMER_MAP_BLANK_AREA = "(no area)";

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

export function normalizeCustomerMapPoint(row) {
  if (!row || !customerHasSavedGps(row)) return null;
  const latitude = toFiniteNumber(row.latitude);
  const longitude = toFiniteNumber(row.longitude);
  if (latitude == null || longitude == null) return null;

  const city = customerMapCityLabel(row.city);
  const area = customerMapAreaLabel(row.area);
  return {
    customer_code: String(row.customer_code || "").trim(),
    customer_name: String(row.customer_name || "").trim(),
    current_salesman_code: String(row.current_salesman_code || "").trim(),
    city,
    area,
    area_key: customerMapAreaKey(city, area),
    latitude,
    longitude,
    is_active: row.is_active !== false,
  };
}

export function filterCustomerMapRows(rows, {
  city = "",
  areaKey = "",
  salesman = "",
  search = "",
  activeOnly = true,
} = {}) {
  const cityNeedle = String(city || "").trim();
  const areaNeedle = String(areaKey || "").trim();
  const salesmanNeedle = String(salesman || "").trim().toUpperCase();
  const searchNeedle = String(search || "").trim().toUpperCase();

  return (rows || []).filter((row) => {
    if (activeOnly && row?.is_active === false) return false;
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

export function buildCustomerMapReport(rows, filters = {}) {
  const filtered = filterCustomerMapRows(rows, filters);
  const areaRows = buildCustomerMapAreaRows(filtered);
  const cityRows = buildCustomerMapCityRows(areaRows);
  const mapPoints = filtered
    .map((row) => normalizeCustomerMapPoint(row))
    .filter(Boolean)
    .sort((left, right) => String(left.customer_name).localeCompare(String(right.customer_name)));

  const withGps = mapPoints.length;
  const total = filtered.length;

  return {
    summary: {
      customers: total,
      with_gps: withGps,
      without_gps: Math.max(0, total - withGps),
      cities: cityRows.length,
      areas: areaRows.length,
    },
    cityRows,
    areaRows,
    mapPoints,
    salesmen: [...new Set(
      filtered
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
