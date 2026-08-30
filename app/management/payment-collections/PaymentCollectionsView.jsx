"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import NearestCustomerSuggestions from "../../components/NearestCustomerSuggestions";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useNearestCustomerSuggestions } from "../../hooks/useNearestCustomerSuggestions";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveInvoiceAgingDays, resolveOverdueDaysFromDueDate } from "../../lib/outstanding";
import { useAppPopup } from "../../components/AppPopupProvider";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import {
  captureGpsLocationWithFallbackConfirm,
  promptCustomerLocationUpdateAfterVisit,
} from "../../lib/customerLocation";
import { postFormDataResilient } from "../../lib/offlineApi";
import {
  buildOptimisticLatestCollection,
  incrementLocalCollectionVisitCount,
  patchCollectionQueuesWithOptimisticVisit,
  resolveCollectionVisitNumberForDay,
} from "../../lib/collectionOffline";
import { listOfflineQueue, processOfflineQueue } from "../../lib/offlineSyncQueue";
import {
  fetchCollectionQueuesCached,
  fetchSalesScopeCached,
  readCollectionQueuesForUser,
  writeCollectionQueuesForUser,
} from "../../lib/mobileDataCache";
import { resolveAuthSession } from "../../lib/authSession";
import {
  collectionRowMatchesCustomerQuery,
  isCashOnlyQueueCustomer,
  isCashQueueCustomer,
  isScheduledRevisitQueueCustomer,
  canViewerSeeScheduledRevisit,
  sortCashQueueCustomers,
} from "../../lib/paymentCollections";
import { prepareUploadFile } from "../../lib/compressUploadFile";
import { shareTextAndFilesOnWhatsapp, shareTextOnWhatsapp } from "../../lib/whatsappShare";
import { getSupabaseClient } from "../../lib/supabase";
import { buildVisibleDueQueuePriorityMap } from "../../lib/collectionVisitPriority";
import { getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "Payment Collections", ar: "التحصيلات" },
  subtitle: { en: "Due-customer collection queue and visit tracking", ar: "قائمة التحصيل للعملاء المستحقين وتتبع الزيارات" },
  dashboard: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading collection queue...", ar: "جاري تحميل قائمة التحصيل..." },
  dueQueue: { en: "Due Collection Queue", ar: "قائمة التحصيل المستحق" },
  legalQueue: { en: "Legal Queue", ar: "قائمة القسم القانوني" },
  customerCode: { en: "Code", ar: "الكود" },
  priorityNumber: { en: "Priority #", ar: "رقم الأولوية" },
  customer: { en: "Customer", ar: "العميل" },
  customerFilter: { en: "Filter customer", ar: "تصفية العميل" },
  salesmanFilter: { en: "Filter salesman", ar: "تصفية المندوب" },
  salesman: { en: "Salesman", ar: "المندوب" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  amount: { en: "Due Amount", ar: "المبلغ المستحق" },
  cashBucket: { en: "Cash", ar: "نقدي" },
  bucket30: { en: "0-30", ar: "0-30" },
  bucket31to60: { en: "31-60", ar: "31-60" },
  bucket61to90: { en: "61-90", ar: "61-90" },
  bucket91to120: { en: "91-120", ar: "91-120" },
  bucket120plus: { en: ">120", ar: ">120" },
  bucketSummary: { en: "Outstanding", ar: "المديونية" },
  overdue: { en: "Max Overdue", ar: "أقصى تأخير" },
  invoices: { en: "Due Invoices", ar: "الفواتير المستحقة" },
  probability: { en: "Payment Probability", ar: "احتمالية التحصيل" },
  lastUpdate: { en: "Last Update", ar: "آخر تحديث" },
  lastOutcome: { en: "Last Outcome", ar: "آخر نتيجة" },
  actions: { en: "Actions", ar: "الإجراءات" },
  open: { en: "Open", ar: "فتح" },
  close: { en: "Close", ar: "إغلاق" },
  noDue: { en: "No due customers available for collection.", ar: "لا يوجد عملاء مستحقون للتحصيل حالياً." },
  notDueQueue: { en: "Not Yet Due Invoices", ar: "فواتير غير مستحقة بعد" },
  notDueHint: {
    en: "Customers with pending invoices that are not overdue yet. Collect early payments here if needed.",
    ar: "عملاء لديهم فواتير معلقة غير مستحقة بعد. يمكن تحصيل دفعات مبكرة من هنا.",
  },
  scheduledRevisitsTitle: { en: "Scheduled Revisits", ar: "زيارات التحصيل المجدولة" },
  scheduledRevisitsHint: {
    en: "Customers with a collection revisit date saved from the last visit, including overdue dates not yet visited. Nearest dates appear first.",
    ar: "عملاء لديهم موعد زيارة تحصيل من آخر زيارة، بما في ذلك المواعيد المتأخرة التي لم تُزار بعد. أقرب المواعيد تظهر أولاً.",
  },
  scheduledRevisitsMobileHint: {
    en: "Tap a date to show or hide customers for that day.",
    ar: "اضغط على التاريخ لإظهار أو إخفاء عملاء ذلك اليوم.",
  },
  scheduledRevisitDate: { en: "Revisit Date", ar: "موعد الزيارة" },
  scheduledBy: { en: "Scheduled By", ar: "مجدول بواسطة" },
  scheduledByFilter: { en: "Filter scheduled by", ar: "تصفية من قام بالجدولة" },
  scheduledByFilterHint: { en: "Tap to select one or more people who saved the revisit date", ar: "اضغط لاختيار شخص واحد أو أكثر ممن حفظ موعد الزيارة" },
  allSchedulers: { en: "No scheduler names loaded yet", ar: "لا توجد أسماء مسجلة بعد" },
  clearScheduledByFilter: { en: "Clear scheduler filter", ar: "مسح تصفية الجدولة" },
  selectAllSchedulers: { en: "Select all", ar: "تحديد الكل" },
  noScheduledRevisitsForFilter: { en: "No scheduled revisits match the selected scheduler filter.", ar: "لا توجد زيارات مجدولة مطابقة لتصفية الجدولة." },
  lastVisitDate: { en: "Last Visit", ar: "آخر زيارة" },
  visitRemark: { en: "Visit Remark", ar: "ملاحظة الزيارة" },
  noVisitRemark: { en: "No remark saved", ar: "لا توجد ملاحظة محفوظة" },
  noScheduledRevisits: { en: "No collection revisits scheduled.", ar: "لا توجد زيارات تحصيل مجدولة." },
  overdueRevisit: { en: "Overdue", ar: "متأخر" },
  cashQueueTitle: { en: "Cash Due Queue", ar: "قائمة التحصيل النقدي" },
  cashQueueHint: {
    en: "Customers with cash invoices where Ref. No. contains C (for example RC/, DC/, CNFD/). Collect these before credit follow-ups.",
    ar: "عملاء لديهم فواتير نقدية حيث رقم المرجع يحتوي على C (مثل RC/ أو DC/ أو CNFD/). حصل هذه قبل متابعة الائتمان.",
  },
  creditQueueTitle: { en: "Credit Collection", ar: "تحصيل الائتمان" },
  creditQueueHint: {
    en: "Credit collection starts here. Follow up outstanding credit invoices after cash-due customers.",
    ar: "يبدأ تحصيل الائتمان من هنا. تابع فواتير الائتمان المستحقة بعد العملاء النقديين.",
  },
  noCashQueue: { en: "No cash-due customers in the outstanding file.", ar: "لا يوجد عملاء بفواتير نقدية مستحقة في ملف المديونية." },
  cashDueAmount: { en: "Cash Due", ar: "المبلغ النقدي المستحق" },
  notDueAmount: { en: "Pending Amount", ar: "المبلغ المعلق" },
  notDueInvoices: { en: "Pending Invoices", ar: "الفواتير المعلقة" },
  noNotDue: { en: "No not-yet-due invoices in the outstanding file.", ar: "لا توجد فواتير غير مستحقة في ملف المديونية." },
  noLegal: { en: "No customers transferred to legal department.", ar: "لا يوجد عملاء محولون إلى القسم القانوني." },
  visitForm: { en: "Collection Visit", ar: "زيارة تحصيل" },
  visitOutcome: { en: "Visit Outcome", ar: "نتيجة الزيارة" },
  fundsReceived: { en: "Funds received", ar: "تم استلام مبلغ" },
  askedComeLater: { en: "Asked to come later", ar: "طلب الحضور لاحقاً" },
  responsibleAbsent: { en: "Responsible not available", ar: "المسؤول غير متاح" },
  wrongCreditDays: { en: "Wrong credit days", ar: "أيام ائتمان خاطئة" },
  noDueAsPerCustomer: { en: "No due according to customer", ar: "لا توجد استحقاقات حسب العميل" },
  outcomeTransferLegal: { en: "Transfer to legal", ar: "تحويل إلى القانوني" },
  amountReceived: { en: "Amount Received", ar: "المبلغ المستلم" },
  modeOfReceipt: { en: "Mode of Receipt", ar: "طريقة الاستلام" },
  nextVisit: { en: "Next Visit", ar: "الزيارة القادمة" },
  remarkArabic: { en: "Remark (Arabic)", ar: "ملاحظة بالعربية" },
  remarkEnglish: { en: "Remark (English)", ar: "الملاحظة بالانجليزية" },
  dictation: { en: "Dictate", ar: "إملاء" },
  summary: { en: "Visit Summary for WhatsApp", ar: "ملخص الزيارة للواتساب" },
  summaryAfterSave: {
    en: "Save the visit first. The WhatsApp summary appears here only after a successful save.",
    ar: "احفظ الزيارة أولاً. يظهر ملخص الواتساب هنا فقط بعد الحفظ بنجاح.",
  },
  copySummary: { en: "Copy Summary", ar: "نسخ الملخص" },
  shareWhatsapp: { en: "Share on WhatsApp", ar: "مشاركة على واتساب" },
  shareWhatsappWithReceipt: { en: "Share receipt & summary on WhatsApp", ar: "مشاركة الإيصال والملخص على واتساب" },
  whatsappShareHint: {
    en: "Visit saved. Share this summary on WhatsApp now — works offline too.",
    ar: "تم حفظ الزيارة. شارك هذا الملخص على واتساب الآن — يعمل بدون اتصال أيضاً.",
  },
  whatsappShareReceiptHint: {
    en: "Receipt attached — you can share the photo/PDF together with the summary.",
    ar: "تم إرفاق الإيصال — يمكنك مشاركة الصورة/‏PDF مع الملخص.",
  },
  copied: { en: "Copied", ar: "تم النسخ" },
  paymentCopy: { en: "Payment Copy", ar: "صورة الدفع" },
  receiptCopy: { en: "Receipt Copy", ar: "صورة الإيصال" },
  capturePhoto: { en: "Take Photo", ar: "التقاط صورة" },
  chooseFile: { en: "Choose File / PDF", ar: "اختيار ملف / PDF" },
  saveVisit: { en: "Save Collection Visit", ar: "حفظ زيارة التحصيل" },
  transferLegal: { en: "Transfer To Legal", ar: "تحويل إلى القانوني" },
  removeLegal: { en: "Remove From Legal", ar: "إزالة من القانوني" },
  legalNote: { en: "Legal Transfer Note", ar: "ملاحظة التحويل القانوني" },
  paid: { en: "Paid", ar: "مدفوع" },
  partial: { en: "Partial", ar: "جزئي" },
  notPaid: { en: "Not Paid", ar: "غير مدفوع" },
  promised: { en: "Promised To Pay", ar: "وعد بالدفع" },
  cash: { en: "Cash", ar: "نقداً" },
  cheque: { en: "Cheque", ar: "شيك" },
  bankTransfer: { en: "Bank Transfer", ar: "تحويل بنكي" },
  atmMachine: { en: "ATM Machine", ar: "جهاز صراف" },
  latestVisit: { en: "Latest Collection Update", ar: "آخر تحديث تحصيل" },
  lastThreeVisits: { en: "Last 3 Visits", ar: "آخر 3 زيارات" },
  noLatestVisit: { en: "No collection update saved yet.", ar: "لا يوجد تحديث تحصيل محفوظ بعد." },
  customerDetails: { en: "Customer Details", ar: "تفاصيل العميل" },
  viewVisitReport: { en: "View Report", ar: "عرض التقرير" },
  visitReportTitle: { en: "Collection Visit Report", ar: "تقرير زيارة التحصيل" },
  visitReportNumber: { en: "Visit", ar: "زيارة" },
  visitReportSeparator: { en: "---", ar: "---" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  translating: { en: "Translating...", ar: "جاري الترجمة..." },
  msgLoginAgain: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  msgSelectOutcome: { en: "Please select visit outcome.", ar: "يرجى اختيار نتيجة الزيارة." },
  msgAmountRequired: { en: "Amount received is required for funds received outcome.", ar: "المبلغ المستلم مطلوب عند اختيار تم استلام مبلغ." },
  msgModeRequired: { en: "Mode of receipt is required for funds received outcome.", ar: "طريقة الاستلام مطلوبة عند اختيار تم استلام مبلغ." },
  msgReceiptRequired: { en: "Receipt copy is compulsory when funds are received.", ar: "صورة الإيصال إلزامية عند استلام مبلغ." },
  msgNextVisitRequired: { en: "Next visit date is required when full overdue is not received.", ar: "تاريخ الزيارة القادمة مطلوب عند عدم استلام كامل المبلغ المستحق." },
  msgSaveFailed: { en: "Unable to save collection visit.", ar: "تعذر حفظ زيارة التحصيل." },
  msgRequestTimeout: {
    en: "Request timed out. Please check your connection and try again.",
    ar: "انتهت مهلة الطلب. يرجى التحقق من الاتصال والمحاولة مرة أخرى.",
  },
  msgStorageUnavailable: {
    en: "File storage is not configured for payment collection uploads. Please contact your administrator.",
    ar: "تخزين الملفات غير مُعد لرفع مستندات التحصيل. يرجى التواصل مع المسؤول.",
  },
  msgUploadTooLarge: {
    en: "The uploaded file is too large. Retake the photo or choose a smaller file.",
    ar: "الملف المرفوع كبير جداً. أعد التقاط الصورة أو اختر ملفاً أصغر.",
  },
  msgUnsupportedPhoto: {
    en: "This photo format is not supported. Retake the photo or choose JPG/PNG/PDF.",
    ar: "صيغة الصورة غير مدعومة. أعد التقاط الصورة أو اختر JPG/PNG/PDF.",
  },
  msgCustomerMissing: {
    en: "Customer record is missing in the master list. Ask admin to add this customer in Customer Master.",
    ar: "سجل العميل غير موجود في القائمة الرئيسية. اطلب من المسؤول إضافة العميل في Customer Master.",
  },
  msgVisitSaved: { en: "Visit saved successfully.", ar: "تم حفظ الزيارة بنجاح." },
  msgSavedOffline: {
    en: "Saved on this device. Share the WhatsApp summary below — sync will finish when connection improves.",
    ar: "تم الحفظ على الجهاز. شارك ملخص الواتساب أدناه — ستكتمل المزامنة عند تحسن الاتصال.",
  },
  offlineQueueBanner: {
    en: "Working offline from saved queue. Visits save on this device and sync automatically when connection improves.",
    ar: "العمل دون اتصال من القائمة المحفوظة. تُحفظ الزيارات على الجهاز وتُزامَن تلقائياً عند تحسن الاتصال.",
  },
  staleQueueBanner: {
    en: "Showing saved collection queue while the server reconnects.",
    ar: "عرض قائمة التحصيل المحفوظة أثناء إعادة الاتصال بالخادم.",
  },
  pendingSyncBanner: {
    en: "visits waiting to sync",
    ar: "زيارات بانتظار المزامنة",
  },
  pendingSyncBadge: { en: "Pending sync", ar: "بانتظار المزامنة" },
  cacheRefreshing: {
    en: "Showing saved queue. Refreshing in background...",
    ar: "عرض القائمة المحفوظة. جاري التحديث في الخلفية...",
  },
  msgGpsRequired: { en: "GPS is required. Allow location access in the browser before saving.", ar: "GPS مطلوب. اسمح بالموقع في المتصفح قبل الحفظ." },
  msgWhatsappNotSent: { en: "WhatsApp not sent", ar: "لم يتم إرسال واتساب" },
  msgSpeechUnsupported: { en: "Speech dictation is not supported in this browser.", ar: "الإملاء الصوتي غير مدعوم في هذا المتصفح." },
  msgSupabaseMissing: { en: "Supabase is not configured.", ar: "Supabase غير مُعد." },
  msgLegalRemoved: { en: "removed from legal queue.", ar: "تمت إزالته من قائمة القانوني." },
  msgLegalTransferred: { en: "transferred to legal queue.", ar: "تم تحويله إلى قائمة القانوني." },
  msgLegalUpdateFailed: { en: "Unable to update legal transfer status.", ar: "تعذر تحديث حالة التحويل للقانوني." },
  msgCopyFailed: { en: "Could not copy WhatsApp message automatically.", ar: "تعذر نسخ رسالة واتساب تلقائياً." },
  msgWhatsappShareFailed: { en: "Could not open WhatsApp. Use Copy Summary and paste manually.", ar: "تعذر فتح واتساب. استخدم نسخ الملخص واللصق يدوياً." },
  msgWhatsappReceiptFallback: {
    en: "WhatsApp opened with the summary. Attach the receipt manually if it was not included.",
    ar: "تم فتح واتساب مع الملخص. أرفق الإيصال يدوياً إذا لم يُضمَّن.",
  },
  salesmanFilterHint: { en: "Tap to select one or more salesmen", ar: "اضغط لاختيار مندوب واحد أو أكثر" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  clearSalesmanFilter: { en: "Clear selection", ar: "مسح التحديد" },
  selectAllSalesmen: { en: "Select all", ar: "تحديد الكل" },
  probHigh: { en: "High", ar: "مرتفع" },
  probMedium: { en: "Medium", ar: "متوسط" },
  probLow: { en: "Low", ar: "منخفض" },
  probNA: { en: "N/A", ar: "غير متاح" },
  summaryCustomer: { en: "Customer", ar: "العميل" },
  summaryCode: { en: "Code", ar: "الكود" },
  summaryQueuePriority: { en: "Queue priority", ar: "أولوية الزيارة" },
  summaryProbability: { en: "Payment probability", ar: "احتمالية التحصيل" },
  summarySalesman: { en: "Salesman", ar: "المندوب" },
  summaryOutcome: { en: "Outcome", ar: "النتيجة" },
  summaryAmountReceived: { en: "Amount received", ar: "المبلغ المستلم" },
  summaryReceiptMode: { en: "Receipt mode", ar: "طريقة الاستلام" },
  summaryNextVisit: { en: "Next visit", ar: "الزيارة القادمة" },
  summaryVisitNumber: { en: "Visit number today", ar: "رقم الزيارة لليوم" },
  summaryOutstanding: { en: "Outstanding", ar: "المديونية" },
  summaryNotSpecified: { en: "not specified", ar: "غير محدد" },
  viewPaymentCopy: { en: "Payment Copy", ar: "صورة الدفع" },
  viewReceiptCopy: { en: "Receipt Copy", ar: "صورة الإيصال" },
  customerFilterPlaceholder: { en: "Filter customer name/code", ar: "تصفية اسم/كود العميل" },
  invDate: { en: "Date", ar: "التاريخ" },
  invRef: { en: "Ref", ar: "المرجع" },
  invPending: { en: "Pending", ar: "المعلق" },
  invDue: { en: "Due", ar: "الاستحقاق" },
  invOverdue: { en: "Overdue", ar: "التأخير" },
  defaultLegalNote: { en: "Transferred during visit report", ar: "تم التحويل أثناء تقرير الزيارة" },
};

const OUTCOME_KEYS = {
  FUNDS_RECEIVED: "fundsReceived",
  ASKED_COME_LATER: "askedComeLater",
  RESPONSIBLE_NOT_AVAILABLE: "responsibleAbsent",
  WRONG_CREDIT_DAYS: "wrongCreditDays",
  NO_DUE_AS_PER_CUSTOMER: "noDueAsPerCustomer",
  TRANSFER_TO_LEGAL: "outcomeTransferLegal",
  PAID: "paid",
  PARTIAL: "partial",
  NOT_PAID: "notPaid",
  PROMISED: "promised",
};

const RECEIPT_MODE_KEYS = {
  CASH: "cash",
  CHEQUE: "cheque",
  BANK_TRANSFER: "bankTransfer",
  ATM_MACHINE: "atmMachine",
};

function formatOutcomeLabel(outcome, t) {
  const key = OUTCOME_KEYS[String(outcome || "").trim().toUpperCase()];
  return key ? t(key) : String(outcome || "-");
}

function formatReceiptModeLabel(mode, t) {
  const key = RECEIPT_MODE_KEYS[String(mode || "").trim().toUpperCase()];
  return key ? t(key) : String(mode || "");
}

function formatProbabilityLabel(label, t) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "high") return t("probHigh");
  if (normalized === "medium") return t("probMedium");
  if (normalized === "low") return t("probLow");
  if (!normalized || normalized === "n/a") return t("probNA");
  return String(label || t("probNA"));
}

function formatCustomerCodeWithPriority(customerCode, priority) {
  const code = String(customerCode || "-").trim() || "-";
  if (!priority || priority <= 0) return code;
  return `${priority} · ${code}`;
}

function buildVisitSummary(row, form, translatedRemark, t, options = {}) {
  const amount = Number(form.amountReceived || 0);
  const nextVisit = formatDateOnly(form.nextVisitAt);
  const visitNumberForDay = Number(options.visitNumberForDay || 0);
  const queuePriority = Number(options.queuePriority || 0);
  const probabilityLabel = formatProbabilityLabel(row.probability_label, t);
  const outcomeText = formatOutcomeLabel(form.visitOutcome, t);
  const arabicRemark = String(form.remarkArabic || "").trim();
  const englishRemark = String(translatedRemark || form.remarkEnglish || "").trim();
  const lines = [
    `${t("summaryCustomer")}: ${row.customer_name || row.customer_code}`,
    `${t("summaryCode")}: ${row.customer_code || "-"}`,
    `${t("summarySalesman")}: ${row.salesman_name || row.salesman_code || "-"}`,
    `${t("summaryOutcome")}: ${outcomeText || t("summaryNotSpecified")}`,
  ];

  if (queuePriority > 0) {
    lines.splice(1, 0, `${t("summaryQueuePriority")}: ${queuePriority}.`);
  }
  if (probabilityLabel && probabilityLabel !== t("probNA")) {
    lines.splice(queuePriority > 0 ? 2 : 1, 0, `${t("summaryProbability")}: ${probabilityLabel}.`);
  }

  if (amount > 0) lines.push(`${t("summaryAmountReceived")}: ${formatMoney(amount)}.`);
  if (form.receiptMode) lines.push(`${t("summaryReceiptMode")}: ${formatReceiptModeLabel(form.receiptMode, t)}.`);
  if (arabicRemark) lines.push(`${t("remarkArabic")}: ${arabicRemark}.`);
  if (englishRemark) lines.push(`${t("remarkEnglish")}: ${englishRemark}.`);
  lines.push(`${t("summaryNextVisit")}: ${nextVisit || t("summaryNotSpecified")}.`);
  if (visitNumberForDay > 0) {
    lines.push(`${t("summaryVisitNumber")}: ${visitNumberForDay}.`);
  }
  lines.push(`${t("summaryOutstanding")}:`);
  lines.push(`${t("bucket30")}: ${formatMoney(row.outstanding_0_30)}`);
  lines.push(`${t("bucket31to60")}: ${formatMoney(row.outstanding_30_60)}`);
  lines.push(`${t("bucket61to90")}: ${formatMoney(row.outstanding_61_90)}`);
  lines.push(`${t("bucket91to120")}: ${formatMoney(row.outstanding_91_120)}`);
  lines.push(`${t("bucket120plus")}: ${formatMoney(row.outstanding_above_120)}`);
  return lines.join("\n");
}

function buildStoredVisitReport(row, englishRemark, t, visit = null) {
  const selectedVisit = visit || row?.latest_collection;
  if (!selectedVisit) return "";

  const reportRow = {
    ...row,
    salesman_name: selectedVisit.scheduled_by_name || row.salesman_name,
    salesman_code: row.salesman_code,
  };

  return buildVisitSummary(reportRow, {
    visitOutcome: selectedVisit.visit_outcome || selectedVisit.payment_status || "",
    amountReceived: selectedVisit.amount_received ? String(selectedVisit.amount_received) : "",
    receiptMode: selectedVisit.receipt_mode || "",
    nextVisitAt: toDateInputValue(selectedVisit.next_visit_at),
    remarkArabic: selectedVisit.remark_arabic || "",
    remarkEnglish: englishRemark || selectedVisit.remark_english || "",
  }, englishRemark || selectedVisit.remark_english || "", t);
}

async function buildVisitReportText(row, t) {
  const visits = Array.isArray(row?.collection_history) && row.collection_history.length > 0
    ? row.collection_history.slice(0, 3)
    : (row?.latest_collection ? [row.latest_collection] : []);

  if (visits.length === 0) return "";

  const reportParts = [];

  for (let index = 0; index < visits.length; index += 1) {
    const visit = visits[index];
    const englishRemark = await resolveEnglishRemark(visit.remark_arabic, visit.remark_english);
    const report = buildStoredVisitReport(row, englishRemark, t, visit);
    if (!report) continue;

    if (index > 0) {
      reportParts.push("", t("visitReportSeparator"), "");
    }

    if (visits.length > 1) {
      reportParts.push(`${t("visitReportNumber")} ${index + 1}`, report);
    } else {
      reportParts.push(report);
    }
  }

  return reportParts.join("\n");
}

async function countCollectionPendingSync() {
  const pending = await listOfflineQueue("pending");
  return pending.filter((item) => item.metadata?.type === "collection_visit").length;
}

async function resolveEnglishRemarkForSave(arabicRemark, englishRemark) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const english = String(englishRemark || "").trim();
    const arabic = String(arabicRemark || "").trim();
    if (english && english !== arabic) return english;
    return arabic;
  }
  return resolveEnglishRemark(arabicRemark, englishRemark);
}

async function resolveEnglishRemark(arabicRemark, englishRemark) {
  const arabic = String(arabicRemark || "").trim();
  const english = String(englishRemark || "").trim();
  if (!arabic || (english && english !== arabic)) return english;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: arabic, from: "ar", to: "en" }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.success && payload.translatedText) {
      return String(payload.translatedText).trim();
    }
  } catch {
    // Fall back to stored remark below.
  }

  return english || arabic;
}

async function fetchTodayCollectionVisitCount(supabase, userId) {
  const reportDate = getKsaDateString();
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const { count, error } = await supabase
    .from("collection_visits")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso);

  if (error) throw error;
  return Number(count || 0);
}

function formatLastUpdateText(row, t) {
  const savedAt = row?.latest_collection?.saved_at ? new Date(row.latest_collection.saved_at).toLocaleString("en-GB") : "-";
  const amount = Number(row?.latest_collection?.amount_received || 0);
  const amountText = amount > 0 ? formatMoney(amount) : "0";
  return `${savedAt} | ${t("amount")}: ${amountText}`;
}

function formatVisitHistoryItem(visit, t) {
  const savedAt = visit?.saved_at ? formatDateOnly(visit.saved_at) : "-";
  const outcome = formatOutcomeLabel(visit?.visit_outcome || visit?.payment_status, t);
  const amount = Number(visit?.amount_received || 0);
  return `${savedAt} | ${outcome} | ${t("amount")}: ${formatMoney(amount)}`;
}

function normalizeSalesmanKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getSalesmanLabel(row) {
  const name = String(row?.salesman_name || "").trim();
  const code = String(row?.salesman_code || "").trim();
  if (code && name) return `${code} - ${name}`;
  return name || code || "";
}

function buildSalesmanOptions(rows) {
  const byKey = new Map();

  (rows || []).forEach((row) => {
    const label = getSalesmanLabel(row);
    const key = normalizeSalesmanKey(label);
    if (!key) return;

    const existing = byKey.get(key);
    if (!existing || label.length > existing.length) {
      byKey.set(key, label);
    }
  });

  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function rowMatchesSalesmanSelection(row, selectedKeys) {
  if (!selectedKeys.size) return true;
  return selectedKeys.has(normalizeSalesmanKey(getSalesmanLabel(row)));
}

function useMobileLayout(breakpointPx = 700) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const media = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(media.matches);
    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    if (typeof media.addListener === "function") {
      media.addListener(update);
      return () => media.removeListener(update);
    }

    return undefined;
  }, [breakpointPx]);

  return isMobile;
}

function filterQueueRows(rows, customerFilter, selectedSalesmen) {
  const selectedSalesmanSet = new Set(selectedSalesmen);
  return (rows || []).filter((row) => (
    collectionRowMatchesCustomerQuery(row, customerFilter)
    && rowMatchesSalesmanSelection(row, selectedSalesmanSet)
  ));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function toDateInputValue(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) return String(value).trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

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

function formatLastVisitDate(row) {
  const savedAt = row?.latest_collection?.saved_at;
  if (!savedAt) return "-";
  return formatDateOnly(savedAt) || new Date(savedAt).toLocaleDateString("en-GB");
}

function getScheduledByLabel(row) {
  const name = String(row?.latest_collection?.scheduled_by_name || "").trim();
  if (name) return name;
  const id = String(row?.latest_collection?.scheduled_by_id || row?.latest_collection?.created_by || "").trim();
  return id || "-";
}

function getScheduledByKey(row) {
  return String(row?.latest_collection?.scheduled_by_id || row?.latest_collection?.created_by || "").trim();
}

function buildSchedulerViewerContext(schedulerScope) {
  if (!schedulerScope) return null;
  return {
    userId: schedulerScope.userId,
    canSeeAllSchedulers: schedulerScope.canSeeAllSchedulers,
    visibleSchedulerUserIds: schedulerScope.visibleSchedulerUserIds,
  };
}

function VisitRemarkCell({ row, t }) {
  const visit = row?.latest_collection;
  const arabic = String(visit?.remark_arabic || "").trim();
  const storedEnglish = String(visit?.remark_english || "").trim();
  const [english, setEnglish] = useState(() => (
    storedEnglish && storedEnglish !== arabic ? storedEnglish : ""
  ));

  useEffect(() => {
    let cancelled = false;

    async function loadEnglishRemark() {
      if (!arabic) {
        if (!cancelled) setEnglish(storedEnglish);
        return;
      }

      const resolved = await resolveEnglishRemark(arabic, storedEnglish);
      if (cancelled) return;

      setEnglish(resolved && resolved !== arabic ? resolved : "");
    }

    loadEnglishRemark();

    return () => {
      cancelled = true;
    };
  }, [arabic, storedEnglish, visit?.saved_at]);

  const primaryText = arabic || storedEnglish;
  if (!primaryText && !english) {
    return t("noVisitRemark");
  }

  return (
    <>
      <div>{primaryText}</div>
      {english ? <div className="moduleCode">{english}</div> : null}
    </>
  );
}

function determinePaymentStatus(visitOutcome, amountReceived, totalDueAmount) {
  if (visitOutcome === "FUNDS_RECEIVED") {
    return Number(amountReceived || 0) >= Number(totalDueAmount || 0) ? "PAID" : "PARTIAL";
  }
  if (visitOutcome === "ASKED_COME_LATER") return "PROMISED";
  return "NOT_PAID";
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value || typeof document === "undefined") return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function mapInitialOutcome(row) {
  const stored = String(row?.latest_collection?.visit_outcome || "").trim().toUpperCase();
  if (stored) return stored;
  const status = String(row?.latest_collection?.payment_status || "").trim().toUpperCase();
  if (status === "PAID" || status === "PARTIAL") return "FUNDS_RECEIVED";
  if (status === "PROMISED") return "ASKED_COME_LATER";
  return "RESPONSIBLE_NOT_AVAILABLE";
}

function buildInitialForm(row) {
  return {
    visitOutcome: mapInitialOutcome(row),
    amountReceived: row?.latest_collection?.amount_received ? String(row.latest_collection.amount_received) : "",
    receiptMode: row?.latest_collection?.receipt_mode || "",
    nextVisitAt: toDateInputValue(row?.latest_collection?.next_visit_at),
    remarkArabic: row?.latest_collection?.remark_arabic || "",
    remarkEnglish: row?.latest_collection?.remark_english || "",
    legalNote: row?.legal_transfer?.note || "",
    paymentCopy: null,
    receiptCopy: null,
  };
}

export default function PaymentCollectionsView({ view = "due" }) {
  const { language, dir, setLanguage } = useAppLanguage();
  const { access } = useModuleAccess();
  const t = translate(language, TEXT);
  const canViewVisitReports = access.role === "admin" || access.role === "manager";
  const [loading, setLoading] = useState(true);
  const [refreshingQueue, setRefreshingQueue] = useState(false);
  const [queueFromCache, setQueueFromCache] = useState(false);
  const [queueOffline, setQueueOffline] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [error, setError] = useState("");
  const [dueCustomers, setDueCustomers] = useState([]);
  const [notDueCustomers, setNotDueCustomers] = useState([]);
  const [legalCustomers, setLegalCustomers] = useState([]);
  const [form, setForm] = useState(buildInitialForm(null));
  const [savingCustomerCode, setSavingCustomerCode] = useState("");
  const [legalBusyCode, setLegalBusyCode] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [selectedSalesmen, setSelectedSalesmen] = useState([]);
  const [selectedSchedulers, setSelectedSchedulers] = useState([]);
  const [schedulerScope, setSchedulerScope] = useState(null);
  const [activeRowKey, setActiveRowKey] = useState("");
  const [summaryForWhatsApp, setSummaryForWhatsApp] = useState("");
  const [receiptFileForWhatsapp, setReceiptFileForWhatsapp] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [visitReportRow, setVisitReportRow] = useState(null);
  const [visitReportText, setVisitReportText] = useState("");
  const [visitReportLoading, setVisitReportLoading] = useState(false);
  const [todayVisitCount, setTodayVisitCount] = useState(0);
  const [expandedRevisitDates, setExpandedRevisitDates] = useState(() => new Set());
  const isMobileLayout = useMobileLayout();
  const recognitionRef = useRef(null);
  const loadSeqRef = useRef(0);
  const queuesRef = useRef({ dueCustomers: [], notDueCustomers: [], legalCustomers: [] });
  const pendingSyncCountRef = useRef(0);
  const activeRowKeyRef = useRef("");
  const { showPopup } = useAppPopup();

  usePopupMessages({ error });

  useEffect(() => {
    queuesRef.current = { dueCustomers, notDueCustomers, legalCustomers };
  }, [dueCustomers, legalCustomers, notDueCustomers]);

  useEffect(() => {
    pendingSyncCountRef.current = pendingSyncCount;
  }, [pendingSyncCount]);

  useEffect(() => {
    activeRowKeyRef.current = activeRowKey;
  }, [activeRowKey]);

  const refreshTodayVisitCount = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.user?.id) return;
      const count = await fetchTodayCollectionVisitCount(supabase, session.user.id);
      setTodayVisitCount(count);
    } catch {
      // Ignore count lookup failures for WhatsApp preview.
    }
  }, []);

  const localizeApiMessage = (message) => {
    const text = String(message || "").trim();
    if (!text) return "";
    if (text.includes("Please login again")) return t("msgLoginAgain");
    if (text.includes("Please select visit outcome")) return t("msgSelectOutcome");
    if (text.includes("Amount received is required")) return t("msgAmountRequired");
    if (text.includes("Mode of receipt is required")) return t("msgModeRequired");
    if (text.includes("Receipt copy is compulsory")) return t("msgReceiptRequired");
    if (text.includes("Next visit date is required") || text.includes("Next visit is required")) return t("msgNextVisitRequired");
    if (text.includes("GPS is required") || text === GPS_REQUIRED_ERROR) return t("msgGpsRequired");
    if (text.includes("Unable to save collection visit")) return t("msgSaveFailed");
    if (text.includes("timed out") || text.toLowerCase().includes("abort")) return t("msgRequestTimeout");
    if (text.toLowerCase().includes("bucket not found") || text.includes("File storage is not configured")) {
      return t("msgStorageUnavailable");
    }
    if (text.includes("too large") || text.includes("Payload Too Large")) return t("msgUploadTooLarge");
    if (text.includes("photo format is not supported") || text.includes("Unable to read this photo")) {
      return t("msgUnsupportedPhoto");
    }
    if (text.includes("Customer record is missing")) return t("msgCustomerMissing");
    if (text.includes("Unable to update legal transfer status")) return t("msgLegalUpdateFailed");
    return text;
  };

  const rowKey = (row) => String(row?.queue_key || row?.customer_code || row?.customer_name || "").trim();

  function toggleSalesman(optionKey) {
    setSelectedSalesmen((current) => (
      current.includes(optionKey)
        ? current.filter((value) => value !== optionKey)
        : [...current, optionKey]
    ));
  }

  function toggleAllSalesmen() {
    setSelectedSalesmen((current) => (
      current.length === salesmanOptions.length
        ? []
        : salesmanOptions.map((option) => option.key)
    ));
  }

  function toggleScheduler(optionKey) {
    setSelectedSchedulers((current) => (
      current.includes(optionKey)
        ? current.filter((value) => value !== optionKey)
        : [...current, optionKey]
    ));
  }

  function toggleAllSchedulers() {
    setSelectedSchedulers((current) => (
      current.length === scheduledRevisitSchedulerOptions.length
        ? []
        : scheduledRevisitSchedulerOptions.map((option) => option.key)
    ));
  }

  const supabaseClient = getSupabaseClient();
  const activeRow = useMemo(() => {
    return [...dueCustomers, ...notDueCustomers, ...legalCustomers].find((row) => rowKey(row) === activeRowKey) || null;
  }, [activeRowKey, dueCustomers, legalCustomers, notDueCustomers]);

  useEffect(() => {
    if (activeRow) {
      setForm(buildInitialForm(activeRow));
    }
  }, [activeRow]);

  useEffect(() => {
    setSummaryForWhatsApp("");
    setCopyStatus("");
    setReceiptFileForWhatsapp(null);
  }, [activeRowKey]);

  useEffect(() => {
    if (!activeRowKey || typeof window === "undefined") return undefined;

    const timer = window.setTimeout(() => {
      const detail = document.getElementById(`collector-detail-${activeRowKey}`);
      detail?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeRowKey]);

  useEffect(() => {
    setSummaryForWhatsApp("");
    setCopyStatus("");
  }, [language]);

  async function applyQueuePayload(payload, preferredKey = "") {
    const due = Array.isArray(payload.dueCustomers) ? payload.dueCustomers : [];
    const notDue = Array.isArray(payload.notDueCustomers) ? payload.notDueCustomers : [];
    const legal = Array.isArray(payload.legalCustomers) ? payload.legalCustomers : [];
    setDueCustomers(due);
    setNotDueCustomers(notDue);
    setLegalCustomers(legal);
    if (payload.schedulerScope) {
      setSchedulerScope(payload.schedulerScope);
    }

    const allRows = [...due, ...notDue, ...legal];
    if (preferredKey) {
      const preferred = allRows.find((row) => rowKey(row) === preferredKey);
      setActiveRowKey(preferred ? preferredKey : rowKey(allRows[0] || {}));
    }

    return { dueCustomers: due, notDueCustomers: notDue, legalCustomers: legal };
  }

  async function loadQueue(preferredKey = "") {
    const supabase = getSupabaseClient();
    const seq = ++loadSeqRef.current;

    if (!supabase) {
      setLoading(false);
      showPopup({ message: t("msgSupabaseMissing"), variant: "error" });
      return { dueCustomers: [], notDueCustomers: [], legalCustomers: [] };
    }

    setError("");

    const safetyTimer = window.setTimeout(() => {
      if (loadSeqRef.current !== seq) return;
      setLoading(false);
      setRefreshingQueue(false);
      setError((current) => current || "Queue load timed out. Showing saved data if available.");
    }, 15000);

    let cachedResult = null;

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (loadSeqRef.current !== seq) return { dueCustomers: [], notDueCustomers: [], legalCustomers: [] };

      if (!session?.access_token || !session?.user?.id) throw new Error("Please login again.");

      const cachedQueues = await readCollectionQueuesForUser(session.user.id);
      if (loadSeqRef.current !== seq) return { dueCustomers: [], notDueCustomers: [], legalCustomers: [] };
      if (cachedQueues) {
        cachedResult = await applyQueuePayload(cachedQueues, preferredKey);
        setQueueFromCache(true);
        setLoading(false);
        setRefreshingQueue(true);
      } else {
        setLoading(true);
      }

      const queueResult = await fetchCollectionQueuesCached(session.access_token, session.user.id, {
        onUpdate: (freshQueues) => {
          if (loadSeqRef.current !== seq) return;
          applyQueuePayload(freshQueues, preferredKey);
          setQueueFromCache(false);
          setQueueOffline(false);
          setRefreshingQueue(false);
        },
      });

      if (loadSeqRef.current !== seq) return cachedResult || queueResult.queues;

      const result = await applyQueuePayload({
        ...queueResult.queues,
        schedulerScope: queueResult.queues?.schedulerScope || queueResult.schedulerScope || null,
      }, preferredKey);
      setQueueFromCache(Boolean(queueResult.fromCache));
      setQueueOffline(Boolean(queueResult.offline));
      setRefreshingQueue(Boolean(queueResult.fromCache && !queueResult.offline));
      setError("");
      return result;
    } catch (err) {
      if (loadSeqRef.current !== seq) return { dueCustomers: [], notDueCustomers: [], legalCustomers: [] };

      if (cachedResult) {
        setQueueFromCache(true);
        setQueueOffline(typeof navigator !== "undefined" && !navigator.onLine);
        setError("");
        return cachedResult;
      }

      const message = String(err.message || "");
      if (message === "SESSION_TIMEOUT") {
        setError("Session check timed out. Please refresh the page or login again.");
      } else if (message.includes("timed out")) {
        setError(message);
      } else {
        setError(localizeApiMessage(message || "Unable to load payment collection queue."));
      }
      setDueCustomers([]);
      setNotDueCustomers([]);
      setLegalCustomers([]);
      return { dueCustomers: [], notDueCustomers: [], legalCustomers: [] };
    } finally {
      window.clearTimeout(safetyTimer);
      if (loadSeqRef.current === seq) {
        setLoading(false);
        setRefreshingQueue(false);
      }
    }
  }

  async function persistOptimisticVisitSave(row, visitDetails, userId, scope) {
    const latestCollection = buildOptimisticLatestCollection(row, visitDetails);
    const patchedQueues = patchCollectionQueuesWithOptimisticVisit(
      queuesRef.current,
      row.customer_code,
      latestCollection,
    );

    queuesRef.current = patchedQueues;
    await applyQueuePayload(patchedQueues, rowKey(row));
    await writeCollectionQueuesForUser(userId, scope, patchedQueues);
    await incrementLocalCollectionVisitCount(userId);
    return latestCollection;
  }

  async function refreshPendingSyncCount() {
    try {
      const count = await countCollectionPendingSync();
      setPendingSyncCount(count);
      return count;
    } catch {
      setPendingSyncCount(0);
      return 0;
    }
  }

  useEffect(() => {
    loadQueue();
    refreshTodayVisitCount();
    refreshPendingSyncCount();

    const onSnapshotHydrated = () => {
      loadQueue();
    };
    const onQueueChanged = async () => {
      const previousCount = pendingSyncCountRef.current;
      const nextCount = await refreshPendingSyncCount();
      if (previousCount > 0 && nextCount < previousCount) {
        void loadQueue(activeRowKeyRef.current);
        refreshTodayVisitCount();
      }
    };

    window.addEventListener("madiba-mobile-snapshot-hydrated", onSnapshotHydrated);
    window.addEventListener("madiba-offline-queue-changed", onQueueChanged);
    window.addEventListener("online", onQueueChanged);
    return () => {
      loadSeqRef.current += 1;
      window.removeEventListener("madiba-mobile-snapshot-hydrated", onSnapshotHydrated);
      window.removeEventListener("madiba-offline-queue-changed", onQueueChanged);
      window.removeEventListener("online", onQueueChanged);
    };
  }, []);

  const salesmanOptions = useMemo(
    () => buildSalesmanOptions([...dueCustomers, ...notDueCustomers, ...legalCustomers]),
    [dueCustomers, legalCustomers, notDueCustomers],
  );

  const queueToday = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function keepRowInActiveDueQueue(row) {
    const key = rowKey(row);
    if (activeRowKey && key === activeRowKey) return true;
    // Cash-only customers live in the cash subsection; mixed cash+credit customers stay in both.
    if (isCashOnlyQueueCustomer(row, queueToday)) return false;
    return true;
  }

  const filteredDueRows = useMemo(
    () => filterQueueRows(dueCustomers, customerFilter, selectedSalesmen),
    [customerFilter, dueCustomers, selectedSalesmen],
  );

  const cashQueueSourceRows = useMemo(() => {
    if (view !== "due") return [];
    const sourceRows = filterQueueRows(
      [...dueCustomers, ...notDueCustomers],
      customerFilter,
      selectedSalesmen,
    );
    return sortCashQueueCustomers(
      sourceRows.filter((row) => isCashQueueCustomer(row, queueToday)),
    );
  }, [customerFilter, dueCustomers, notDueCustomers, queueToday, selectedSalesmen, view]);

  const visibleRows = useMemo(
    () => (view === "legal"
      ? filterQueueRows(legalCustomers, customerFilter, selectedSalesmen)
      : filteredDueRows.filter((row) => keepRowInActiveDueQueue(row))),
    [activeRowKey, customerFilter, filteredDueRows, legalCustomers, queueToday, selectedSalesmen, view],
  );

  const visibleNotDueRows = useMemo(
    () => (view === "due"
      ? filterQueueRows(notDueCustomers, customerFilter, selectedSalesmen)
        .filter((row) => keepRowInActiveDueQueue(row))
      : []),
    [activeRowKey, customerFilter, notDueCustomers, queueToday, selectedSalesmen, view],
  );

  const scheduledRevisitSourceRows = useMemo(() => {
    if (view !== "due") return [];
    const viewer = buildSchedulerViewerContext(schedulerScope);
    return filterQueueRows([...dueCustomers, ...notDueCustomers], customerFilter, selectedSalesmen)
      .filter((row) => isScheduledRevisitQueueCustomer(row, queueToday))
      .filter((row) => !viewer || canViewerSeeScheduledRevisit(row?.latest_collection, null, viewer))
      .sort((left, right) => (
        toDateInputValue(left?.latest_collection?.next_visit_at)
          .localeCompare(toDateInputValue(right?.latest_collection?.next_visit_at))
      ));
  }, [customerFilter, dueCustomers, notDueCustomers, queueToday, schedulerScope, selectedSalesmen, view]);

  const scheduledRevisitSchedulerOptions = useMemo(() => {
    if (schedulerScope?.canSeeAllSchedulers) {
      const options = new Map();
      scheduledRevisitSourceRows.forEach((row) => {
        const key = getScheduledByKey(row);
        const label = getScheduledByLabel(row);
        if (!key || label === "-") return;
        if (!options.has(key)) {
          options.set(key, { key, label });
        }
      });
      return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
    }

    return (schedulerScope?.visibleSchedulers || [])
      .map((entry) => ({ key: entry.id, label: entry.label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [scheduledRevisitSourceRows, schedulerScope]);

  const scheduledRevisitRows = useMemo(() => {
    if (schedulerScope?.canSeeAllSchedulers) {
      if (selectedSchedulers.length === 0) return scheduledRevisitSourceRows;
      const selected = new Set(selectedSchedulers);
      return scheduledRevisitSourceRows.filter((row) => selected.has(getScheduledByKey(row)));
    }

    const defaultSelection = schedulerScope?.visibleSchedulerUserIds || [];
    const activeSelection = selectedSchedulers.length > 0 ? selectedSchedulers : defaultSelection;
    if (activeSelection.length === 0) return scheduledRevisitSourceRows;
    const selected = new Set(activeSelection);
    return scheduledRevisitSourceRows.filter((row) => selected.has(getScheduledByKey(row)));
  }, [scheduledRevisitSourceRows, schedulerScope, selectedSchedulers]);

  const scheduledRevisitGroups = useMemo(() => {
    const groups = new Map();

    scheduledRevisitRows.forEach((row) => {
      const dateKey = toDateInputValue(row?.latest_collection?.next_visit_at);
      if (!dateKey) return;

      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey).push(row);
    });

    return [...groups.entries()].map(([dateKey, rows]) => ({
      dateKey,
      dateLabel: formatDateOnly(dateKey),
      rows,
    }));
  }, [scheduledRevisitRows]);

  function toggleRevisitDateGroup(dateKey) {
    setExpandedRevisitDates((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }

  const tableRows = useMemo(() => {
    if (view !== "due") {
      return visibleRows.map((row) => ({ type: "customer", row }));
    }

    const items = visibleRows.map((row) => ({ type: "customer", row }));
    if (visibleNotDueRows.length > 0) {
      items.push({ type: "separator" });
      visibleNotDueRows.forEach((row) => items.push({ type: "customer", row }));
    }
    return items;
  }, [visibleRows, visibleNotDueRows, view]);

  const cashQueuePriorityByKey = useMemo(() => {
    const priorities = new Map();
    cashQueueSourceRows.forEach((row, index) => {
      priorities.set(rowKey(row), index + 1);
    });
    return priorities;
  }, [cashQueueSourceRows]);

  const dueQueuePriorityByCode = useMemo(
    () => buildVisibleDueQueuePriorityMap(dueCustomers, queueToday),
    [dueCustomers, queueToday],
  );

  const nearestCustomerSourceRows = useMemo(
    () => [...dueCustomers, ...notDueCustomers],
    [dueCustomers, notDueCustomers],
  );

  const {
    suggestions: nearestCustomerSuggestions,
    loading: nearestCustomersLoading,
    locationUnavailable: nearestCustomersUnavailable,
    refresh: refreshNearestCustomers,
  } = useNearestCustomerSuggestions(nearestCustomerSourceRows);

  const openNearestCustomer = useCallback((customer) => {
    const code = String(customer?.customer_code || "").trim().toUpperCase();
    const row = nearestCustomerSourceRows.find(
      (entry) => String(entry.customer_code || "").trim().toUpperCase() === code,
    );
    if (!row) return;

    const key = rowKey(row);
    setActiveRowKey(key);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById(`collector-detail-${key}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [nearestCustomerSourceRows]);

  const allSalesmenSelected = salesmanOptions.length > 0 && selectedSalesmen.length === salesmanOptions.length;
  const allSchedulersSelected = scheduledRevisitSchedulerOptions.length > 0
    && selectedSchedulers.length === scheduledRevisitSchedulerOptions.length;

  useEffect(() => {
    const text = String(form.remarkArabic || "").trim();
    if (!activeRow || !text) return;

    const timer = setTimeout(async () => {
      setIsTranslating(true);
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, from: "ar", to: "en" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.success && payload.translatedText) {
          setForm((current) => {
            const currentEnglish = String(current.remarkEnglish || "").trim();
            const currentArabic = String(current.remarkArabic || "").trim();
            if (currentEnglish && currentEnglish !== currentArabic) return current;
            return { ...current, remarkEnglish: String(payload.translatedText) };
          });
        }
      } catch {
      } finally {
        setIsTranslating(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [form.remarkArabic, activeRow]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Collections unavailable"
        message="The payment collections screen needs Supabase credentials to load customer queues."
      />
    );
  }

  async function openVisitReport(row) {
    if (!row?.latest_collection?.saved_at) return;

    setVisitReportRow(row);
    setVisitReportLoading(true);
    setVisitReportText("");

    try {
      setVisitReportText(await buildVisitReportText(row, t));
    } finally {
      setVisitReportLoading(false);
    }
  }

  async function saveVisit(row, options = {}) {
    const transferToLegal = Boolean(options.transferToLegal);
    const supabase = getSupabaseClient();
    if (!supabase) {
      showPopup({ message: t("msgSupabaseMissing"), variant: "error" });
      return;
    }

    setSavingCustomerCode(row.customer_code);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);

      if (!session?.access_token) throw new Error(t("msgLoginAgain"));

      const selectedOutcome = transferToLegal ? "TRANSFER_TO_LEGAL" : form.visitOutcome;

      if (!selectedOutcome) {
        throw new Error(t("msgSelectOutcome"));
      }
      if (selectedOutcome === "FUNDS_RECEIVED" && Number(form.amountReceived || 0) <= 0) {
        throw new Error(t("msgAmountRequired"));
      }
      if (selectedOutcome === "FUNDS_RECEIVED" && !form.receiptMode) {
        throw new Error(t("msgModeRequired"));
      }
      if (selectedOutcome === "FUNDS_RECEIVED" && !form.receiptCopy && !row?.latest_collection?.receipt_copy_url) {
        throw new Error(t("msgReceiptRequired"));
      }

      const paymentStatus = determinePaymentStatus(selectedOutcome, form.amountReceived, row.total_due_amount);
      const requiresNextVisit = !transferToLegal
        && selectedOutcome !== "TRANSFER_TO_LEGAL"
        && paymentStatus !== "PAID";
      if (requiresNextVisit && !form.nextVisitAt) {
        throw new Error(t("msgNextVisitRequired"));
      }

      const outcomeReason = ["RESPONSIBLE_NOT_AVAILABLE", "WRONG_CREDIT_DAYS", "NO_DUE_AS_PER_CUSTOMER", "TRANSFER_TO_LEGAL"].includes(selectedOutcome)
        ? formatOutcomeLabel(selectedOutcome, t)
        : "";

      const pendingQueuedCount = await countCollectionPendingSync();
      const [effectiveEnglishRemark, visitNumberForDay, gps] = await Promise.all([
        resolveEnglishRemarkForSave(form.remarkArabic, form.remarkEnglish),
        resolveCollectionVisitNumberForDay(session.user.id, {
          cachedServerCount: todayVisitCount,
          pendingQueuedCount,
        }),
        captureGpsLocationWithFallbackConfirm(language, {
          customerCode: row.customer_code,
          customerName: row.customer_name,
          accessToken: session.access_token,
          role: access.role,
          skipCustomerLocationUpdate: true,
        }),
      ]);

      if (effectiveEnglishRemark !== form.remarkEnglish) {
        setForm((current) => ({ ...current, remarkEnglish: effectiveEnglishRemark }));
      }

      const customerCodeKey = String(row.customer_code || "").trim().toUpperCase();
      const resolvedQueuePriority = dueQueuePriorityByCode.get(customerCodeKey)
        || cashQueuePriorityByKey.get(rowKey(row))
        || 0;

      const summaryText = buildVisitSummary(
        row,
        { ...form, visitOutcome: selectedOutcome },
        effectiveEnglishRemark,
        t,
        {
          visitNumberForDay,
          queuePriority: resolvedQueuePriority,
        },
      );

      const formData = new FormData();
      formData.append("customerCode", row.customer_code);
      formData.append("customerName", row.customer_name || "");
      formData.append("paymentStatus", paymentStatus);
      formData.append("amountReceived", form.amountReceived || "0");
      formData.append("receiptMode", form.receiptMode || "");
      formData.append("nonPaymentReason", outcomeReason || "");
      formData.append("nextVisitAt", form.nextVisitAt || "");
      formData.append("visitOutcome", selectedOutcome || "");
      formData.append("remarkArabic", form.remarkArabic || "");
      formData.append("remarkEnglish", effectiveEnglishRemark || "");
      formData.append("summaryText", summaryText);
      formData.append("sendWhatsapp", "1");
      formData.append("whatsappMessage", summaryText);
      formData.append("queuePriority", String(resolvedQueuePriority));
      formData.append("probabilityScore", String(row.probability_score || 0));
      formData.append("probabilityLabel", String(row.probability_label || ""));
      formData.append("visitNumberForDay", String(visitNumberForDay));
      formData.append("legalNote", form.legalNote || t("defaultLegalNote"));

      if (gps) {
        formData.append("latitude", String(gps.latitude));
        formData.append("longitude", String(gps.longitude));
        formData.append("gpsAccuracyMeters", String(gps.accuracy));
      }

      if (form.paymentCopy) {
        formData.append("paymentCopy", await prepareUploadFile(form.paymentCopy));
      }

      let receiptFileForShare = null;
      if (form.receiptCopy) {
        receiptFileForShare = await prepareUploadFile(form.receiptCopy);
        formData.append("receiptCopy", receiptFileForShare);
      }

      const saveResult = await postFormDataResilient({
        url: "/api/payment-collections",
        formData,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        metadata: {
          type: "collection_visit",
          customerCode: row.customer_code,
        },
        timeoutMs: 25000,
        queueOnTimeout: true,
      });

      const payload = saveResult.payload || {};
      const popupMessage = saveResult.queued
        ? t("msgSavedOffline")
        : payload?.whatsapp?.error
          ? `${t("msgVisitSaved")} ${t("msgWhatsappNotSent")}: ${payload.whatsapp.error}`
          : t("msgVisitSaved");
      showPopup({ message: popupMessage, variant: "success" });
      setTodayVisitCount(visitNumberForDay);
      await refreshPendingSyncCount();

      if (!saveResult.queued) {
        if (gps) {
          void promptCustomerLocationUpdateAfterVisit({
            language,
            customerCode: row.customer_code,
            customerName: row.customer_name,
            entryLocation: gps,
            accessToken: session.access_token,
          });
        }
        await loadQueue(rowKey(row));
      } else {
        const { scope } = await fetchSalesScopeCached();
        await persistOptimisticVisitSave(row, {
          visitOutcome: selectedOutcome,
          paymentStatus,
          amountReceived: form.amountReceived,
          nextVisitAt: form.nextVisitAt,
          remarkArabic: form.remarkArabic,
          remarkEnglish: effectiveEnglishRemark,
          summaryText,
        }, session.user.id, scope);
        void processOfflineQueue(async () => session.access_token);
      }

      await presentWhatsappSummaryAfterSave(summaryText, {
        autoOpenWhatsapp: Boolean(saveResult.queued),
        receiptFile: receiptFileForShare,
      });
      setReceiptFileForWhatsapp(receiptFileForShare);
    } catch (err) {
      showPopup({ message: localizeApiMessage(err.message || t("msgSaveFailed")), variant: "error" });
    } finally {
      setSavingCustomerCode("");
    }
  }

  function startDictation() {
    if (typeof window === "undefined") return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showPopup({ message: t("msgSpeechUnsupported"), variant: "warning" });
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsDictating(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ar-SA";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) {
        setForm((current) => ({
          ...current,
          remarkArabic: [current.remarkArabic, transcript].filter(Boolean).join(" ").trim(),
        }));
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsDictating(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setIsDictating(false);
    };

    recognitionRef.current = recognition;
    setIsDictating(true);
    recognition.start();
  }

  async function copySummaryText() {
    const summaryText = String(summaryForWhatsApp || "").trim();
    if (!summaryText) return;
    try {
      const copied = await copyTextToClipboard(summaryText);
      if (!copied) throw new Error("copy-failed");
      setCopyStatus(t("copied"));
      setTimeout(() => setCopyStatus(""), 1200);
    } catch {
      setCopyStatus("");
      showPopup({ message: t("msgCopyFailed"), variant: "error" });
    }
  }

  function scrollToWhatsappSummary() {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      document.getElementById("collector-whatsapp-summary")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 120);
  }

  async function shareSummaryWithReceiptOnWhatsapp(summaryText = summaryForWhatsApp, receiptFile = receiptFileForWhatsapp) {
    const text = String(summaryText || "").trim();
    const file = receiptFile instanceof Blob ? receiptFile : null;
    if (!text || !file) {
      return shareSummaryOnWhatsapp(summaryText);
    }

    const result = await shareTextAndFilesOnWhatsapp(text, [file], {
      title: t("summary"),
      dialogTitle: t("shareWhatsappWithReceipt"),
    });

    if (result.success) {
      if (result.fallback) {
        showPopup({ message: t("msgWhatsappReceiptFallback"), variant: "warning" });
      }
      return;
    }
    if (result.reason === "cancelled") return;

    showPopup({ message: t("msgWhatsappShareFailed"), variant: "warning" });
  }

  async function shareSummaryOnWhatsapp(summaryText = summaryForWhatsApp) {
    const text = String(summaryText || "").trim();
    if (!text) return;

    const result = await shareTextOnWhatsapp(text, {
      title: t("summary"),
      dialogTitle: t("shareWhatsapp"),
    });

    if (result.success) return;
    if (result.reason === "cancelled") return;

    showPopup({ message: t("msgWhatsappShareFailed"), variant: "warning" });
  }

  async function presentWhatsappSummaryAfterSave(summaryText, options = {}) {
    setSummaryForWhatsApp(summaryText);
    if (options.receiptFile instanceof Blob) {
      setReceiptFileForWhatsapp(options.receiptFile);
    }
    scrollToWhatsappSummary();

    const copied = await copyTextToClipboard(summaryText);
    if (copied) {
      setCopyStatus(t("copied"));
      setTimeout(() => setCopyStatus(""), 1200);
    }

    if (options.autoOpenWhatsapp) {
      window.setTimeout(() => {
        if (options.receiptFile instanceof Blob) {
          void shareSummaryWithReceiptOnWhatsapp(summaryText, options.receiptFile);
        } else {
          void shareSummaryOnWhatsapp(summaryText);
        }
      }, 450);
    }
  }

  async function toggleLegal(row, action) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      showPopup({ message: t("msgSupabaseMissing"), variant: "error" });
      return;
    }

    setLegalBusyCode(row.customer_code);
    setError("");
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);

      if (!session?.access_token) throw new Error(t("msgLoginAgain"));

      const gps = await captureGpsLocationWithFallbackConfirm(language, {
        customerCode: row.customer_code,
        customerName: row.customer_name,
        accessToken: session.access_token,
        role: access.role,
      });
      const platform = await resolveGpsCapturePlatform();

      const response = await fetch("/api/payment-collections", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerCode: row.customer_code,
          customerName: row.customer_name,
          note: form.legalNote,
          action,
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
          gpsAccuracyMeters: gps?.accuracy ?? null,
          platform,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to update legal transfer status.");
      }

      showPopup({
        message: action === "remove"
          ? `${row.customer_name} ${t("msgLegalRemoved")}`
          : `${row.customer_name} ${t("msgLegalTransferred")}`,
        variant: "success",
      });
      await loadQueue(rowKey(row));
      if (action !== "remove" && view !== "legal") {
        setActiveRowKey("");
      }
    } catch (err) {
      showPopup({ message: localizeApiMessage(err.message || t("msgLegalUpdateFailed")), variant: "error" });
    } finally {
      setLegalBusyCode("");
    }
  }

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><Link href="/management" className="moduleBackLink">{t("dashboard")}</Link></div>
          </div>

          {error ? (
            <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
              {error.toLowerCase().includes("login") ? (
                <Link href="/" className="moduleInlineButton moduleActionButton">Go to login</Link>
              ) : (
                <button type="button" className="moduleInlineButton moduleActionButton" onClick={() => loadQueue()} disabled={loading}>
                  Retry
                </button>
              )}
            </div>
          ) : null}

          {queueOffline ? (
            <div className="moduleHint" style={{ marginBottom: "12px" }}>{t("offlineQueueBanner")}</div>
          ) : null}
          {queueFromCache && !queueOffline ? (
            <div className="moduleHint" style={{ marginBottom: "12px" }}>{t("staleQueueBanner")}</div>
          ) : null}
          {refreshingQueue ? (
            <div className="moduleHint" style={{ marginBottom: "12px" }}>{t("cacheRefreshing")}</div>
          ) : null}
          {pendingSyncCount > 0 ? (
            <div className="moduleHint" style={{ marginBottom: "12px" }}>
              {pendingSyncCount} {t("pendingSyncBanner")}
            </div>
          ) : null}

          <div className="moduleInlineStack" style={{ marginBottom: "12px" }}>
            <Link href="/management/payment-collections" className={`moduleInlineButton moduleActionButton${view === "due" ? " moduleCollectorTabActive" : ""}`}>{t("dueQueue")}</Link>
            <Link href="/management/payment-collections/legal" className={`moduleInlineButton moduleActionButton${view === "legal" ? " moduleCollectorTabActive" : ""}`}>{t("legalQueue")}</Link>
            <AccessibleHeaderLink moduleKey="collectionReport" href="/management/collection-report" className="moduleInlineButton moduleActionButton">
              Collection Route Report
            </AccessibleHeaderLink>
            <AccessibleHeaderLink moduleKey="dailyVisitReport" href="/management/daily-visit-report" className="moduleInlineButton moduleActionButton">
              Daily Visit Report
            </AccessibleHeaderLink>
          </div>

          {view === "due" ? (
            <>
            <NearestCustomerSuggestions
              suggestions={nearestCustomerSuggestions}
              loading={nearestCustomersLoading}
              locationUnavailable={nearestCustomersUnavailable}
              onSelect={openNearestCustomer}
              onRefresh={refreshNearestCustomers}
              actionLabel={t("open")}
            />
            <section className="moduleSection" style={{ marginBottom: "12px" }}>
              <div className="moduleSectionHeader">
                <h2>{t("scheduledRevisitsTitle")}</h2>
                <span>{scheduledRevisitRows.length}</span>
              </div>
              <div className="moduleHint" style={{ marginBottom: "10px" }}>{t("scheduledRevisitsHint")}</div>
              {isMobileLayout ? (
                <div className="moduleHint" style={{ marginBottom: "10px" }}>{t("scheduledRevisitsMobileHint")}</div>
              ) : null}
              {scheduledRevisitSourceRows.length > 0 ? (
                <div style={{ marginBottom: "10px" }}>
                  <div className="moduleCollectorCheckboxList" role="group" aria-label={t("scheduledByFilter")}>
                    {scheduledRevisitSchedulerOptions.length === 0 ? (
                      <div className="moduleHint">{t("allSchedulers")}</div>
                    ) : (
                      <>
                        <label className="moduleCollectorCheckbox moduleCollectorCheckboxSelectAll">
                          <input
                            type="checkbox"
                            checked={allSchedulersSelected}
                            onChange={toggleAllSchedulers}
                          />
                          <span>{t("selectAllSchedulers")}</span>
                        </label>
                        {scheduledRevisitSchedulerOptions.map((option) => (
                          <label key={option.key} className="moduleCollectorCheckbox">
                            <input
                              type="checkbox"
                              checked={selectedSchedulers.includes(option.key)}
                              onChange={() => toggleScheduler(option.key)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="moduleHint" style={{ marginTop: "4px" }}>{t("scheduledByFilterHint")}</div>
                  {selectedSchedulers.length > 0 ? (
                    <button
                      type="button"
                      className="moduleInlineButton moduleActionButton"
                      style={{ marginTop: "6px" }}
                      onClick={() => setSelectedSchedulers([])}
                    >
                      {t("clearScheduledByFilter")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {scheduledRevisitRows.length === 0 ? (
                <div className="moduleHint">
                  {scheduledRevisitSourceRows.length > 0 && selectedSchedulers.length > 0
                    ? t("noScheduledRevisitsForFilter")
                    : t("noScheduledRevisits")}
                </div>
              ) : (
                <div className="moduleTableWrap">
                  <table className="moduleTable moduleCollectorInvoiceTable">
                    <thead>
                      <tr>
                        <th>{t("priorityNumber")}</th>
                        <th>{t("customerCode")}</th>
                        <th>{t("customer")}</th>
                        <th>{t("salesman")}</th>
                        <th>{t("scheduledBy")}</th>
                        <th>{t("lastVisitDate")}</th>
                        <th>{t("visitRemark")}</th>
                        <th>{t("amount")}</th>
                        <th>{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduledRevisitGroups.map((group) => {
                        const isExpanded = !isMobileLayout || expandedRevisitDates.has(group.dateKey);
                        const isOverdueGroup = group.dateKey < queueToday;
                        return (
                        <Fragment key={`revisit-group-${group.dateKey}`}>
                          <tr
                            className={`moduleCollectorSectionRow${isMobileLayout ? " moduleCollectorSectionRow--mobileToggle" : ""}`}
                            onClick={isMobileLayout ? () => toggleRevisitDateGroup(group.dateKey) : undefined}
                            onKeyDown={isMobileLayout ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleRevisitDateGroup(group.dateKey);
                              }
                            } : undefined}
                            tabIndex={isMobileLayout ? 0 : undefined}
                            role={isMobileLayout ? "button" : undefined}
                            aria-expanded={isMobileLayout ? isExpanded : undefined}
                          >
                            <td colSpan={9}>
                              <div className="moduleCollectorSectionRowContent">
                                <strong>{group.dateLabel}</strong>
                                {isOverdueGroup ? (
                                  <span className="moduleCollectorProbability moduleCollectorProbabilityLOW" style={{ marginInlineStart: "8px" }}>
                                    {t("overdueRevisit")}
                                  </span>
                                ) : null}
                                <span className="moduleHint" style={{ marginInlineStart: "8px" }}>
                                  {group.rows.length}
                                </span>
                                {isMobileLayout ? (
                                  <span className="moduleCollectorSectionRowToggleIcon" aria-hidden="true">
                                    {isExpanded ? "▾" : "▸"}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {group.rows.map((row) => {
                            const key = rowKey(row);
                            const customerCodeKey = String(row.customer_code || "").trim().toUpperCase();
                            const queuePriority = dueQueuePriorityByCode.get(customerCodeKey)
                              || cashQueuePriorityByKey.get(key)
                              || 0;
                            const isOpen = activeRowKey === key;
                            if (isMobileLayout && !isExpanded) return null;
                            return (
                              <tr
                                key={`revisit-${key}`}
                                className={`moduleCollectorRevisitDetailRow${isMobileLayout && !isExpanded ? " is-collapsed" : ""}`}
                              >
                                <td data-label={t("priorityNumber")}>{queuePriority > 0 ? queuePriority : "-"}</td>
                                <td data-label={t("customerCode")}>{row.customer_code}</td>
                                <td data-label={t("customer")}>{row.customer_name}</td>
                                <td data-label={t("salesman")}>{getSalesmanLabel(row)}</td>
                                <td data-label={t("scheduledBy")}>{getScheduledByLabel(row)}</td>
                                <td data-label={t("lastVisitDate")}>{formatLastVisitDate(row)}</td>
                                <td data-label={t("visitRemark")}>
                                  <VisitRemarkCell row={row} t={t} />
                                </td>
                                <td data-label={t("amount")}>{formatMoney(row.total_due_amount || row.total_not_due_amount)}</td>
                                <td data-label={t("actions")}>
                                  <div className="moduleInlineStack moduleActionStack">
                                    <button
                                      type="button"
                                      className="moduleInlineButton moduleActionButton"
                                      onClick={() => setActiveRowKey(isOpen ? "" : key)}
                                    >
                                      {isOpen ? t("close") : t("open")}
                                    </button>
                                    {canViewVisitReports && row?.latest_collection?.saved_at ? (
                                      <button
                                        type="button"
                                        className="moduleInlineButton moduleActionButton"
                                        onClick={() => openVisitReport(row)}
                                      >
                                        {t("viewVisitReport")}
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            </>
          ) : null}

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{view === "legal" ? t("legalQueue") : t("dueQueue")}</h2>
              <span>{visibleRows.length}</span>
            </div>

            <div className="moduleCollectorFilterGrid" style={{ marginBottom: "10px" }}>
              <input
                className="moduleInput"
                value={customerFilter}
                onChange={(event) => setCustomerFilter(event.target.value)}
                placeholder={t("customerFilterPlaceholder")}
              />
              <div>
                <div className="moduleCollectorCheckboxList" role="group" aria-label={t("salesmanFilter")}>
                  {salesmanOptions.length === 0 ? (
                    <div className="moduleHint">{t("allSalesmen")}</div>
                  ) : (
                    <>
                      <label className="moduleCollectorCheckbox moduleCollectorCheckboxSelectAll">
                        <input
                          type="checkbox"
                          checked={allSalesmenSelected}
                          onChange={toggleAllSalesmen}
                        />
                        <span>{t("selectAllSalesmen")}</span>
                      </label>
                      {salesmanOptions.map((option) => (
                        <label key={option.key} className="moduleCollectorCheckbox">
                          <input
                            type="checkbox"
                            checked={selectedSalesmen.includes(option.key)}
                            onChange={() => toggleSalesman(option.key)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
                <div className="moduleHint" style={{ marginTop: "4px" }}>{t("salesmanFilterHint")}</div>
                {selectedSalesmen.length > 0 ? (
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    style={{ marginTop: "6px" }}
                    onClick={() => setSelectedSalesmen([])}
                  >
                    {t("clearSalesmanFilter")}
                  </button>
                ) : null}
              </div>
            </div>

            {view === "due" ? (
              <div style={{ marginBottom: "14px" }}>
                <div className="moduleSectionHeader">
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>{t("cashQueueTitle")}</h3>
                  <span>{cashQueueSourceRows.length}</span>
                </div>
                <div className="moduleHint" style={{ marginBottom: "10px" }}>{t("cashQueueHint")}</div>
                {cashQueueSourceRows.length === 0 ? (
                  <div className="moduleHint">{t("noCashQueue")}</div>
                ) : (
                  <div className="moduleTableWrap">
                    <table className="moduleTable moduleCollectorTable">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{t("customerCode")}</th>
                          <th>{t("customer")}</th>
                          <th>{t("salesman")}</th>
                          <th>{t("cashDueAmount")}</th>
                          <th>{t("amount")}</th>
                          <th>{t("overdue")}</th>
                          <th>{t("lastVisitDate")}</th>
                          <th>{t("actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashQueueSourceRows.map((row, index) => {
                          const key = rowKey(row);
                          return (
                            <tr key={`cash-${key}`}>
                              <td data-label="#">{index + 1}</td>
                              <td data-label={t("customerCode")}>{row.customer_code}</td>
                              <td data-label={t("customer")}>{row.customer_name}</td>
                              <td data-label={t("salesman")}>{getSalesmanLabel(row)}</td>
                              <td data-label={t("cashDueAmount")}>{formatMoney(row.outstanding_cash)}</td>
                              <td data-label={t("amount")}>{formatMoney(row.total_due_amount)}</td>
                              <td data-label={t("overdue")}>{row.max_overdue_days || 0}</td>
                              <td data-label={t("lastVisitDate")}>{formatLastVisitDate(row)}</td>
                              <td data-label={t("actions")}>
                                <div className="moduleInlineStack moduleActionStack">
                                  <button
                                    type="button"
                                    className="moduleInlineButton moduleActionButton"
                                    onClick={() => setActiveRowKey(activeRowKey === key ? "" : key)}
                                  >
                                    {activeRowKey === key ? t("close") : t("open")}
                                  </button>
                                  {canViewVisitReports && row?.latest_collection?.saved_at ? (
                                    <button
                                      type="button"
                                      className="moduleInlineButton moduleActionButton"
                                      onClick={() => openVisitReport(row)}
                                    >
                                      {t("viewVisitReport")}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {view === "due" ? (
              <div className="moduleSectionHeader" style={{ marginTop: "4px" }}>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>{t("creditQueueTitle")}</h3>
                <span>{visibleRows.length}</span>
              </div>
            ) : null}
            {view === "due" ? (
              <div className="moduleHint" style={{ marginBottom: "10px" }}>{t("creditQueueHint")}</div>
            ) : null}

            <div className="moduleTableWrap moduleCollectorTableWrap">
              <table className="moduleTable moduleCollectorTable">
                <thead>
                  <tr>
                    <th>{t("customerCode")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("salesman")}</th>
                    <th>{t("cityArea")}</th>
                    <th>{t("amount")}</th>
                    <th>{t("cashBucket")}</th>
                    <th>{t("bucket30")}</th>
                    <th>{t("bucket31to60")}</th>
                    <th>{t("bucket61to90")}</th>
                    <th>{t("bucket91to120")}</th>
                    <th>{t("bucket120plus")}</th>
                    <th>{t("overdue")}</th>
                    <th>{t("invoices")}</th>
                    <th>{t("probability")}</th>
                    <th>{t("lastOutcome")}</th>
                    <th>{t("lastUpdate")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((item, tableIndex) => {
                    if (item.type === "separator") {
                      return (
                        <tr key="not-due-separator" className="moduleCollectorSectionRow">
                          <td colSpan={17}>
                            <strong>{t("notDueQueue")}</strong>
                            <div className="moduleHint">{t("notDueHint")}</div>
                          </td>
                        </tr>
                      );
                    }

                    const row = item.row;
                    const key = rowKey(row);
                    const customerCodeKey = String(row.customer_code || "").trim().toUpperCase();
                    const queuePriority = dueQueuePriorityByCode.get(customerCodeKey) || 0;
                    const isOpen = activeRowKey === key;
                    const isNotDue = row.queue_kind === "not_due";
                    return (
                      <Fragment key={`${key}-${tableIndex}`}>
                        <tr key={key}>
                          <td data-label={t("customerCode")}>{formatCustomerCodeWithPriority(row.customer_code, queuePriority)}</td>
                          <td data-label={t("customer")} className="moduleCollectorCellPrimary">{row.customer_name || row.customer_code}</td>
                          <td data-label={t("salesman")}>{row.salesman_name || row.salesman_code || "-"}</td>
                          <td data-label={t("cityArea")}>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                          <td data-label={t("amount")} className="moduleCollectorCellPrimary">{formatMoney(isNotDue ? row.total_not_due_amount : row.total_due_amount)}</td>
                          <td data-label={t("cashBucket")}>{formatMoney(row.outstanding_cash)}</td>
                          <td data-label={t("bucket30")}>{formatMoney(row.outstanding_0_30)}</td>
                          <td data-label={t("bucket31to60")}>{formatMoney(row.outstanding_30_60)}</td>
                          <td data-label={t("bucket61to90")}>{formatMoney(row.outstanding_61_90)}</td>
                          <td data-label={t("bucket91to120")}>{formatMoney(row.outstanding_91_120)}</td>
                          <td data-label={t("bucket120plus")}>{formatMoney(row.outstanding_above_120)}</td>
                          <td data-label={t("overdue")}>{row.max_overdue_days || 0}</td>
                          <td data-label={t("invoices")}>{isNotDue ? row.not_due_invoice_count || 0 : row.due_invoice_count || 0}</td>
                          <td data-label={t("probability")}>
                            {isNotDue ? (
                              <span className="moduleHint">{t("probNA")}</span>
                            ) : (
                              <span className={`moduleCollectorProbability moduleCollectorProbability${String(row.probability_label || "").toUpperCase()}`}>{formatProbabilityLabel(row.probability_label, t)}</span>
                            )}
                          </td>
                          <td data-label={t("lastOutcome")}>{formatOutcomeLabel(row?.latest_collection?.visit_outcome || row?.latest_collection?.payment_status, t)}</td>
                          <td data-label={t("lastUpdate")}>{formatLastUpdateText(row, t)}</td>
                          <td data-label={t("actions")} className="moduleCollectorCellActions">
                            <div className="moduleInlineStack moduleActionStack">
                              <button
                                type="button"
                                className="moduleInlineButton moduleActionButton"
                                onClick={() => {
                                  setActiveRowKey(isOpen ? "" : key);
                                }}
                              >
                                {isOpen ? t("close") : t("open")}
                              </button>
                              {canViewVisitReports && row?.latest_collection?.saved_at ? (
                                <button
                                  type="button"
                                  className="moduleInlineButton moduleActionButton"
                                  onClick={() => openVisitReport(row)}
                                >
                                  {t("viewVisitReport")}
                                </button>
                              ) : null}
                              <Link href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`} className="moduleInlineButton moduleActionButton">
                                {t("customerDetails")}
                              </Link>
                            </div>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr id={`collector-detail-${key}`} className="moduleCollectorDetailRow">
                            <td colSpan={17}>
                              <div className="moduleTableWrap moduleCollectorSubTableWrap" style={{ marginBottom: "10px" }}>
                                <table className="moduleTable">
                                  <thead>
                                    <tr>
                                      <th>{t("bucketSummary")}</th>
                                      <th>{t("amount")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td>{t("cashBucket")}</td>
                                      <td>{formatMoney(row.outstanding_cash)}</td>
                                    </tr>
                                    <tr>
                                      <td>0-30</td>
                                      <td>{formatMoney(row.outstanding_0_30)}</td>
                                    </tr>
                                    <tr>
                                      <td>31-60</td>
                                      <td>{formatMoney(row.outstanding_30_60)}</td>
                                    </tr>
                                    <tr>
                                      <td>61-90</td>
                                      <td>{formatMoney(row.outstanding_61_90)}</td>
                                    </tr>
                                    <tr>
                                      <td>91-120</td>
                                      <td>{formatMoney(row.outstanding_91_120)}</td>
                                    </tr>
                                    <tr>
                                      <td>{">120"}</td>
                                      <td>{formatMoney(row.outstanding_above_120)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              <div className="moduleTableWrap moduleCollectorSubTableWrap" style={{ marginBottom: "12px" }}>
                                <table className="moduleTable moduleCollectorInvoiceTable">
                                  <thead>
                                    <tr>
                                      <th>{t("invDate")}</th>
                                      <th>{t("invRef")}</th>
                                      <th>{t("invPending")}</th>
                                      <th>{t("invDue")}</th>
                                      <th>{t("invOverdue")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(row.invoices || []).map((invoice, index) => (
                                      <tr
                                        key={`${key}-${invoice.ref_no || invoice.invoice_date || index}-${index}`}
                                        className={resolveOverdueDaysFromDueDate(invoice) > 0 ? "moduleCollectorInvoiceOverdue" : (isNotDue ? "moduleCollectorInvoiceNotDue" : "")}
                                      >
                                        <td data-label={t("invDate")}>{invoice.invoice_date || "-"}</td>
                                        <td data-label={t("invRef")}>{invoice.ref_no || "-"}</td>
                                        <td data-label={t("invPending")}>{formatMoney(invoice.pending_amount)}</td>
                                        <td data-label={t("invDue")}>{invoice.due_date || "-"}</td>
                                        <td data-label={t("invOverdue")}>{resolveInvoiceAgingDays(invoice)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="moduleSection" style={{ marginTop: "8px" }}>
                                <div className="moduleSectionHeader">
                                  <h2>{row.customer_name}</h2>
                                  <span>{t("visitForm")}</span>
                                </div>

                                <div className="moduleMetricGrid" style={{ marginBottom: "10px" }}>
                                  <section className="moduleMetricCard"><span>{isNotDue ? t("notDueAmount") : t("amount")}</span><strong>{formatMoney(isNotDue ? row.total_not_due_amount : row.total_due_amount)}</strong></section>
                                  <section className="moduleMetricCard"><span>{isNotDue ? t("notDueInvoices") : t("invoices")}</span><strong>{isNotDue ? row.not_due_invoice_count || 0 : row.due_invoice_count || 0}</strong></section>
                                  <section className="moduleMetricCard"><span>{t("probability")}</span><strong>{isNotDue ? "N/A" : row.probability_label}</strong></section>
                                </div>

                                <div className="moduleFilterRow moduleCollectorFormGrid">
                                  <label>
                                    {t("visitOutcome")}
                                    <select
                                      className="moduleInput"
                                      value={form.visitOutcome}
                                      onChange={(event) => {
                                        const nextOutcome = event.target.value;
                                        setForm((current) => ({
                                          ...current,
                                          visitOutcome: nextOutcome,
                                          receiptMode: nextOutcome === "FUNDS_RECEIVED" && !current.receiptMode ? "CASH" : current.receiptMode,
                                        }));
                                      }}
                                    >
                                      <option value="FUNDS_RECEIVED">{t("fundsReceived")}</option>
                                      <option value="ASKED_COME_LATER">{t("askedComeLater")}</option>
                                      <option value="RESPONSIBLE_NOT_AVAILABLE">{t("responsibleAbsent")}</option>
                                      <option value="WRONG_CREDIT_DAYS">{t("wrongCreditDays")}</option>
                                      <option value="NO_DUE_AS_PER_CUSTOMER">{t("noDueAsPerCustomer")}</option>
                                      <option value="TRANSFER_TO_LEGAL">{t("outcomeTransferLegal")}</option>
                                    </select>
                                  </label>
                                  <label>
                                    {t("amountReceived")}
                                    <input className="moduleInput" type="number" min="0" step="0.01" value={form.amountReceived} onChange={(event) => setForm((current) => ({ ...current, amountReceived: event.target.value }))} disabled={form.visitOutcome !== "FUNDS_RECEIVED"} />
                                  </label>
                                  <label>
                                    {t("modeOfReceipt")}
                                    <select className="moduleInput" value={form.receiptMode} onChange={(event) => setForm((current) => ({ ...current, receiptMode: event.target.value }))} disabled={form.visitOutcome !== "FUNDS_RECEIVED"}>
                                      <option value="CASH">{t("cash")}</option>
                                      <option value="CHEQUE">{t("cheque")}</option>
                                      <option value="BANK_TRANSFER">{t("bankTransfer")}</option>
                                      <option value="ATM_MACHINE">{t("atmMachine")}</option>
                                    </select>
                                  </label>
                                  <label>
                                    {t("nextVisit")}
                                    <input className="moduleInput" type="date" value={form.nextVisitAt} onChange={(event) => setForm((current) => ({ ...current, nextVisitAt: event.target.value }))} />
                                  </label>
                                  <label className="moduleFieldFull">
                                    {t("remarkArabic")}
                                    <textarea className="moduleTextArea" rows={3} value={form.remarkArabic} onChange={(event) => setForm((current) => ({ ...current, remarkArabic: event.target.value }))} />
                                  </label>
                                  <div className="moduleInlineStack" style={{ marginTop: "4px", marginBottom: "4px" }}>
                                    <button type="button" className="moduleInlineButton moduleActionButton" onClick={startDictation}>{isDictating ? `${t("dictation")}...` : t("dictation")}</button>
                                    {isTranslating ? <span className="moduleHint">{t("translating")}</span> : null}
                                  </div>
                                  <label className="moduleFieldFull">
                                    {t("remarkEnglish")}
                                    <textarea className="moduleTextArea" rows={3} value={form.remarkEnglish} onChange={(event) => setForm((current) => ({ ...current, remarkEnglish: event.target.value }))} />
                                  </label>
                                  <label>
                                    {t("paymentCopy")}
                                    <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "6px" }}>
                                      <label className="moduleInlineButton moduleActionButton">
                                        {t("capturePhoto")}
                                        <input
                                          hidden
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          onChange={(event) => setForm((current) => ({ ...current, paymentCopy: event.target.files?.[0] || null }))}
                                        />
                                      </label>
                                      <label className="moduleInlineButton moduleActionButton">
                                        {t("chooseFile")}
                                        <input
                                          hidden
                                          type="file"
                                          accept="image/*,application/pdf"
                                          onChange={(event) => setForm((current) => ({ ...current, paymentCopy: event.target.files?.[0] || null }))}
                                        />
                                      </label>
                                    </div>
                                  </label>
                                  <label>
                                    {t("receiptCopy")}
                                    <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "6px" }}>
                                      <label className="moduleInlineButton moduleActionButton">
                                        {t("capturePhoto")}
                                        <input
                                          hidden
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          required={form.visitOutcome === "FUNDS_RECEIVED"}
                                          onChange={(event) => setForm((current) => ({ ...current, receiptCopy: event.target.files?.[0] || null }))}
                                        />
                                      </label>
                                      <label className="moduleInlineButton moduleActionButton">
                                        {t("chooseFile")}
                                        <input
                                          hidden
                                          type="file"
                                          accept="image/*,application/pdf"
                                          onChange={(event) => setForm((current) => ({ ...current, receiptCopy: event.target.files?.[0] || null }))}
                                        />
                                      </label>
                                    </div>
                                  </label>
                                </div>

                                <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "12px" }}>
                                  <button type="button" className="modulePrimaryButton" onClick={() => saveVisit(row)} disabled={savingCustomerCode === row.customer_code}>
                                    {savingCustomerCode === row.customer_code ? t("saving") : t("saveVisit")}
                                  </button>
                                  {view === "legal" || row.legal_transfer?.is_transferred ? (
                                    <button type="button" className="moduleInlineButton moduleActionButton" onClick={() => toggleLegal(row, "remove")} disabled={legalBusyCode === row.customer_code}>{t("removeLegal")}</button>
                                  ) : (
                                    <button type="button" className="moduleInlineButton moduleActionButton" onClick={() => saveVisit(row, { transferToLegal: true })} disabled={savingCustomerCode === row.customer_code || legalBusyCode === row.customer_code}>{t("transferLegal")}</button>
                                  )}
                                </div>

                                <label className="moduleFieldFull" style={{ marginTop: "12px", display: "block" }}>
                                  {t("legalNote")}
                                  <textarea className="moduleTextArea" rows={2} value={form.legalNote} onChange={(event) => setForm((current) => ({ ...current, legalNote: event.target.value }))} />
                                </label>

                                <label id="collector-whatsapp-summary" className="moduleFieldFull" style={{ marginTop: "12px", display: "block" }}>
                                  {t("summary")}
                                  {summaryForWhatsApp ? (
                                    <>
                                      <div className="moduleHint" style={{ marginTop: "6px", color: "#166534" }}>
                                        {receiptFileForWhatsapp ? t("whatsappShareReceiptHint") : t("whatsappShareHint")}
                                      </div>
                                      <textarea className="moduleTextArea" rows={8} value={summaryForWhatsApp} readOnly />
                                    </>
                                  ) : (
                                    <div className="moduleHint" style={{ marginTop: "6px" }}>{t("summaryAfterSave")}</div>
                                  )}
                                </label>
                                {summaryForWhatsApp ? (
                                  <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "8px" }}>
                                    {receiptFileForWhatsapp ? (
                                      <button
                                        type="button"
                                        className="modulePrimaryButton"
                                        onClick={() => shareSummaryWithReceiptOnWhatsapp()}
                                      >
                                        {t("shareWhatsappWithReceipt")}
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className={receiptFileForWhatsapp ? "moduleInlineButton moduleActionButton" : "modulePrimaryButton"}
                                      onClick={() => shareSummaryOnWhatsapp()}
                                    >
                                      {t("shareWhatsapp")}
                                    </button>
                                    <button type="button" className="moduleInlineButton moduleActionButton" onClick={copySummaryText}>{t("copySummary")}</button>
                                    {copyStatus ? <span className="moduleHint">{copyStatus}</span> : null}
                                  </div>
                                ) : null}

                                <div className="moduleSectionHeader" style={{ marginTop: "14px" }}>
                                  <h2>{t("latestVisit")}</h2>
                                </div>
                                {Array.isArray(row.collection_history) && row.collection_history.length > 0 ? (
                                  <div className="moduleHint">
                                    <strong>{t("lastThreeVisits")}</strong>
                                    {row.collection_history.map((visit, index) => (
                                      <div key={`${row.customer_code || key}-visit-${visit.saved_at || index}`} style={{ marginTop: index === 0 ? "8px" : "4px" }}>
                                        {formatVisitHistoryItem(visit, t)}
                                      </div>
                                    ))}
                                    {row.latest_collection?.payment_copy_url ? <div><a href={row.latest_collection.payment_copy_url} target="_blank" rel="noreferrer">{t("viewPaymentCopy")}</a></div> : null}
                                    {row.latest_collection?.receipt_copy_url ? <div><a href={row.latest_collection.receipt_copy_url} target="_blank" rel="noreferrer">{t("viewReceiptCopy")}</a></div> : null}
                                  </div>
                                ) : row.latest_collection ? (
                                  <div className="moduleHint">
                                    {formatVisitHistoryItem(row.latest_collection, t)}
                                    {row.latest_collection.payment_copy_url ? <div><a href={row.latest_collection.payment_copy_url} target="_blank" rel="noreferrer">{t("viewPaymentCopy")}</a></div> : null}
                                    {row.latest_collection.receipt_copy_url ? <div><a href={row.latest_collection.receipt_copy_url} target="_blank" rel="noreferrer">{t("viewReceiptCopy")}</a></div> : null}
                                  </div>
                                ) : <div className="moduleHint">{t("noLatestVisit")}</div>}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!loading && visibleRows.length === 0 && visibleNotDueRows.length === 0 && (
              <div className="moduleHint">{view === "legal" ? t("noLegal") : t("noDue")}</div>
            )}
            {!loading && view === "due" && visibleRows.length === 0 && visibleNotDueRows.length > 0 && (
              <div className="moduleHint">{t("noDue")}</div>
            )}
          </section>

          {loading && <div className="moduleLoading">{t("loading")}</div>}
        </div>

        {visitReportRow ? (
          <div className="moduleModalOverlay" dir={dir}>
            <div className="moduleModal" role="dialog" aria-modal="true">
              <h2>{t("visitReportTitle")}</h2>
              <p className="moduleHint">
                {visitReportRow.customer_name || visitReportRow.customer_code}
                {" · "}
                {visitReportRow.customer_code}
              </p>
              {visitReportLoading ? (
                <div className="moduleHint">{t("translating")}</div>
              ) : (
                <>
                  {Array.isArray(visitReportRow.collection_history) && visitReportRow.collection_history.length > 1 ? (
                    <p className="moduleHint">{t("lastThreeVisits")}</p>
                  ) : null}
                  <textarea className="moduleTextArea" rows={22} value={visitReportText} readOnly />
                </>
              )}
              <div className="moduleOrderActions">
                <button
                  type="button"
                  className="modulePrimaryButton"
                  onClick={async () => {
                    const copied = await copyTextToClipboard(visitReportText);
                    if (copied) {
                      setCopyStatus(t("copied"));
                      setTimeout(() => setCopyStatus(""), 1200);
                    }
                  }}
                  disabled={!visitReportText}
                >
                  {t("copySummary")}
                </button>
                <button
                  type="button"
                  className="moduleSecondaryButton"
                  onClick={() => {
                    setVisitReportRow(null);
                    setVisitReportText("");
                  }}
                >
                  {t("close")}
                </button>
              </div>
              {copyStatus ? <div className="moduleHint">{copyStatus}</div> : null}
            </div>
          </div>
        ) : null}
      </main>
    </MorningAttendanceGate>
  );
}