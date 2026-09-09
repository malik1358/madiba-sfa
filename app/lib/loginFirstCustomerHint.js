import { CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM } from "./customerLocation.js";
import { haversineDistanceKm, parseGpsFromActivityNote } from "./geo.js";

export const LOGIN_LOGOUT_CUSTOMER_HINT_EVENT = "madiba-login-logout-customer-hint";
export const LOGIN_FIRST_CUSTOMER_HINT_EVENT = LOGIN_LOGOUT_CUSTOMER_HINT_EVENT;
export const LOGIN_FIRST_CUSTOMER_HINT_STORAGE_KEY = "madiba_login_first_customer_hint";
export const LOGOUT_LAST_CUSTOMER_HINT_STORAGE_KEY = "madiba_logout_last_customer_hint";
export const LOGIN_FIRST_CUSTOMER_DISTANCE_THRESHOLD_KM = CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM;

export const FIRST_CUSTOMER_ENTRY_TYPES = new Set([
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
  "ORDER_DRAFT",
  "PROSPECT_FOLLOW_UP",
  "PROSPECT_REGISTERED",
]);

export function requestLoginLogoutCustomerHintCheck() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOGIN_LOGOUT_CUSTOMER_HINT_EVENT));
}

export const requestLoginFirstCustomerHintCheck = requestLoginLogoutCustomerHintCheck;

export function loginFirstCustomerHintStorageKey(userId, reportDate) {
  return `${LOGIN_FIRST_CUSTOMER_HINT_STORAGE_KEY}:${String(reportDate || "").trim()}:${String(userId || "").trim()}`;
}

export function hasDismissedLoginFirstCustomerHint(userId, reportDate, storage = globalThis.localStorage) {
  if (!storage || !userId || !reportDate) return false;
  try {
    return storage.getItem(loginFirstCustomerHintStorageKey(userId, reportDate)) === "1";
  } catch {
    return false;
  }
}

export function dismissLoginFirstCustomerHint(userId, reportDate, storage = globalThis.localStorage) {
  if (!storage || !userId || !reportDate) return;
  try {
    storage.setItem(loginFirstCustomerHintStorageKey(userId, reportDate), "1");
  } catch {
    // Ignore storage failures; the dialog can appear again later.
  }
}

export function logoutLastCustomerHintStorageKey(userId, reportDate) {
  return `${LOGOUT_LAST_CUSTOMER_HINT_STORAGE_KEY}:${String(reportDate || "").trim()}:${String(userId || "").trim()}`;
}

export function hasDismissedLogoutLastCustomerHint(userId, reportDate, storage = globalThis.localStorage) {
  if (!storage || !userId || !reportDate) return false;
  try {
    return storage.getItem(logoutLastCustomerHintStorageKey(userId, reportDate)) === "1";
  } catch {
    return false;
  }
}

export function dismissLogoutLastCustomerHint(userId, reportDate, storage = globalThis.localStorage) {
  if (!storage || !userId || !reportDate) return;
  try {
    storage.setItem(logoutLastCustomerHintStorageKey(userId, reportDate), "1");
  } catch {
    // Ignore storage failures; the dialog can appear again later.
  }
}

function logType(row) {
  return String(row?.entry_type || row?.entryType || row?.transactionType || row?.transaction_type || "")
    .trim()
    .toUpperCase();
}

export function findMorningAttendanceLog(logs = []) {
  return (Array.isArray(logs) ? logs : []).find((row) => logType(row) === "MORNING_ATTENDANCE") || null;
}

export function findFirstCustomerEntryLog(logs = []) {
  return (Array.isArray(logs) ? logs : []).find((row) => FIRST_CUSTOMER_ENTRY_TYPES.has(logType(row))) || null;
}

export function findLastCustomerEntryLog(logs = []) {
  return [...(Array.isArray(logs) ? logs : [])]
    .reverse()
    .find((row) => FIRST_CUSTOMER_ENTRY_TYPES.has(logType(row))) || null;
}

export function findEndOfDayLog(logs = []) {
  return [...(Array.isArray(logs) ? logs : [])]
    .reverse()
    .find((row) => logType(row) === "END_OF_DAY") || null;
}

export function isAutoClosedLogout(row) {
  const note = row?.note;
  if (!note) return Boolean(row?.autoClosed || row?.logoutAutoClosed);
  if (typeof note === "object") return Boolean(note.autoClosed || note.auto_closed);
  try {
    const parsed = JSON.parse(note);
    return Boolean(parsed?.autoClosed || parsed?.auto_closed);
  } catch {
    return false;
  }
}

export function coordsFromActivityLog(row) {
  const fromNote = parseGpsFromActivityNote(row?.note);
  if (fromNote) return fromNote;

  const latitude = Number(row?.entryLatitude ?? row?.latitude);
  const longitude = Number(row?.entryLongitude ?? row?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function isLoginFarFromFirstCustomer(
  loginLog,
  firstEntryLog,
  thresholdKm = LOGIN_FIRST_CUSTOMER_DISTANCE_THRESHOLD_KM,
) {
  const loginGps = coordsFromActivityLog(loginLog);
  const firstGps = coordsFromActivityLog(firstEntryLog);
  if (!loginGps || !firstGps) return false;

  const distanceKm = haversineDistanceKm(
    loginGps.latitude,
    loginGps.longitude,
    firstGps.latitude,
    firstGps.longitude,
  );
  return Number.isFinite(distanceKm) && distanceKm > thresholdKm;
}

export function shouldShowLoginFirstCustomerHint({
  logs = [],
  userId = "",
  reportDate = "",
  dismissed = null,
  thresholdKm = LOGIN_FIRST_CUSTOMER_DISTANCE_THRESHOLD_KM,
} = {}) {
  if (dismissed === true) return false;
  if (dismissed == null && hasDismissedLoginFirstCustomerHint(userId, reportDate)) return false;

  const loginLog = findMorningAttendanceLog(logs);
  const firstEntryLog = findFirstCustomerEntryLog(logs);
  return isLoginFarFromFirstCustomer(loginLog, firstEntryLog, thresholdKm);
}

export function isLogoutFarFromLastCustomer(
  logoutLog,
  lastEntryLog,
  thresholdKm = LOGIN_FIRST_CUSTOMER_DISTANCE_THRESHOLD_KM,
) {
  return isLoginFarFromFirstCustomer(logoutLog, lastEntryLog, thresholdKm);
}

export function shouldShowLogoutLastCustomerHint({
  logs = [],
  userId = "",
  reportDate = "",
  dismissed = null,
  thresholdKm = LOGIN_FIRST_CUSTOMER_DISTANCE_THRESHOLD_KM,
} = {}) {
  if (dismissed === true) return false;
  if (dismissed == null && hasDismissedLogoutLastCustomerHint(userId, reportDate)) return false;

  const logoutLog = findEndOfDayLog(logs);
  if (isAutoClosedLogout(logoutLog)) return false;

  const lastEntryLog = findLastCustomerEntryLog(logs);
  return isLogoutFarFromLastCustomer(logoutLog, lastEntryLog, thresholdKm);
}

export function getLoginFirstCustomerHintCopy() {
  return {
    titleEn: "Login at the first customer",
    titleAr: "سجّل الدخول من موقع أول عميل",
    bodyEn: "Your first entry today is far from your login location. In the future, morning attendance (login) must be done from the first customer location.",
    bodyAr: "موقع أول إدخال اليوم بعيد عن موقع تسجيل الدخول. يجب في المستقبل تسجيل حضور الصباح (الدخول) من موقع أول عميل.",
    okEn: "OK",
    okAr: "حسناً",
  };
}

export function getLogoutLastCustomerHintCopy() {
  return {
    titleEn: "Logout at the last customer",
    titleAr: "سجّل الخروج من موقع آخر عميل",
    bodyEn: "Your last entry today is far from your logout location. In the future, end of day (logout) must be done from the last customer location.",
    bodyAr: "موقع آخر إدخال اليوم بعيد عن موقع تسجيل الخروج. يجب في المستقبل تسجيل نهاية اليوم (الخروج) من موقع آخر عميل.",
    okEn: "OK",
    okAr: "حسناً",
  };
}
