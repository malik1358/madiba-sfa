"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "Payment Collections", ar: "التحصيلات" },
  subtitle: { en: "Due-customer collection queue and visit tracking", ar: "قائمة التحصيل للعملاء المستحقين وتتبع الزيارات" },
  dashboard: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading collection queue...", ar: "جاري تحميل قائمة التحصيل..." },
  dueQueue: { en: "Due Collection Queue", ar: "قائمة التحصيل المستحق" },
  legalQueue: { en: "Legal Queue", ar: "قائمة القسم القانوني" },
  customerCode: { en: "Code", ar: "الكود" },
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
  copySummary: { en: "Copy Summary", ar: "نسخ الملخص" },
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
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  translating: { en: "Translating...", ar: "جاري الترجمة..." },
  msgLoginAgain: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  msgSelectOutcome: { en: "Please select visit outcome.", ar: "يرجى اختيار نتيجة الزيارة." },
  msgAmountRequired: { en: "Amount received is required for funds received outcome.", ar: "المبلغ المستلم مطلوب عند اختيار تم استلام مبلغ." },
  msgModeRequired: { en: "Mode of receipt is required for funds received outcome.", ar: "طريقة الاستلام مطلوبة عند اختيار تم استلام مبلغ." },
  msgReceiptRequired: { en: "Receipt copy is compulsory when funds are received.", ar: "صورة الإيصال إلزامية عند استلام مبلغ." },
  msgNextVisitRequired: { en: "Next visit date is required when full overdue is not received.", ar: "تاريخ الزيارة القادمة مطلوب عند عدم استلام كامل المبلغ المستحق." },
  msgSaveFailed: { en: "Unable to save collection visit.", ar: "تعذر حفظ زيارة التحصيل." },
  msgVisitSaved: { en: "Visit saved successfully.", ar: "تم حفظ الزيارة بنجاح." },
  msgWhatsappNotSent: { en: "WhatsApp not sent", ar: "لم يتم إرسال واتساب" },
  msgSpeechUnsupported: { en: "Speech dictation is not supported in this browser.", ar: "الإملاء الصوتي غير مدعوم في هذا المتصفح." },
  msgSupabaseMissing: { en: "Supabase is not configured.", ar: "Supabase غير مُعد." },
  msgLegalRemoved: { en: "removed from legal queue.", ar: "تمت إزالته من قائمة القانوني." },
  msgLegalTransferred: { en: "transferred to legal queue.", ar: "تم تحويله إلى قائمة القانوني." },
  msgLegalUpdateFailed: { en: "Unable to update legal transfer status.", ar: "تعذر تحديث حالة التحويل للقانوني." },
  msgCopyFailed: { en: "Could not copy WhatsApp message automatically.", ar: "تعذر نسخ رسالة واتساب تلقائياً." },
};

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

function determinePaymentStatus(visitOutcome, amountReceived, totalDueAmount) {
  if (visitOutcome === "FUNDS_RECEIVED") {
    return Number(amountReceived || 0) >= Number(totalDueAmount || 0) ? "PAID" : "PARTIAL";
  }
  if (visitOutcome === "ASKED_COME_LATER") return "PROMISED";
  return "NOT_PAID";
}

function outcomeReasonText(outcome) {
  if (outcome === "RESPONSIBLE_NOT_AVAILABLE") return "Responsible not available";
  if (outcome === "WRONG_CREDIT_DAYS") return "Wrong credit days";
  if (outcome === "NO_DUE_AS_PER_CUSTOMER") return "No due according to customer";
  if (outcome === "TRANSFER_TO_LEGAL") return "Transferred to legal";
  return "";
}

function buildVisitSummary(row, form, translatedRemark) {
  const amount = Number(form.amountReceived || 0);
  const nextVisit = formatDateOnly(form.nextVisitAt);
  const outcomeText = String(form.visitOutcome || "").replace(/_/g, " ").toLowerCase();
  const arabicRemark = String(form.remarkArabic || "").trim();
  const englishRemark = String(translatedRemark || form.remarkEnglish || "").trim();
  const lines = [
    `Customer: ${row.customer_name || row.customer_code}`,
    `Code: ${row.customer_code || "-"}`,
    `Salesman: ${row.salesman_name || row.salesman_code || "-"}`,
    `Outcome: ${outcomeText || "not specified"}`,
  ];

  if (amount > 0) lines.push(`Amount received: ${formatMoney(amount)}.`);
  if (form.receiptMode) lines.push(`Receipt mode: ${form.receiptMode}.`);
  if (arabicRemark) lines.push(`Remark (Arabic): ${arabicRemark}.`);
  if (englishRemark) lines.push(`Remark (English): ${englishRemark}.`);
  if (nextVisit) lines.push(`Next visit: ${nextVisit}.`);
  lines.push("Outstanding:");
  lines.push(`0-30: ${formatMoney(row.outstanding_0_30)}`);
  lines.push(`31-60: ${formatMoney(row.outstanding_30_60)}`);
  lines.push(`61-90: ${formatMoney(row.outstanding_61_90)}`);
  lines.push(`91-120: ${formatMoney(row.outstanding_91_120)}`);
  lines.push(`>120: ${formatMoney(row.outstanding_above_120)}`);
  return lines.join("\n");
}

function formatLastUpdateText(row) {
  const savedAt = row?.latest_collection?.saved_at ? new Date(row.latest_collection.saved_at).toLocaleString("en-GB") : "-";
  const amount = Number(row?.latest_collection?.amount_received || 0);
  const amountText = amount > 0 ? formatMoney(amount) : "0";
  return `${savedAt} | Amount: ${amountText}`;
}

function formatVisitHistoryItem(visit) {
  const savedAt = visit?.saved_at ? formatDateOnly(visit.saved_at) : "-";
  const outcome = visit?.visit_outcome || visit?.payment_status || "-";
  const amount = Number(visit?.amount_received || 0);
  return `${savedAt} | ${outcome} | Amount: ${formatMoney(amount)}`;
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
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
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
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dueCustomers, setDueCustomers] = useState([]);
  const [legalCustomers, setLegalCustomers] = useState([]);
  const [form, setForm] = useState(buildInitialForm(null));
  const [savingCustomerCode, setSavingCustomerCode] = useState("");
  const [legalBusyCode, setLegalBusyCode] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [salesmanFilter, setSalesmanFilter] = useState("");
  const [activeRowKey, setActiveRowKey] = useState("");
  const [summaryForWhatsApp, setSummaryForWhatsApp] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef(null);

  const showPopup = (message) => {
    if (typeof window !== "undefined" && message) window.alert(message);
  };

  const localizeApiMessage = (message) => {
    const text = String(message || "").trim();
    if (!text) return "";
    if (text.includes("Please login again")) return t("msgLoginAgain");
    if (text.includes("Please select visit outcome")) return t("msgSelectOutcome");
    if (text.includes("Amount received is required")) return t("msgAmountRequired");
    if (text.includes("Mode of receipt is required")) return t("msgModeRequired");
    if (text.includes("Receipt copy is compulsory")) return t("msgReceiptRequired");
    if (text.includes("Next visit date is required") || text.includes("Next visit is required")) return t("msgNextVisitRequired");
    if (text.includes("Unable to save collection visit")) return t("msgSaveFailed");
    if (text.includes("Unable to update legal transfer status")) return t("msgLegalUpdateFailed");
    return text;
  };

  const rowKey = (row) => String(row?.queue_key || row?.customer_code || row?.customer_name || "").trim();

  const supabaseClient = getSupabaseClient();
  const activeRow = useMemo(() => {
    return [...dueCustomers, ...legalCustomers].find((row) => rowKey(row) === activeRowKey) || null;
  }, [activeRowKey, dueCustomers, legalCustomers]);

  useEffect(() => {
    if (activeRow) {
      setForm(buildInitialForm(activeRow));
      setSummaryForWhatsApp("");
    }
  }, [activeRow]);

  async function loadQueue(preferredKey = "") {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      showPopup(t("msgSupabaseMissing"));
      return { dueCustomers: [], legalCustomers: [] };
    }

    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error(t("msgLoginAgain"));

      const response = await fetch("/api/payment-collections", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(localizeApiMessage(payload.error || "Unable to load payment collection queue."));
      }

      const due = Array.isArray(payload.dueCustomers) ? payload.dueCustomers : [];
      const legal = Array.isArray(payload.legalCustomers) ? payload.legalCustomers : [];
      setDueCustomers(due);
      setLegalCustomers(legal);

      const allRows = [...due, ...legal];
      if (preferredKey) {
        const preferred = allRows.find((row) => rowKey(row) === preferredKey);
        setActiveRowKey(preferred ? preferredKey : rowKey(allRows[0] || {}));
      }

      return { dueCustomers: due, legalCustomers: legal };
    } catch (err) {
      showPopup(localizeApiMessage(err.message || "Unable to load payment collection queue."));
      return { dueCustomers: [], legalCustomers: [] };
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  const visibleRows = useMemo(() => {
    const rows = view === "legal" ? legalCustomers : dueCustomers;
    const customerQuery = String(customerFilter || "").trim().toLowerCase();
    const salesmanQuery = String(salesmanFilter || "").trim().toLowerCase();
    return rows.filter((row) => {
      const customerMatch = !customerQuery || [row.customer_code, row.customer_name]
        .some((value) => String(value || "").toLowerCase().includes(customerQuery));
      const salesmanMatch = !salesmanQuery || [row.salesman_name, row.salesman_code]
        .some((value) => String(value || "").toLowerCase().includes(salesmanQuery));
      return customerMatch && salesmanMatch;
    });
  }, [dueCustomers, legalCustomers, customerFilter, salesmanFilter, view]);

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
          setForm((current) => ({ ...current, remarkEnglish: String(payload.translatedText) }));
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

  async function saveVisit(row, options = {}) {
    const transferToLegal = Boolean(options.transferToLegal);
    const supabase = getSupabaseClient();
    if (!supabase) {
      showPopup(t("msgSupabaseMissing"));
      return;
    }

    setSavingCustomerCode(row.customer_code);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

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
      if (paymentStatus !== "PAID" && !form.nextVisitAt) {
        throw new Error(t("msgNextVisitRequired"));
      }

      const outcomeReason = selectedOutcome === "RESPONSIBLE_NOT_AVAILABLE"
        ? "Responsible not available"
        : selectedOutcome === "WRONG_CREDIT_DAYS"
          ? "Wrong credit days"
          : selectedOutcome === "NO_DUE_AS_PER_CUSTOMER"
            ? "No due according to customer"
        : selectedOutcome === "TRANSFER_TO_LEGAL"
          ? "Transferred to legal"
          : "";
      const effectiveEnglishRemark = form.remarkEnglish || (form.remarkArabic ? form.remarkArabic : "");
      const summaryText = buildVisitSummary(row, { ...form, visitOutcome: selectedOutcome }, effectiveEnglishRemark);

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
      if (form.paymentCopy) formData.append("paymentCopy", form.paymentCopy);
      if (form.receiptCopy) formData.append("receiptCopy", form.receiptCopy);

      const response = await fetch("/api/payment-collections", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save collection visit.");
      }

      if (selectedOutcome === "TRANSFER_TO_LEGAL") {
        const legalResponse = await fetch("/api/payment-collections", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customerCode: row.customer_code,
            customerName: row.customer_name,
            note: form.legalNote || "Transferred during visit report",
            action: "transfer",
          }),
        });

        const legalPayload = await legalResponse.json().catch(() => ({}));
        if (!legalResponse.ok || !legalPayload.success) {
          throw new Error(legalPayload.error || "Visit saved, but legal transfer failed.");
        }
      }

      const popupMessage = payload?.whatsapp?.error
        ? `${t("msgVisitSaved")} ${t("msgWhatsappNotSent")}: ${payload.whatsapp.error}`
        : t("msgVisitSaved");
      const copied = await copyTextToClipboard(summaryText);
      showPopup(popupMessage);
      setSummaryForWhatsApp(summaryText);
      if (copied) {
        setCopyStatus(t("copied"));
        setTimeout(() => setCopyStatus(""), 1200);
      } else {
        showPopup(t("msgCopyFailed"));
      }
      await loadQueue(rowKey(row));
    } catch (err) {
      showPopup(localizeApiMessage(err.message || t("msgSaveFailed")));
    } finally {
      setSavingCustomerCode("");
    }
  }

  function startDictation() {
    if (typeof window === "undefined") return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showPopup(t("msgSpeechUnsupported"));
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
    const summaryText = String(summaryForWhatsApp || (activeRow ? buildVisitSummary(activeRow, form, form.remarkEnglish) : "") || "").trim();
    if (!summaryText) return;
    try {
      const copied = await copyTextToClipboard(summaryText);
      if (!copied) throw new Error("copy-failed");
      setCopyStatus(t("copied"));
      setTimeout(() => setCopyStatus(""), 1200);
    } catch {
      setCopyStatus("");
      showPopup(t("msgCopyFailed"));
    }
  }

  async function toggleLegal(row, action) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      showPopup(t("msgSupabaseMissing"));
      return;
    }

    setLegalBusyCode(row.customer_code);
    setError("");
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error(t("msgLoginAgain"));

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
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to update legal transfer status.");
      }

      showPopup(action === "remove"
        ? `${row.customer_name} ${t("msgLegalRemoved")}`
        : `${row.customer_name} ${t("msgLegalTransferred")}`);
      await loadQueue(rowKey(row));
      if (action !== "remove" && view !== "legal") {
        setActiveRowKey("");
      }
    } catch (err) {
      showPopup(localizeApiMessage(err.message || t("msgLegalUpdateFailed")));
    } finally {
      setLegalBusyCode("");
    }
  }

  return (
    <MorningAttendanceGate>
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

          <div className="moduleInlineStack" style={{ marginBottom: "12px" }}>
            <Link href="/management/payment-collections" className={`moduleInlineButton moduleActionButton${view === "due" ? " moduleCollectorTabActive" : ""}`}>{t("dueQueue")}</Link>
            <Link href="/management/payment-collections/legal" className={`moduleInlineButton moduleActionButton${view === "legal" ? " moduleCollectorTabActive" : ""}`}>{t("legalQueue")}</Link>
          </div>

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
                placeholder={language === "ar" ? t("customerFilter") : "Filter customer name/code"}
              />
              <input
                className="moduleInput"
                value={salesmanFilter}
                onChange={(event) => setSalesmanFilter(event.target.value)}
                placeholder={language === "ar" ? t("salesmanFilter") : "Filter salesman name/code"}
              />
            </div>

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
                  {visibleRows.map((row) => {
                    const key = rowKey(row);
                    const isOpen = activeRowKey === key;
                    return (
                      <Fragment key={key}>
                        <tr key={key}>
                          <td data-label={t("customerCode")}>{row.customer_code || "-"}</td>
                          <td data-label={t("customer")} className="moduleCollectorCellPrimary">{row.customer_name || row.customer_code}</td>
                          <td data-label={t("salesman")}>{row.salesman_name || row.salesman_code || "-"}</td>
                          <td data-label={t("cityArea")}>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                          <td data-label={t("amount")} className="moduleCollectorCellPrimary">{formatMoney(row.total_due_amount)}</td>
                          <td data-label={t("cashBucket")}>{formatMoney(row.outstanding_cash)}</td>
                          <td data-label={t("bucket30")}>{formatMoney(row.outstanding_0_30)}</td>
                          <td data-label={t("bucket31to60")}>{formatMoney(row.outstanding_30_60)}</td>
                          <td data-label={t("bucket61to90")}>{formatMoney(row.outstanding_61_90)}</td>
                          <td data-label={t("bucket91to120")}>{formatMoney(row.outstanding_91_120)}</td>
                          <td data-label={t("bucket120plus")}>{formatMoney(row.outstanding_above_120)}</td>
                          <td data-label={t("overdue")}>{row.max_overdue_days || 0}</td>
                          <td data-label={t("invoices")}>{row.due_invoice_count || 0}</td>
                          <td data-label={t("probability")}>
                            <span className={`moduleCollectorProbability moduleCollectorProbability${String(row.probability_label || "").toUpperCase()}`}>{row.probability_label}</span>
                          </td>
                          <td data-label={t("lastOutcome")}>{row?.latest_collection?.visit_outcome || row?.latest_collection?.payment_status || "-"}</td>
                          <td data-label={t("lastUpdate")}>{formatLastUpdateText(row)}</td>
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
                              <Link href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`} className="moduleInlineButton moduleActionButton">
                                {t("customerDetails")}
                              </Link>
                            </div>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="moduleCollectorDetailRow">
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
                                      <th>Date</th>
                                      <th>Ref</th>
                                      <th>Pending</th>
                                      <th>Due</th>
                                      <th>Overdue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(row.invoices || []).map((invoice, index) => (
                                      <tr
                                        key={`${key}-${invoice.ref_no || invoice.invoice_date || index}-${index}`}
                                        className={Number(invoice.overdue_days || 0) > 0 ? "moduleCollectorInvoiceOverdue" : ""}
                                      >
                                        <td>{invoice.invoice_date || "-"}</td>
                                        <td>{invoice.ref_no || "-"}</td>
                                        <td>{formatMoney(invoice.pending_amount)}</td>
                                        <td>{invoice.due_date || "-"}</td>
                                        <td>{invoice.overdue_days || 0}</td>
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
                                  <section className="moduleMetricCard"><span>{t("amount")}</span><strong>{formatMoney(row.total_due_amount)}</strong></section>
                                  <section className="moduleMetricCard"><span>{t("invoices")}</span><strong>{row.due_invoice_count || 0}</strong></section>
                                  <section className="moduleMetricCard"><span>{t("probability")}</span><strong>{row.probability_label}</strong></section>
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

                                <label className="moduleFieldFull" style={{ marginTop: "12px", display: "block" }}>
                                  {t("summary")}
                                  <textarea className="moduleTextArea" rows={7} value={summaryForWhatsApp || buildVisitSummary(row, form, form.remarkEnglish)} readOnly />
                                </label>
                                <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "8px" }}>
                                  <button type="button" className="moduleInlineButton moduleActionButton" onClick={copySummaryText}>{t("copySummary")}</button>
                                  {copyStatus ? <span className="moduleHint">{copyStatus}</span> : null}
                                </div>

                                <div className="moduleSectionHeader" style={{ marginTop: "14px" }}>
                                  <h2>{t("latestVisit")}</h2>
                                </div>
                                {Array.isArray(row.collection_history) && row.collection_history.length > 0 ? (
                                  <div className="moduleHint">
                                    <strong>{t("lastThreeVisits")}</strong>
                                    {row.collection_history.map((visit, index) => (
                                      <div key={`${row.customer_code || key}-visit-${visit.saved_at || index}`} style={{ marginTop: index === 0 ? "8px" : "4px" }}>
                                        {formatVisitHistoryItem(visit)}
                                      </div>
                                    ))}
                                    {row.latest_collection?.payment_copy_url ? <div><a href={row.latest_collection.payment_copy_url} target="_blank" rel="noreferrer">Payment Copy</a></div> : null}
                                    {row.latest_collection?.receipt_copy_url ? <div><a href={row.latest_collection.receipt_copy_url} target="_blank" rel="noreferrer">Receipt Copy</a></div> : null}
                                  </div>
                                ) : row.latest_collection ? (
                                  <div className="moduleHint">
                                    {formatVisitHistoryItem(row.latest_collection)}
                                    {row.latest_collection.payment_copy_url ? <div><a href={row.latest_collection.payment_copy_url} target="_blank" rel="noreferrer">Payment Copy</a></div> : null}
                                    {row.latest_collection.receipt_copy_url ? <div><a href={row.latest_collection.receipt_copy_url} target="_blank" rel="noreferrer">Receipt Copy</a></div> : null}
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

            {visibleRows.length === 0 && <div className="moduleHint">{view === "legal" ? t("noLegal") : t("noDue")}</div>}
          </section>

          {loading && <div className="moduleLoading">{t("loading")}</div>}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}