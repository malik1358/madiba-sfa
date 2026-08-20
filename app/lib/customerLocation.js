import { isProspectCustomerCode } from "./customerCode.js";
import {
  captureGpsLocation,
  haversineDistanceKm,
  hasGpsCoordinates,
  reverseGeocodeCoordinates,
} from "./geo.js";

export const CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM = 0.5;
export const GPS_CANCELLED_ERROR = "Location update cancelled.";

export function customerHasSavedLocation(customer) {
  return hasGpsCoordinates(customer);
}

export function customerHasArea(customer) {
  return Boolean(String(customer?.area || "").trim());
}

export async function captureGpsLocationWithFallbackConfirm(language = "en") {
  try {
    return await captureGpsLocation();
  } catch (error) {
    const message = language === "ar"
      ? "GPS غير متاح. هل تريد المتابعة بدون GPS؟"
      : "GPS is not available. Continue without GPS?";
    if (window.confirm(message)) {
      return null;
    }
    throw error;
  }
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

  const response = await fetch("/api/customers/location", {
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

function confirmContinueWithoutArea(displayName, language) {
  const message = language === "ar"
    ? `لا توجد منطقة محفوظة للعميل ${displayName}. المتابعة بدون تحديث المنطقة؟`
    : `No saved area for ${displayName}. Continue without updating the area?`;
  if (!window.confirm(message)) {
    throw new Error(GPS_CANCELLED_ERROR);
  }
}

function confirmDetectedArea(displayName, detectedArea, language) {
  const message = language === "ar"
    ? `تم تحديد المنطقة: ${detectedArea}. هل تريد حفظها للعميل ${displayName}؟`
    : `Detected area: ${detectedArea}. Save this area for ${displayName}?`;
  return window.confirm(message);
}

function confirmUndetectedArea(displayName, language) {
  const message = language === "ar"
    ? `تعذر تحديد المنطقة من GPS للعميل ${displayName}. المتابعة بدون حفظ المنطقة؟`
    : `Could not detect an area from GPS for ${displayName}. Continue without saving the area?`;
  if (!window.confirm(message)) {
    throw new Error(GPS_CANCELLED_ERROR);
  }
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
  const displayName = customerName || customer?.customer_name || customerCode;

  if (!hasGpsCoordinates(entryLocation)) {
    if (!customerHasArea(customer)) {
      confirmContinueWithoutArea(displayName, language);
    }
    return;
  }

  const geocoded = await reverseGeocodeCoordinates(entryLocation.latitude, entryLocation.longitude);
  const detectedArea = String(geocoded.area || "").trim();
  const updatePayload = buildLocationUpdatePayload(entryLocation, customer, geocoded);

  if (!customerHasSavedLocation(customer)) {
    let message = language === "ar"
      ? `لا يوجد موقع محفوظ للعميل ${displayName}. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
      : `No saved location for ${displayName}. Update customer location to your current GPS?`;
    if (detectedArea && !customerHasArea(customer)) {
      message += language === "ar"
        ? `\nالمنطقة المقترحة: ${detectedArea}`
        : `\nSuggested area: ${detectedArea}`;
    }
    if (window.confirm(message)) {
      await updateCustomerLocation(accessToken, customerCode, updatePayload);
    } else if (detectedArea && !customerHasArea(customer)) {
      if (confirmDetectedArea(displayName, detectedArea, language)) {
        await updateCustomerLocation(accessToken, customerCode, updatePayload);
      } else {
        confirmUndetectedArea(displayName, language);
      }
    } else if (!customerHasArea(customer)) {
      confirmUndetectedArea(displayName, language);
    }
    return;
  }

  if (detectedArea && !customerHasArea(customer)) {
    if (confirmDetectedArea(displayName, detectedArea, language)) {
      await updateCustomerLocation(accessToken, customerCode, updatePayload);
    } else {
      confirmUndetectedArea(displayName, language);
    }
  } else if (!customerHasArea(customer)) {
    confirmUndetectedArea(displayName, language);
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
