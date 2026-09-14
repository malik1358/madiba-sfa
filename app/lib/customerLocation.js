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
export const CUSTOMER_LOCATION_UPDATE_UPDATE = "update";
export const CUSTOMER_LOCATION_UPDATE_SKIP = "skip";
export const CUSTOMER_LOCATION_UPDATE_CANCEL = "cancel";
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
    customer: options.customer || null,
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
  customer = null,
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
      const updated = await saveCustomerGpsFromVisitLocation({
        customerCode,
        entryLocation: location,
        accessToken,
      });
      if (customer && updated) {
        applyCustomerLocation(customer, updated);
      } else if (customer) {
        applyCustomerLocation(customer, {
          latitude: location.latitude,
          longitude: location.longitude,
        });
      }
    } else {
      await maybePromptCustomerLocationUpdate({
        customerCode,
        customerName,
        entryLocation: location,
        accessToken,
        language,
        customer,
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

  try {
    const response = await fetchWithTimeout(`/api/customers/location?customerCode=${encodeURIComponent(code)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) return null;
    return payload.customer || null;
  } catch {
    // Offline / flaky networks should not block visit or collection posting.
    return null;
  }
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

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || !accessToken) {
    if (accessToken) {
      try {
        const { sendJsonResilient } = await import("./offlineApi.js");
        await sendJsonResilient({
          url: "/api/customers/location",
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          jsonBody: payload,
          metadata: {
            type: "customer_location_update",
            customerCode,
          },
          queueFirst: true,
        });
      } catch {
        // Keep the local location even if the offline queue is unavailable.
      }
    }
    return {
      customer_code: customerCode,
      ...payload,
    };
  }

  try {
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
  } catch (error) {
    const { isOfflineLikeError } = await import("./offlineSyncQueue.js");
    if (!isOfflineLikeError(error)) throw error;

    try {
      const { sendJsonResilient } = await import("./offlineApi.js");
      await sendJsonResilient({
        url: "/api/customers/location",
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        jsonBody: payload,
        metadata: {
          type: "customer_location_update",
          customerCode,
        },
        queueFirst: true,
      });
    } catch {
      // Keep the local location even if the offline queue is unavailable.
    }
    return {
      customer_code: customerCode,
      ...payload,
    };
  }
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

export function customerWithUpdatedLocation(customer, updatePayload) {
  if (!customer || !updatePayload) return customer;
  const next = { ...customer };
  if (updatePayload.latitude !== undefined) next.latitude = updatePayload.latitude;
  if (updatePayload.longitude !== undefined) next.longitude = updatePayload.longitude;
  if (updatePayload.area) next.area = updatePayload.area;
  if (updatePayload.city) next.city = updatePayload.city;
  return next;
}

function applyCustomerLocation(customer, updatePayload) {
  if (!customer || !updatePayload) return;
  const next = customerWithUpdatedLocation(customer, updatePayload);
  customer.latitude = next.latitude;
  customer.longitude = next.longitude;
  if (next.area) customer.area = next.area;
  if (next.city) customer.city = next.city;
}

function buildCustomerLocationUpdateMessage({
  language = "en",
  displayName = "",
  distanceKm = 0,
  hasSavedLocation = true,
}) {
  if (!hasSavedLocation) {
    return language === "ar"
      ? `لا يوجد موقع محفوظ للعميل ${displayName}. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
      : `No saved location for ${displayName}. Update customer location to your current GPS?`;
  }

  return language === "ar"
    ? `أنت على بعد ${distanceKm.toFixed(2)} كم من موقع ${displayName} المحفوظ. هل تريد تحديث موقع العميل إلى GPS الحالي؟`
    : `You are ${distanceKm.toFixed(2)} km from ${displayName}'s saved location. Update customer location to your current GPS?`;
}

export function shouldSkipCustomerLocationWrite(customerCode, customer) {
  return isProspectCustomerCode(customerCode)
    || Boolean(customer?.is_prospect)
    || /^PROSPECT-/i.test(String(customerCode || "").trim());
}

export async function evaluateCustomerLocationUpdatePrompt({
  customerCode,
  customerName = "",
  entryLocation,
  accessToken,
  language = "en",
  customer: knownCustomer = null,
  skipReverseGeocode = false,
}) {
  if (!hasGpsCoordinates(entryLocation)) {
    return null;
  }

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const skipGeocode = skipReverseGeocode || offline;

  const skipLocationWrite = shouldSkipCustomerLocationWrite(customerCode, knownCustomer);
  let customer = knownCustomer && typeof knownCustomer === "object" ? knownCustomer : null;
  if (!customer && !skipLocationWrite) {
    customer = await fetchCustomerLocation(accessToken, customerCode);
  }
  if (!customer) return null;

  const displayName = customerName || customer?.customer_name || customerCode;

  let geocoded = { area: "", street: "", city: "" };
  if (!skipGeocode && !skipLocationWrite && !customerHasArea(customer)) {
    try {
      geocoded = await reverseGeocodeCoordinates(entryLocation.latitude, entryLocation.longitude);
      const detectedArea = String(geocoded.area || "").trim();
      const updatePayload = buildLocationUpdatePayload(entryLocation, customer, geocoded);
      if (detectedArea) {
        await updateCustomerLocation(accessToken, customerCode, updatePayload);
        applyCustomerLocation(customer, updatePayload);
      }
    } catch {
      // Offline / geocode failures should not block the visit.
    }
  }

  const updatePayload = buildLocationUpdatePayload(entryLocation, customer, geocoded);

  const needsPrompt = !customerHasSavedLocation(customer)
    || isFarFromCustomer(entryLocation, customer);
  if (!needsPrompt) return null;

  const distanceKm = distanceFromCustomerKm(entryLocation, customer);

  return {
    message: buildCustomerLocationUpdateMessage({
      language,
      displayName,
      distanceKm: distanceKm ?? 0,
      hasSavedLocation: customerHasSavedLocation(customer),
    }),
    accessToken,
    customerCode,
    updatePayload,
  };
}

export async function applyCustomerLocationUpdateFromPrompt(promptDetails) {
  if (!promptDetails) return null;
  return updateCustomerLocation(
    promptDetails.accessToken,
    promptDetails.customerCode,
    promptDetails.updatePayload,
  );
}

async function defaultLegacyLocationUpdatePrompt(promptDetails) {
  return window.confirm(promptDetails.message)
    ? CUSTOMER_LOCATION_UPDATE_UPDATE
    : CUSTOMER_LOCATION_UPDATE_SKIP;
}

export async function maybePromptCustomerLocationUpdate({
  customerCode,
  customerName = "",
  entryLocation,
  accessToken,
  language = "en",
  promptChoice,
  customer = null,
  skipReverseGeocode = false,
}) {
  const promptDetails = await evaluateCustomerLocationUpdatePrompt({
    customerCode,
    customerName,
    entryLocation,
    accessToken,
    language,
    customer,
    skipReverseGeocode,
  });
  if (!promptDetails) return CUSTOMER_LOCATION_UPDATE_SKIP;

  const resolveChoice = promptChoice || defaultLegacyLocationUpdatePrompt;
  const choice = await resolveChoice(promptDetails);
  if (choice === CUSTOMER_LOCATION_UPDATE_UPDATE && !shouldSkipCustomerLocationWrite(customerCode, customer)) {
    try {
      await applyCustomerLocationUpdateFromPrompt(promptDetails);
    } catch (locationError) {
      // Keep visiting/order flows unblocked; still use accepted GPS for distance.
      console.warn("Customer location update skipped", locationError);
    }
    // Keep in-memory customer GPS in sync so distance-from-customer uses the new point.
    applyCustomerLocation(customer, promptDetails.updatePayload);
  }
  return choice;
}
