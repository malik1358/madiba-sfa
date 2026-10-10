import {
  CUSTOMER_HOME_LOCATION_PIN_RADIUS_METERS,
  isAtHomeLocation,
} from "./homeLocation.js";
import {
  isAtMadibaStore,
  MADIBA_STORE_CUSTOMER_GPS_ERROR,
} from "./madibaStoreLocation.js";

function isMissingHomeLocationSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "42703"
    || code === "42P01"
    || (message.includes("column") && message.includes("does not exist"))
    || (message.includes("relation") && message.includes("does not exist"));
}

export const CUSTOMER_GPS_WRITE_BLOCK_HOME =
  "Customer location cannot be set to a saved home location. GPS is kept on the visit/order report only.";
export const CUSTOMER_GPS_WRITE_BLOCK_ACTOR_HOME =
  "Customer location cannot be updated from within 500 m of your saved home location. GPS is kept on the visit/order report only.";

export function buildCustomerGpsReportOnlyMessage({
  language = "en",
  reason = "store",
} = {}) {
  if (language === "ar") {
    if (reason === "home") {
      return "سيتم الاحتفاظ بإحداثيات GPS لهذا التقرير فقط، ولن تُحفظ كموقع للعميل لأن هذا موقع منزل محفوظ.";
    }
    return "سيتم الاحتفاظ بإحداثيات GPS لهذا التقرير فقط، ولن تُحفظ كموقع للعميل لأن هذا موقع متجر ماديبا.";
  }

  if (reason === "home") {
    return "This GPS will be kept for the visit/order report, but will not be saved as the customer location because this is a saved home location.";
  }
  return "This GPS will be kept for the visit/order report, but will not be saved as the customer location because this is the MADIBA store.";
}

export function classifyCustomerGpsWriteBlock(location, homeLocations = []) {
  if (isAtMadibaStore(location)) {
    return {
      reason: "store",
      error: MADIBA_STORE_CUSTOMER_GPS_ERROR,
      messageEn: buildCustomerGpsReportOnlyMessage({ language: "en", reason: "store" }),
      messageAr: buildCustomerGpsReportOnlyMessage({ language: "ar", reason: "store" }),
    };
  }

  const homes = Array.isArray(homeLocations) ? homeLocations : [];
  for (const home of homes) {
    if (isAtHomeLocation(location, home, CUSTOMER_HOME_LOCATION_PIN_RADIUS_METERS)) {
      return {
        reason: "home",
        error: CUSTOMER_GPS_WRITE_BLOCK_HOME,
        messageEn: buildCustomerGpsReportOnlyMessage({ language: "en", reason: "home" }),
        messageAr: buildCustomerGpsReportOnlyMessage({ language: "ar", reason: "home" }),
      };
    }
  }

  return null;
}

export async function loadSavedHomeLocations(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("home_latitude,home_longitude")
    .not("home_latitude", "is", null)
    .not("home_longitude", "is", null);

  if (error) {
    if (isMissingHomeLocationSchemaError(error)) return [];
    throw error;
  }

  return (data || [])
    .map((row) => ({
      latitude: Number(row.home_latitude),
      longitude: Number(row.home_longitude),
    }))
    .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
}

export async function resolveCustomerGpsWriteBlock(admin, location) {
  if (!location || location.latitude == null || location.longitude == null) return null;
  const homeLocations = await loadSavedHomeLocations(admin);
  return classifyCustomerGpsWriteBlock(location, homeLocations);
}

export function reportOnlyMessageForBlock(block, language = "en") {
  if (!block) return "";
  return language === "ar" ? block.messageAr : block.messageEn;
}
