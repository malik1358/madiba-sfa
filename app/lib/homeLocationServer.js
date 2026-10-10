import { applyCustomerGpsUpdate } from "./customerGpsHistory.js";
import {
  CUSTOMER_HOME_LOCATION_PIN_RADIUS_METERS,
  isAtHomeLocation,
} from "./homeLocation.js";

export const CUSTOMER_HOME_LOCATION_CLEANUP_RADIUS_METERS = CUSTOMER_HOME_LOCATION_PIN_RADIUS_METERS;

export async function clearCustomerPinsAtHomeLocation(admin, {
  latitude,
  longitude,
  actor = {},
} = {}) {
  const center = { latitude: Number(latitude), longitude: Number(longitude) };
  const latDelta = CUSTOMER_HOME_LOCATION_CLEANUP_RADIUS_METERS / 110000;
  const lngDelta = latDelta / Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  const pageSize = 500;
  const matches = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,latitude,longitude")
      .gte("latitude", center.latitude - latDelta)
      .lte("latitude", center.latitude + latDelta)
      .gte("longitude", center.longitude - lngDelta)
      .lte("longitude", center.longitude + lngDelta)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const rows = data || [];
    matches.push(...rows.filter((row) => isAtHomeLocation(row, center, CUSTOMER_HOME_LOCATION_CLEANUP_RADIUS_METERS)));
    if (rows.length < pageSize) break;
  }

  let removed = 0;
  for (const customer of matches) {
    await applyCustomerGpsUpdate(admin, {
      customerCode: customer.customer_code,
      latitude: null,
      longitude: null,
      previousLatitude: customer.latitude,
      previousLongitude: customer.longitude,
      actor,
      source: "home_location_cleanup",
    });
    removed += 1;
  }

  return { removed, customerCodes: matches.map((row) => row.customer_code) };
}