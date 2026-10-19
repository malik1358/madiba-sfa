function formatDateOnly(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB");
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

export function buildFieldVisitWhatsappSummary({
  customer = {},
  visitForm = {},
  salesmanName = "",
  salesmanCode = "",
  language = "en",
} = {}) {
  const isAr = language === "ar";
  const labels = {
    title: isAr ? "تقرير زيارة ميدانية" : "Field visit report",
    customer: isAr ? "العميل" : "Customer",
    code: isAr ? "الرمز" : "Code",
    salesman: isAr ? "رجل البيع" : "Salesman",
    outcome: isAr ? "النتيجة" : "Outcome",
    nextVisit: isAr ? "الزيارة القادمة" : "Next visit",
    notes: isAr ? "ملاحظات" : "Notes",
    notSpecified: isAr ? "غير محدد" : "not specified",
    outstanding: isAr ? "المستحقات" : "Outstanding",
    bucket0To30: isAr ? "0-30 يوماً" : "0-30",
    bucket31To60: isAr ? "31-60 يوماً" : "31-60",
    bucket61To90: isAr ? "61-90 يوماً" : "61-90",
    bucketAbove90: isAr ? ">90 يوماً" : ">90",
    totalOutstanding: isAr ? "الإجمالي" : "Total",
  };

  const outcome = formatFieldVisitOutcome(visitForm.outcome, language);
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

  return lines.join("\n");
}
