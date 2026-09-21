import { formatAvgDaysToPayWhatsappLines } from "./avgDaysWhatsapp.js";
import { formatSalesOrderNumber } from "./salesOrderNumber.js";
import { formatVisitDistanceWhatsappLines } from "./visitDistanceWhatsapp.js";
import { formatOrderVatLabel, VAT_RATE } from "./regionalPricing.js";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function buildOrderWhatsappSummary(snapshot, language = "en", options = {}) {
  const isAr = language === "ar";
  const totals = snapshot.totals || {};
  const subtotal = Number(totals.amountExclVat || snapshot.grandTotal || 0);
  const vatAmount = Number.isFinite(Number(totals.vatAmount))
    ? Number(totals.vatAmount)
    : subtotal * VAT_RATE;
  const totalWithVat = Number.isFinite(Number(totals.amountInclVat))
    ? Number(totals.amountInclVat)
    : subtotal + vatAmount;
  const vatLabel = formatOrderVatLabel(
    Number.isFinite(Number(totals.vatAmount)) ? totals : { amountExclVat: subtotal, vatAmount },
    { language }
  );
  const labels = {
    title: isAr ? "طلب مبيعات" : "Sales order",
    orderId: isAr ? "رقم الطلب" : "Order #",
    customer: isAr ? "العميل" : "Customer",
    code: isAr ? "الرمز" : "Code",
    salesman: isAr ? "رجل البيع" : "Salesman",
    status: isAr ? "الحالة" : "Status",
    payment: isAr ? "الدفع" : "Payment",
    region: isAr ? "المنطقة" : "Region",
    items: isAr ? "عدد الأصناف" : "Items",
    totalQty: isAr ? "إجمالي الكمية" : "Total qty",
    cashDiscount: isAr ? "خصم نقدي" : "Cash discount",
    valueDiscount: isAr ? "خصم القيمة" : "Value discount",
    schemeDiscount: isAr ? "خصم العرض" : "Scheme discount",
    subtotal: isAr ? "المبلغ بدون ضريبة" : "Amount without VAT",
    vat: vatLabel,
    totalInclVat: isAr ? "المبلغ بعد الضريبة" : "Amount after VAT",
    pdfAttached: isAr ? "ملف PDF مرفق." : "PDF attached.",
    avgDaysToPay: isAr ? "متوسط أيام الدفع" : "Avg days to pay",
    avgDaysToPay6mLabel: isAr ? "متوسط 6 أشهر" : "6-month avg",
  };

  const cashDiscount = Number(totals.cashDiscountTotal || 0);
  const valueDiscount = Number(totals.valueDiscountTotal || 0);
  const schemeDiscount = Number(totals.schemeDiscountTotal || 0);
  const paymentBehavior = options.analytics?.paymentBehavior
    || snapshot.paymentBehavior
    || null;
  const avgDaysToPay = paymentBehavior
    ? {
      avgDaysToPay: paymentBehavior.avgDaysToPay ?? null,
      avgDaysToPay6m: paymentBehavior.avgDaysToPay6m ?? null,
    }
    : (snapshot.avgDaysToPay ?? null);

  return [
    labels.title,
        `${labels.orderId}: ${formatSalesOrderNumber(snapshot) || "—"}`,
    `${labels.customer}: ${snapshot.customerName || snapshot.customerCode || "-"}`,
    `${labels.code}: ${snapshot.customerCode || "-"}`,
    `${labels.salesman}: ${snapshot.salesmanCode || "-"}`,
    `${labels.status}: ${snapshot.statusLabel || "-"}`,
    `${labels.payment}: ${String(snapshot.paymentType || "credit").toUpperCase()}`,
    `${labels.region}: ${snapshot.pricingRegion || "riyadh"}`,
    `${labels.items}: ${snapshot.itemCount || 0}`,
    `${labels.totalQty}: ${Number(snapshot.totalQuantity || 0)}`,
    `${labels.cashDiscount}: ${formatMoney(cashDiscount)}`,
    `${labels.valueDiscount}: ${formatMoney(valueDiscount)}`,
    `${labels.schemeDiscount}: ${formatMoney(schemeDiscount)}`,
    `${labels.subtotal}: ${formatMoney(subtotal)}`,
    `${labels.vat}: ${formatMoney(vatAmount)}`,
    `${labels.totalInclVat}: ${formatMoney(totalWithVat)}`,
    labels.pdfAttached,
    ...formatAvgDaysToPayWhatsappLines(avgDaysToPay, labels),
    ...formatVisitDistanceWhatsappLines(snapshot.visitDistance),
  ].join("\n");
}
