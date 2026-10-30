import { getKsaDateString } from "./workdayActivity.js";
import { isAtHomeLocation } from "./homeLocation.js";

export const DESK_MODE_STORAGE_PREFIX = "madiba-sfa:desk-mode:";
/** Re-use a confirmed at-home reading briefly so module navigations stay snappy. */
export const DESK_MODE_CACHE_TTL_MS = 5 * 60 * 1000;
/** After sign-in at home, keep desk mode through brief GPS gaps while still at home. */
export const DESK_MODE_SIGNIN_GRACE_MS = 30 * 60 * 1000;

function deskModeStorageKey(userId) {
  return `${DESK_MODE_STORAGE_PREFIX}${String(userId || "").trim()}`;
}

function readStorageRaw(storage, key) {
  try {
    return storage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeStorageRaw(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function removeStorageRaw(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function todayDeskModeDayKey(referenceDate = new Date()) {
  return getKsaDateString(referenceDate);
}

/**
 * True when GPS is within the saved home radius. No home pin → not desk mode.
 */
export function isAtHomeDeskLocation(location, homeLocation) {
  if (!homeLocation) return false;
  const latitude = Number(homeLocation.latitude ?? homeLocation.home_latitude);
  const longitude = Number(homeLocation.longitude ?? homeLocation.home_longitude);
  if (![latitude, longitude].every(Number.isFinite)) return false;
  return isAtHomeLocation(location, { latitude, longitude });
}

export function readDeskModeState(userId, referenceDate = new Date()) {
  if (typeof window === "undefined" || !userId) return null;

  const key = deskModeStorageKey(userId);
  const raw = readStorageRaw(window.sessionStorage, key) || readStorageRaw(window.localStorage, key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.day !== todayDeskModeDayKey(referenceDate)) return null;
    return {
      atHome: Boolean(parsed.atHome),
      checkedAtMs: Number(parsed.checkedAtMs) || 0,
      fromSignIn: Boolean(parsed.fromSignIn),
    };
  } catch {
    return null;
  }
}

export function writeDeskModeState(userId, { atHome, fromSignIn = false, checkedAtMs = Date.now() } = {}) {
  if (typeof window === "undefined" || !userId) return;

  const payload = JSON.stringify({
    day: todayDeskModeDayKey(),
    atHome: Boolean(atHome),
    fromSignIn: Boolean(fromSignIn),
    checkedAtMs: Number(checkedAtMs) || Date.now(),
  });
  const key = deskModeStorageKey(userId);
  writeStorageRaw(window.sessionStorage, key, payload);
  writeStorageRaw(window.localStorage, key, payload);
}

export function clearDeskModeState(userId) {
  if (typeof window === "undefined" || !userId) return;
  const key = deskModeStorageKey(userId);
  removeStorageRaw(window.sessionStorage, key);
  removeStorageRaw(window.localStorage, key);
}

/**
 * Fresh cache is still valid for skipping a GPS re-probe.
 */
export function isDeskModeCacheFresh(state, nowMs = Date.now(), ttlMs = DESK_MODE_CACHE_TTL_MS) {
  if (!state?.atHome) return false;
  const age = nowMs - Number(state.checkedAtMs || 0);
  return Number.isFinite(age) && age >= 0 && age <= Number(ttlMs);
}

/**
 * Sign-in desk mode may survive a short GPS failure while the salesman stays home.
 */
export function isDeskModeSignInGraceActive(state, nowMs = Date.now(), graceMs = DESK_MODE_SIGNIN_GRACE_MS) {
  if (!state?.atHome || !state?.fromSignIn) return false;
  const age = nowMs - Number(state.checkedAtMs || 0);
  return Number.isFinite(age) && age >= 0 && age <= Number(graceMs);
}

/**
 * Decide whether missing morning attendance may be waived because the user is at home.
 * Returns { allowDeskMode, atHome, reason }.
 */
export function resolveDeskModeAccess({
  location = null,
  homeLocation = null,
  cached = null,
  gpsFailed = false,
  nowMs = Date.now(),
} = {}) {
  if (location) {
    const atHome = isAtHomeDeskLocation(location, homeLocation);
    return {
      allowDeskMode: atHome,
      atHome,
      reason: atHome ? "at_home" : "away_from_home",
    };
  }

  if (gpsFailed && isDeskModeSignInGraceActive(cached, nowMs)) {
    return {
      allowDeskMode: true,
      atHome: true,
      reason: "signin_grace",
    };
  }

  if (isDeskModeCacheFresh(cached, nowMs)) {
    return {
      allowDeskMode: true,
      atHome: true,
      reason: "cache",
    };
  }

  return {
    allowDeskMode: false,
    atHome: false,
    reason: gpsFailed ? "gps_failed" : "unknown",
  };
}
