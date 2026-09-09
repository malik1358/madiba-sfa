import { PRICE_CACHE_KEY } from "./priceApiConfig.js";
import { loadPricePayload } from "./pricePayload.js";
import { fetchAndHydrateMobileSnapshot, invalidateOutstandingCache } from "./mobileDataCache.js";
import {
  finishDataRefreshJob,
  markDataRefreshStep,
  snapshotRefreshSteps,
  startDataRefreshJob,
} from "./dataRefreshStatus.js";
import {
  parseOfflineRefreshKinds,
  shouldApplyOfflineDataVersion,
} from "./offlineDataBroadcastShared.js";

export { parseOfflineRefreshKinds, shouldApplyOfflineDataVersion };

export const OFFLINE_DATA_REFRESH_EVENT = "madiba-offline-data-refresh";
export const OFFLINE_DATA_REFRESHED_EVENT = "madiba-offline-data-refreshed";
const LAST_VERSION_KEY = "madiba.offlineDataVersion";
const LAST_HASH_KEY = "madiba.offlineDataContentHash";

let refreshInFlight = null;

function readPersistedValue(key) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writePersistedValue(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
    window.sessionStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
}

function readLastAppliedVersion() {
  return Number(readPersistedValue(LAST_VERSION_KEY) || 0);
}

function readLastAppliedHash() {
  return readPersistedValue(LAST_HASH_KEY);
}

function writeLastApplied(version, contentHash) {
  writePersistedValue(LAST_VERSION_KEY, version);
  if (contentHash) writePersistedValue(LAST_HASH_KEY, contentHash);
}

export async function refreshOfflineDeviceData(detail = {}) {
  const kinds = parseOfflineRefreshKinds(detail.kinds);
  const nextVersion = Number(detail.version || Date.now());
  const nextHash = String(detail.contentHash || "").trim();
  if (!shouldApplyOfflineDataVersion(nextVersion, readLastAppliedVersion(), nextHash, readLastAppliedHash())) {
    return { skipped: true, version: nextVersion, contentHash: nextHash };
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const needsSnapshot = kinds.length === 0
      || kinds.includes("transactions")
      || kinds.includes("outstanding");
    const needsPrices = kinds.length === 0
      || kinds.includes("prices")
      || kinds.includes("schemes");

    const steps = snapshotRefreshSteps(needsPrices);
    startDataRefreshJob("device-data", needsSnapshot ? steps : ["prices"]);

    try {
      if (needsSnapshot) {
        if (kinds.length === 0 || kinds.includes("outstanding")) {
          await invalidateOutstandingCache();
        }
        await fetchAndHydrateMobileSnapshot({ manageJob: false });
      }

      if (needsPrices) {
        markDataRefreshStep("prices", "running");
        await loadPricePayload("/api/pricing/cache", PRICE_CACHE_KEY);
        markDataRefreshStep("prices", "done");
      }

      writeLastApplied(nextVersion, nextHash);
      finishDataRefreshJob({ lastSavedAt: Date.now() });
    } catch (error) {
      finishDataRefreshJob({ error: error.message || "Unable to refresh device data." });
      throw error;
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OFFLINE_DATA_REFRESHED_EVENT, {
        detail: { kinds, version: nextVersion },
      }));
    }

    return { skipped: false, version: nextVersion, kinds };
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export function emitOfflineDataRefresh(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_DATA_REFRESH_EVENT, { detail }));
}
