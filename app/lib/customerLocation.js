import { isProspectCustomerCode } from "./customerCode.js";
import { shouldRequireTransactionGps } from "./moduleAccess.js";
import {
  captureGpsLocation,
  GPS_REQUIRED_ERROR,
  haversineDistanceKm,
  hasGpsCoordinates,
  reverseGeocodeCoordinates,
} from "./geo.js";

export const CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM = 0.5;
export const GPS_CANCELLED_ERROR = "Location update cancelled.";
const CUSTOMER_LOCATION_FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = CUSTOMER_LOCATION_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function customerHasSavedLocation(customer) {
  return hasGpsCoordinates(customer);
}

export function customerHasArea(customer) {
  return Boolean(String(customer?.area || "").trim());
}

export async function promptCustomerLocationUpdateAfterVisit({
  language = "en",
  customerCode = "",
  customerName = "",
  entryLocation,
  accessToken = "",
}) {
  if (!hasGpsCoordinates(entryLocation) || !accessToken || !customerCode) return;

  await maybePromptCustomerLocationUpdate({
    customerCode,
    customerName,
    entryLocation,
    accessToken,
    language,
  });
}

export async function captureGpsLocationWithFallbackConfirm(language = "en", options = {}) {
  return resolveVisitGpsAndUpdateCustomer({
    language,
    customerCode: options.customerCode || "",
    customerName: options.customerName || "",
    accessToken: options.accessToken || "",
    skipCustomerLocationUpdate: Boolean(options.skipCustomerLocationUpdate),
    role: options.role || "",
  });
}

export async function saveCustomerGpsFromVisitLocation({
  customerCode,
  entryLocation,
  accessToken,
}) {
  if (isProspectCustomerCode(customerCode) || !hasGpsCoordinates(entryLocation) || !accessToken) {
    return null;
  }

  const customer = await fetchCustomerLocation(accessToken, customerCode);
  const geocoded = await reverseGeocodeCoordinates(entryLocation.latitude, entryLocation.longitude);
  const updatePayload = buildLocationUpdatePayload(entryLocation, customer, geocoded);
  return updateCustomerLocation(accessToken, customerCode, updatePayload);
}

export async function resolveVisitGpsAndUpdateCustomer({
  language = "en",
  customerCode = "",
  customerName = "",
  accessToken = "",
  skipCustomerLocationUpdate = false,
  role = "",
}) {
  if (!shouldRequireTransactionGps(role)) {
    return null;
  }

  const displayName = customerName || customerCode || "this customer";
  let location = null;
  let saveCustomerGps = false;

  try {
    location = await captureGpsLocation();
  } catch {
    const message = language === "ar"
      ? `GPS غير متاح. هل تريد حفظ موقعك الحالي كموقع GPS للعميل ${displayName}؟`
      : `GPS is not available. Save your current location as the GPS location for ${displayName}?`;
    if (!window.confirm(message)) {
      throw new Error(GPS_REQUIRED_ERROR);
    }

    try {
      location = await captureGpsLocation();
      saveCustomerGps = true;
    } catch {
      throw new Error(GPS_REQUIRED_ERROR);
    }
  }

  if (!hasGpsCoordinates(location)) {
    throw new Error(GPS_REQUIRED_ERROR);
  }

  if (
    !skipCustomerLocationUpdate
    && location
    && accessToken
    && customerCode
    && !isProspectCustomerCode(customerCode)
  ) {
    if (saveCustomerGps) {
      await saveCustomerGpsFromVisitLocation({
        customerCode,
        entryLocation: location,
        accessToken,
      });
    } else {
      await maybePromptCustomerLocationUpdate({
        customerCode,
        customerName,
        entryLocation: location,
        accessToken,
        language,
      });
    }
  }

  return location;
}

export function distanceFromCustomerKm(entryLocation, customer) {
  if (!hasGpsCoordinates(entryLocation) || !customerHasSavedLocation(customer)) {
    return null;
  }

  return haversineDistanceKm(
    Number(entryLocation.latitude),
    Number(entryLocation.longitude),
    Number(customer.latitude),
    Number(customer.longitude),
  );
}

export function isFarFromCustomer(
  entryLocation,
  customer,
  thresholdKm = CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM,
) {
  const distanceKm = distanceFromCustomerKm(entryLocation, customer);
  if (distanceKm === null) return false;
  return distanceKm > thresholdKm;
}

export async function fetchCustomerLocation(accessToken, customerCode) {
  const code = String(customerCode || "").trim();
  if (!code || !accessToken) return null;

  const response = await fetchWithTimeout(`/api/customers/location?customerCode=${encodeURIComponent(code)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) return null;
  return payload.customer || null;
}

export async function updateCustomerLocation(accessToken, customerCode, location) {
  const payload = {
    customerCode,
    latitude: location.latitude,
    longitude: location.longitude,
  };

  if (location.area !== undefined) {
    payload.area = location.area;
  }
  if (location.city !== undefined) {
    payload.city = location.city;
  }

  const response = await fetchWithTimeout("/api/customers/location", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.error || "Unable to update customer location.");
  }

  return result.customer;
}

function buildLocationUpdatePayload(entryLocation, customer, geocoded = {}) {
  const detectedArea = String(geocoded.area || "").trim();
  const detectedCity = String(geocoded.city || "").trim();

  return {
    latitude: entryLocation.latitude,
    longitude: entryLocation.longitude,
    area: detectedArea || String(customer?.area || "").trim(),
    city: detectedCity || String(customer?.city || "").trim(),
  };
}

function applyCustomerLocation(customer, updatePayload) {
  if (!customer) return;
  customer.latitude = updatePayload.latitude;
  customer.longitude = updatePayload.longitude;
  if (updatePayload.area) customer.area = updatePayload.area;
  if (updatePayload.city) customer.city = updatePayload.city;
}

export async function maybePromptCustomerLocationUpdate({
  customerCode,
  customerName = "",
  entryLocation,
  accessToken,
  language = "en",
}) {
  if (isProspectCustomerCode(customerCode)) {
    return;
  }

  const customer = await fetchCustomerLocation(accessToken, customerCode);
  if (!customer) return;

  const displayName = customerName || customer?.customer_name || customerCode;

  if (!hasGpsCoordinates(entryLocation)) {
    return;
  }

  const geocoded = await reverseGeocodeCoordinates(entryLocation.latitude, entryLocation.longitude);
  const detectedArea = String(geocoded.area || "").trim();
  const updatePayload = buildLocationUpdatePayload(entryLocation, customer, geocoded);

  if (detectedArea && !customerHasArea(customer)) {
    await updateCustomerLocation(accessToken, customerCode, updatePayload);
    applyCustomerLocation(customer, updatePayload);
  }

  if (!customerHasSavedLocation(customer)) {
    const message = language === "ar"
      ? `لا يوجد موقع محفوظ للعميل ${displayName}. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
      : `No saved location for ${displayName}. Update customer location to your current GPS?`;
    if (window.confirm(message)) {
      await updateCustomerLocation(accessToken, customerCode, updatePayload);
    }
    return;
  }

  const distanceKm = distanceFromCustomerKm(entryLocation, customer);
  if (!isFarFromCustomer(entryLocation, customer)) return;

  const message = language === "ar"
    ? `أنت على بعد ${distanceKm.toFixed(2)} كم من موقع ${displayName} المحفوظ. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
    : `You are ${distanceKm.toFixed(2)} km from ${displayName}'s saved location. Update customer location to your current GPS?`;

  if (window.confirm(message)) {
    await updateCustomerLocation(accessToken, customerCode, updatePayload);
  }
}
