import { formatKsaDateOnly } from "./workdayActivity.js";
import { formatVisitDistanceWhatsappLines } from "./visitDistanceWhatsapp.js";

function formatDateOnly(value) {
  return formatKsaDateOnly(value, "");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const OUTCOME_LABELS = {
  PAYMENT_FOLLOWUP: { en: "Payment follow-up", ar: "متابعة دفع" },
  COME_BACK_LATER: { en: "Asked to come back later", ar: "طلب العودة لاحقاً" },
  PURCHASE_MANAGER_NOT_AVAILABLE: { en: "Purchase manager not available", ar: "مدير المشتريات غير موجود" },
  STOCKS_AVAILABLE: { en: "Stocks available", ar: "المخزون متوفر" },
  ORDER_TAKEN: { en: "Order taken", ar: "تم أخذ الطلب" },
};

export function formatFieldVisitOutcome(outcome, language = "en") {
  const key = String(outcome || "").trim().toUpperCase();
  const labels = OUTCOME_LABELS[key];
  if (!labels) return String(outcome || "-");
  return labels[language === "ar" ? "ar" : "en"] || labels.en;
}

/**
 * WhatsApp field-visit shares stay English even when the salesman UI is Arabic,
 * matching collection visit summaries so managers always get the same format.
 */
export function buildFieldVisitWhatsappSummary({
  customer = {},
  visitForm = {},
  salesmanName = "",
  salesmanCode = "",
  language: _language = "en",
  visitDistance = {},
  includeOutstanding = true,
} = {}) {
  const labels = {
    title: "Field visit report",
    customer: "Customer",
    code: "Code",
    salesman: "Salesman",
    outcome: "Outcome",
    nextVisit: "Next visit",
    notes: "Notes",
    notSpecified: "not specified",
    outstanding: "Outstanding",
    bucket0To30: "0-30",
    bucket31To60: "31-60",
    bucket61To90: "61-90",
    bucketAbove90: ">90",
    totalOutstanding: "Total",
  };

  const outcome = formatFieldVisitOutcome(visitForm.outcome, "en");
  const nextVisit = formatDateOnly(visitForm.nextVisitAt);
  const note = String(visitForm.note || "").trim();
  const salesman = String(salesmanName || salesmanCode || "-").trim() || "-";

  const lines = [
    labels.title,
    `${labels.customer}: ${customer.customer_name || customer.customer_code || "-"}`,
    `${labels.code}: ${customer.customer_code || "-"}`,
    `${labels.salesman}: ${salesman}`,
    `${labels.outcome}: ${outcome || labels.notSpecified}`,
    `${labels.nextVisit}: ${nextVisit || labels.notSpecified}`,
  ];

  if (note) {
    lines.push(`${labels.notes}: ${note}`);
  }

  if (includeOutstanding !== false) {
    const bucket0To30 = Number(customer.outstanding_0_30 || 0);
    const bucket31To60 = Number(customer.outstanding_30_60 || 0);
    const bucket61To90 = Number(customer.outstanding_61_90 || 0);
    const bucketAbove90 = Number(customer.outstanding_above_90 || 0);
    const totalOutstanding = bucket0To30 + bucket31To60 + bucket61To90 + bucketAbove90;

    lines.push(`${labels.outstanding}:`);
    lines.push(`${labels.bucket0To30}: ${formatMoney(bucket0To30)}`);
    lines.push(`${labels.bucket31To60}: ${formatMoney(bucket31To60)}`);
    lines.push(`${labels.bucket61To90}: ${formatMoney(bucket61To90)}`);
    lines.push(`${labels.bucketAbove90}: ${formatMoney(bucketAbove90)}`);
    lines.push(`${labels.totalOutstanding}: ${formatMoney(totalOutstanding)}`);
  }

  lines.push(...formatVisitDistanceWhatsappLines(visitDistance));

  return lines.join("\n");
}
