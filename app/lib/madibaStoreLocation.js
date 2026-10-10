import { haversineDistanceMeters } from "./homeLocation.js";

/** Fixed MADIBA office / warehouse pin used for store-side entry detection. */
export const MADIBA_STORE_LATITUDE = 24.56825;
export const MADIBA_STORE_LONGITUDE = 46.74082;
export const MADIBA_STORE_BLOCK_RADIUS_METERS = 50;
export const MADIBA_STORE_LABEL = "MADIBA store";
export const MADIBA_STORE_LABEL_AR = "متجر ماديبا";
export const MADIBA_STORE_CUSTOMER_GPS_ERROR =
  "Customer location cannot be set within 50 m of the MADIBA store. GPS is kept on the visit/order report only.";

export function madibaStoreLocation() {
  return {
    latitude: MADIBA_STORE_LATITUDE,
    longitude: MADIBA_STORE_LONGITUDE,
  };
}

export function distanceFromMadibaStoreMeters(location) {
  return haversineDistanceMeters(location, madibaStoreLocation());
}

export function isAtMadibaStore(
  location,
  radiusMeters = MADIBA_STORE_BLOCK_RADIUS_METERS,
) {
  const distance = distanceFromMadibaStoreMeters(location);
  return distance !== null && distance <= Number(radiusMeters);
}

export function madibaStoreLabel(language = "en") {
  return language === "ar" ? MADIBA_STORE_LABEL_AR : MADIBA_STORE_LABEL;
}

export function assertNotMadibaStoreCustomerLocation(location) {
  if (isAtMadibaStore(location)) {
    throw new Error(MADIBA_STORE_CUSTOMER_GPS_ERROR);
  }
}
