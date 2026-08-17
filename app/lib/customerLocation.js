import {
  GPS_REQUIRED_ERROR,
  haversineDistanceKm,
  hasGpsCoordinates,
} from "./geo.js";

export const CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM = 0.5;

export function customerHasSavedLocation(customer) {
  return hasGpsCoordinates(customer);
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

  const response = await fetch(`/api/customers/location?customerCode=${encodeURIComponent(code)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) return null;
  return payload.customer || null;
}

export async function updateCustomerLocation(accessToken, customerCode, location) {
  const response = await fetch("/api/customers/location", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      customerCode,
      latitude: location.latitude,
      longitude: location.longitude,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to update customer location.");
  }

  return payload.customer;
}

export async function maybePromptCustomerLocationUpdate({
  customerCode,
  customerName = "",
  entryLocation,
  accessToken,
  language = "en",
}) {
  if (!hasGpsCoordinates(entryLocation)) {
    throw new Error(GPS_REQUIRED_ERROR);
  }

  const customer = await fetchCustomerLocation(accessToken, customerCode);
  const displayName = customerName || customer?.customer_name || customerCode;

  if (!customerHasSavedLocation(customer)) {
    const message = language === "ar"
      ? `لا يوجد موقع محفوظ للعميل ${displayName}. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
      : `No saved location for ${displayName}. Update customer location to your current GPS?`;
    if (window.confirm(message)) {
      await updateCustomerLocation(accessToken, customerCode, entryLocation);
    }
    return;
  }

  const distanceKm = distanceFromCustomerKm(entryLocation, customer);
  if (!isFarFromCustomer(entryLocation, customer)) return;

  const message = language === "ar"
    ? `أنت على بعد ${distanceKm.toFixed(2)} كم من موقع ${displayName} المحفوظ. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
    : `You are ${distanceKm.toFixed(2)} km from ${displayName}'s saved location. Update customer location to your current GPS?`;

  if (window.confirm(message)) {
    await updateCustomerLocation(accessToken, customerCode, entryLocation);
  }
}
