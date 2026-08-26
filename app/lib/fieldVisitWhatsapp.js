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
    stock: isAr ? "فحص المخزون" : "Stock check",
    available: isAr ? "متوفر" : "Available",
    notAvailable: isAr ? "غير متوفر" : "Not available",
    notSpecified: isAr ? "غير محدد" : "not specified",
  };

  const outcome = formatFieldVisitOutcome(visitForm.outcome, language);
  const nextVisit = formatDateOnly(visitForm.nextVisitAt);
  const note = String(visitForm.note || "").trim();
  const salesman = String(salesmanName || salesmanCode || "-").trim() || "-";
  const stockChecks = Array.isArray(visitForm.stockChecks) ? visitForm.stockChecks : [];

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

  if (stockChecks.length > 0) {
    lines.push(`${labels.stock}:`);
    stockChecks.forEach((stockCheck) => {
      const itemName = String(stockCheck.itemName || stockCheck.itemCode || "-").trim() || "-";
      const status = String(stockCheck.status || "").trim().toUpperCase() === "NOT_AVAILABLE"
        ? labels.notAvailable
        : labels.available;
      lines.push(`- ${itemName}: ${status}`);
    });
  }

  return lines.join("\n");
}
