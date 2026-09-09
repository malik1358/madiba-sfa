import { isSuccessfulCollection } from "./collectionDaySummary.js";
import { formatFieldVisitOutcome } from "./fieldVisitWhatsapp.js";
import { haversineDistanceKm, hasGpsCoordinates } from "./geo.js";

const ON_SITE_VISIT_TYPES = new Set([
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
]);

const SUPERSEDED_ORDER_TYPES = new Set(["ORDER_DRAFT", "ORDER_EDITED"]);
const SUBMIT_PAIR_WINDOW_MS = 2 * 60 * 1000;

export function visitEntryType(entry) {
  return String(entry?.transactionType || entry?.transaction_type || "").trim().toUpperCase();
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function entryCoords(entry) {
  const latitude = Number(entry?.entryLatitude ?? entry?.latitude);
  const longitude = Number(entry?.entryLongitude ?? entry?.longitude);
  if (!hasGpsCoordinates({ latitude, longitude })) return null;
  return { latitude, longitude };
}

function entryOrderId(entry) {
  const value = Number(entry?.orderId ?? entry?.order_id ?? entry?.meta?.orderId ?? entry?.meta?.order_id);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function entrySavedAtMs(entry) {
  const value = new Date(entry?.savedAt || entry?.saved_at || "").getTime();
  return Number.isFinite(value) ? value : NaN;
}

function draftMatchesSubmit(draft, submit) {
  const draftOrderId = entryOrderId(draft);
  const submitOrderId = entryOrderId(submit);
  if (draftOrderId && submitOrderId) return draftOrderId === submitOrderId;

  const draftUser = String(draft?.userId || draft?.user_id || "").trim();
  const submitUser = String(submit?.userId || submit?.user_id || "").trim();
  if (draftUser && submitUser && draftUser !== submitUser) return false;

  const draftCode = normalizeCode(draft?.customerCode || draft?.customer_code);
  const submitCode = normalizeCode(submit?.customerCode || submit?.customer_code);
  if (!draftCode || draftCode !== submitCode) return false;

  const delta = Math.abs(entrySavedAtMs(draft) - entrySavedAtMs(submit));
  return Number.isFinite(delta) && delta <= SUBMIT_PAIR_WINDOW_MS;
}

export function hideSupersededOrderDrafts(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const submits = list.filter((entry) => visitEntryType(entry) === "ORDER_SUBMITTED");
  if (!submits.length) return list;

  return list.filter((entry) => {
    if (!SUPERSEDED_ORDER_TYPES.has(visitEntryType(entry))) return true;
    return !submits.some((submit) => draftMatchesSubmit(entry, submit));
  });
}

export function isOnSiteCustomerVisit(entry) {
  if (!ON_SITE_VISIT_TYPES.has(visitEntryType(entry))) return false;
  return !entry?.isFarFromCustomer;
}

export function assignOnSiteVisitNumbers(entries = []) {
  let visitNumber = 0;
  let lastVisitCode = "";
  return (entries || []).map((entry) => {
    if (!isOnSiteCustomerVisit(entry)) {
      return { ...entry, onSiteVisitNumber: null };
    }
    const code = normalizeCode(entry?.customerCode || entry?.customer_code);
    if (!code || code !== lastVisitCode) {
      visitNumber += 1;
      lastVisitCode = code;
    }
    return { ...entry, onSiteVisitNumber: visitNumber };
  });
}

export function formatEntryCoordinates(entry) {
  const coords = entryCoords(entry);
  if (!coords) return "-";
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

export function buildVisitDaySplit(entries = [], orderStats = {}) {
  const visitCodes = new Set();
  const orderCodes = new Set();
  let collectionCount = 0;
  let collectionValue = 0;

  (entries || []).forEach((entry) => {
    const type = visitEntryType(entry);
    const code = normalizeCode(entry?.customerCode || entry?.customer_code);
    if (type === "VISIT_REPORT" && code) visitCodes.add(code);
    if (type === "ORDER_SUBMITTED" && code) orderCodes.add(code);
    if (type === "COLLECTION_VISIT" && isSuccessfulCollection(entry)) {
      collectionCount += 1;
      collectionValue += Number(entry?.amountReceived ?? entry?.amount_received ?? 0);
    }
  });

  let visitWithoutOrderCount = 0;
  visitCodes.forEach((code) => {
    if (!orderCodes.has(code)) visitWithoutOrderCount += 1;
  });

  let newCustomerOrderCount = Number(orderStats.newCustomerOrderCount || 0);
  let newCustomerOrderValue = Number(orderStats.newCustomerOrderValue || 0);
  const repeatCustomerOrderCount = Number(orderStats.repeatCustomerOrderCount || 0);
  const repeatCustomerOrderValue = Number(orderStats.repeatCustomerOrderValue || 0);
  const orderCount = Number(orderStats.orderCount || 0) || orderCodes.size;
  const orderValue = Number(orderStats.orderValue || 0);
  if (orderCount > 0 && newCustomerOrderCount + repeatCustomerOrderCount === 0) {
    newCustomerOrderCount = orderCount;
    newCustomerOrderValue = orderValue;
  }

  return {
    visitWithoutOrderCount,
    newCustomerOrderCount,
    newCustomerOrderValue,
    repeatCustomerOrderCount,
    repeatCustomerOrderValue,
    orderCount,
    orderValue,
    collectionCount,
    collectionValue,
  };
}

function isNearEntry(left, right, thresholdKm) {
  const from = entryCoords(left);
  const to = entryCoords(right);
  if (!from || !to) return false;
  return haversineDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude) <= thresholdKm;
}

export function loginLogoutLocationNotes(entries = [], thresholdKm = 0.5) {
  const list = entries || [];
  const login = list.find((entry) => visitEntryType(entry) === "MORNING_ATTENDANCE");
  const logout = [...list].reverse().find((entry) => visitEntryType(entry) === "END_OF_DAY");
  const visits = list.filter(isOnSiteCustomerVisit);
  const first = visits[0];
  const last = visits[visits.length - 1];
  const notes = [];

  if (login && first && !isNearEntry(login, first, thresholdKm)) {
    notes.push(
      "Login was not done at the first customer location. Login should be marked at the first customer of the day.",
    );
  }
  if (logout && last && !isNearEntry(logout, last, thresholdKm)) {
    notes.push(
      "Logout was not done at the last customer location. Logout should be marked at the last customer of the day.",
    );
  }

  return notes;
}

export function formatSplitMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function entryDisplayAmount(entry) {
  const collection = Number(entry?.amountReceived ?? entry?.amount_received ?? 0);
  if (Number.isFinite(collection) && collection > 0) return collection;
  const order = Number(entry?.orderValue ?? entry?.order_value ?? 0);
  if (Number.isFinite(order) && order > 0) return order;
  return 0;
}

const COLLECTION_OUTCOME_LABELS = {
  FUNDS_RECEIVED: { en: "Funds received", ar: "تم استلام مبلغ" },
  ASKED_COME_LATER: { en: "Asked to come later", ar: "طلب الحضور لاحقاً" },
  RESPONSIBLE_NOT_AVAILABLE: { en: "Responsible not available", ar: "المسؤول غير متاح" },
  WRONG_CREDIT_DAYS: { en: "Wrong credit days", ar: "أيام ائتمان خاطئة" },
  NO_DUE_AS_PER_CUSTOMER: { en: "No due according to customer", ar: "لا توجد استحقاقات حسب العميل" },
  TRANSFER_TO_LEGAL: { en: "Transfer to legal", ar: "تحويل إلى القانوني" },
  PAID: { en: "Paid", ar: "مدفوع" },
  PARTIAL: { en: "Partial", ar: "جزئي" },
  NOT_PAID: { en: "Not Paid", ar: "غير مدفوع" },
  PROMISED: { en: "Promised To Pay", ar: "وعد بالدفع" },
};

function entryOutcomeCode(entry) {
  return String(
    entry?.visitOutcome
    || entry?.visit_outcome
    || entry?.paymentStatus
    || entry?.payment_status
    || entry?.meta?.visitOutcome
    || entry?.meta?.outcome
    || "",
  ).trim();
}

function collectionOutcomeLabel(outcome, language = "en") {
  const key = String(outcome || "").trim().toUpperCase();
  if (!key) return "";
  const labels = COLLECTION_OUTCOME_LABELS[key];
  if (!labels) return String(outcome);
  return language === "ar" ? labels.ar : labels.en;
}

export function formatVisitEntryOutcome(entry, language = "en") {
  const type = visitEntryType(entry);
  const isAr = language === "ar";
  const collected = Number(entry?.amountReceived ?? entry?.amount_received ?? 0);
  const order = Number(entry?.orderValue ?? entry?.order_value ?? 0);
  const outcome = entryOutcomeCode(entry);

  if (type === "COLLECTION_VISIT") {
    if (Number.isFinite(collected) && collected > 0) {
      return isAr
        ? `تم التحصيل ${formatSplitMoney(collected)} ر.س`
        : `Collected ${formatSplitMoney(collected)} SAR`;
    }
    return collectionOutcomeLabel(outcome, language) || "-";
  }

  if (type === "ORDER_SUBMITTED") {
    if (Number.isFinite(order) && order > 0) {
      return isAr
        ? `طلب ${formatSplitMoney(order)} ر.س`
        : `Order ${formatSplitMoney(order)} SAR`;
    }
    return isAr ? "طلب مقدّم" : "Order submitted";
  }

  if (type === "VISIT_REPORT") {
    return formatFieldVisitOutcome(outcome, language);
  }

  return "-";
}
