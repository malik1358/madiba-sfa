function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function buildOrderWhatsappSummary(snapshot, language = "en") {
  const isAr = language === "ar";
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
    subtotal: isAr ? "المجموع قبل الضريبة" : "Subtotal",
    vat: isAr ? "ضريبة 15%" : "VAT 15%",
    totalInclVat: isAr ? "الإجمالي شامل الضريبة" : "Total incl. VAT",
    pdfAttached: isAr ? "ملف PDF مرفق." : "PDF attached.",
  };

  const subtotal = Number(snapshot.grandTotal || 0);
  const vatAmount = subtotal * 0.15;
  const totalWithVat = subtotal + vatAmount;

  return [
    labels.title,
    `${labels.orderId}: ${snapshot.orderId}`,
    `${labels.customer}: ${snapshot.customerName || snapshot.customerCode || "-"}`,
    `${labels.code}: ${snapshot.customerCode || "-"}`,
    `${labels.salesman}: ${snapshot.salesmanCode || "-"}`,
    `${labels.status}: ${snapshot.statusLabel || "-"}`,
    `${labels.payment}: ${String(snapshot.paymentType || "credit").toUpperCase()}`,
    `${labels.region}: ${snapshot.pricingRegion || "riyadh"}`,
    `${labels.items}: ${snapshot.itemCount || 0}`,
    `${labels.totalQty}: ${Number(snapshot.totalQuantity || 0)}`,
    `${labels.subtotal}: ${formatMoney(subtotal)}`,
    `${labels.vat}: ${formatMoney(vatAmount)}`,
    `${labels.totalInclVat}: ${formatMoney(totalWithVat)}`,
    labels.pdfAttached,
  ].join("\n");
}
