"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { detectTable } from "../../lib/schemaGuards";
import { isVisitStatusCustomer } from "./customerEligibility";
import { filterAndRankVisitCustomers, splitVisitCustomersByOutstanding } from "./visitPriority";

const PAGE_TEXT = {
  title: { en: "My Day", ar: "يومي" },
  subtitle: { en: "Daily planning and visit execution", ar: "تخطيط اليوم وتنفيذ الزيارات" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading daily planner...", ar: "جاري تحميل خطة اليوم..." },
  attendance: { en: "Attendance", ar: "الحضور" },
  morningAttendance: { en: "Morning Attendance", ar: "حضور الصباح" },
  lunchBreakOut: { en: "Lunch Break Out", ar: "خروج استراحة الغداء" },
  lunchBreakIn: { en: "Lunch Break In", ar: "العودة من استراحة الغداء" },
  endOfDay: { en: "End of Day", ar: "نهاية اليوم" },
  saveNote: { en: "Save Note", ar: "حفظ الملاحظة" },
  addPlannerNote: { en: "Add planner note", ar: "أضف ملاحظة لليوم" },
  noLogs: { en: "No activity logs for today.", ar: "لا توجد سجلات نشاط اليوم." },
  routeSummary: { en: "Route Summary", ar: "ملخص المسار" },
  visitSchedule: { en: "Visit Schedule", ar: "جدول الزيارات" },
  plannedVisitsCount: { en: "scheduled visits", ar: "زيارات مجدولة" },
  noPlannedVisits: { en: "No planned visits for now.", ar: "لا توجد زيارات مخططة حالياً." },
  calendarDate: { en: "Date", ar: "التاريخ" },
  calendarTime: { en: "Time", ar: "الوقت" },
  unscheduledVisits: { en: "Unscheduled visits", ar: "زيارات بدون موعد" },
  noRoutes: { en: "No routes", ar: "لا توجد مسارات" },
  customersCount: { en: "customers", ar: "عميل" },
  visitStatus: { en: "Visit Status", ar: "حالة الزيارات" },
  outstandingUnder60: { en: "Outstanding Under 60 Days", ar: "المبالغ المستحقة لأقل من 60 يوماً" },
  outstandingAbove60: { en: "Outstanding Above 60 Days", ar: "المبالغ المستحقة لأكثر من 60 يوماً" },
  outstanding0To30: { en: "0-30 Days", ar: "0-30 يوماً" },
  outstanding30To60: { en: "30-60 Days", ar: "30-60 يوماً" },
  outstandingAbove60Column: { en: ">60 Days", ar: ">60 يوماً" },
  searchCustomer: { en: "Search customer by name or code", ar: "ابحث عن العميل بالاسم أو الرمز" },
  recentValue: { en: "Recent 6M Value", ar: "قيمة آخر 6 أشهر" },
  customer: { en: "Customer", ar: "العميل" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  daysSinceLastInvoice: { en: "Days From Last Invoice", ar: "الأيام منذ آخر فاتورة" },
  daysSinceLastVisit: { en: "Days From Last Visit", ar: "الأيام منذ آخر زيارة" },
  status: { en: "Status", ar: "الحالة" },
  actions: { en: "Actions", ar: "الإجراءات" },
  openAudit: { en: "Open Audit", ar: "فتح التدقيق" },
  markInactive: { en: "Mark Inactive", ar: "تعطيل العميل" },
  markingInactive: { en: "Marking...", ar: "جاري التعطيل..." },
  inactiveSaved: { en: "Customer marked inactive and removed from visit status.", ar: "تم تعطيل العميل وإزالته من حالة الزيارات." },
  noCustomers: { en: "No customers available for route status.", ar: "لا يوجد عملاء متاحون لحالة المسار." },
  visitWithoutOrder: { en: "Visit Without Order", ar: "زيارة بدون طلب" },
  closeReport: { en: "Close", ar: "إغلاق" },
  visitReport: { en: "Visit Report", ar: "تقرير الزيارة" },
  visitOutcome: { en: "Visit Outcome", ar: "نتيجة الزيارة" },
  nextVisit: { en: "Next Visit Schedule", ar: "موعد الزيارة القادمة" },
  visitNotes: { en: "Visit Notes", ar: "ملاحظات الزيارة" },
  startDictation: { en: "Start Dictation", ar: "بدء الإملاء" },
  stopDictation: { en: "Stop Dictation", ar: "إيقاف الإملاء" },
  stockCheck: { en: "Stock Check", ar: "فحص المخزون" },
  itemName: { en: "Item name", ar: "اسم الصنف" },
  available: { en: "Available", ar: "متوفر" },
  notAvailable: { en: "Not Available", ar: "غير متوفر" },
  boughtItems: { en: "Bought Items", ar: "الأصناف المشتراة" },
  loadingItems: { en: "Loading bought items...", ar: "جاري تحميل الأصناف المشتراة..." },
  noBoughtItems: { en: "No bought items found for this customer.", ar: "لا توجد أصناف مشتراة لهذا العميل." },
  saveVisitReport: { en: "Save Visit Report", ar: "حفظ تقرير الزيارة" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  paymentFollowup: { en: "Payment follow-up", ar: "متابعة دفع" },
  comeBackLater: { en: "Asked to come back later", ar: "طلب العودة لاحقاً" },
  purchaseManagerUnavailable: { en: "Purchase manager not available", ar: "مدير المشتريات غير موجود" },
  stocksAvailable: { en: "Stocks available", ar: "المخزون متوفر" },
  orderTaken: { en: "Order taken", ar: "تم أخذ الطلب" },
  planned: { en: "Planned", ar: "مخطط" },
  visited: { en: "Visited", ar: "تمت الزيارة" },
  overdue: { en: "Overdue", ar: "متأخر" },
  visitsToday: { en: "Today's customer visits", ar: "زيارات العملاء اليوم" },
  followUps: { en: "Follow-ups", ar: "المتابعات" },
  pendingOrders: { en: "Pending orders", ar: "الطلبات المعلقة" },
  overdueVisits: { en: "Overdue visits", ar: "الزيارات المتأخرة" },
  newCustomers: { en: "New customers assigned", ar: "العملاء الجدد" },
  completedVisits: { en: "Completed visits", ar: "الزيارات المكتملة" },
};

function daysBetween(date) {
  if (!date) return 0;
  const normalized = typeof date === "string" && date.includes("T") ? date : `${date}T00:00:00`;
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - target.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function daysBetweenNullable(date) {
  if (!date) return null;
  const normalized = typeof date === "string" && date.includes("T") ? date : `${date}T00:00:00`;
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - target.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function getSortTimestamp(date) {
  if (!date) return 0;
  const normalized = typeof date === "string" && date.includes("T") ? date : `${date}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

function toDatetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getLogPreview(row) {
  if (!row?.note) return "";

  try {
    const parsed = JSON.parse(row.note);
    if (row.entry_type === "NOTE") {
      return String(parsed?.note || "").trim();
    }
    return "";
  } catch {
    return row.entry_type === "NOTE" ? String(row.note || "").trim() : "";
  }
}

async function fetchVisibleCustomers(token) {
  const response = await fetch("/api/customers/visible?includeRecentSales=1&includeOutstanding=1", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load visible customers.");
  }

  return payload.customers || [];
}

export default function MyDayPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, PAGE_TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [logsEnabled, setLogsEnabled] = useState(true);
  const [prospectsEnabled, setProspectsEnabled] = useState(true);
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState({
    visitsToday: 0,
    followUps: 0,
    pendingOrders: 0,
    overdueVisits: 0,
    newCustomersAssigned: 0,
    completedVisits: 0,
  });
  const [routeRows, setRouteRows] = useState([]);
  const [visitStatusRows, setVisitStatusRows] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [note, setNote] = useState("");
  const [attendanceBusy, setAttendanceBusy] = useState("");
  const [accessScope, setAccessScope] = useState(null);
  const [activeVisitCustomerCode, setActiveVisitCustomerCode] = useState("");
  const [visitSaving, setVisitSaving] = useState(false);
  const [visitItemsLoading, setVisitItemsLoading] = useState(false);
  const [inactiveCustomerCode, setInactiveCustomerCode] = useState("");
  const [visitStatusSearch, setVisitStatusSearch] = useState("");
  const [dictationSupported, setDictationSupported] = useState(false);
  const [dictationActive, setDictationActive] = useState(false);
  const speechRecognitionRef = useRef(null);
  const [visitForm, setVisitForm] = useState({
    outcome: "PAYMENT_FOLLOWUP",
    nextVisitAt: "",
    note: "",
    stockChecks: [],
  });

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setDictationSupported(Boolean(Recognition));
    return () => speechRecognitionRef.current?.stop?.();
  }, []);

  function readCapturedAt(log) {
    if (!log?.note) return 0;

    try {
      const parsed = JSON.parse(log.note);
      const capturedAt = parsed?.captured_at || log.created_at;
      const time = new Date(capturedAt).getTime();
      return Number.isFinite(time) ? time : 0;
    } catch {
      return 0;
    }
  }

  function isGpsLog(entryType) {
    return ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN", "END_OF_DAY", "NOTE", "GPS_PING"].includes(entryType);
  }

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setWarnings([]);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const scope = await fetchSalesScope();
        setAccessScope(scope);

        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id,salesman_code,salesman_name,role")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;
        setProfile(profileData);

        const [logsCheck, prospectsCheck] = await Promise.all([
          detectTable(supabase, "daily_activity_logs"),
          detectTable(supabase, "prospects"),
        ]);

        setLogsEnabled(logsCheck.available);
        setProspectsEnabled(prospectsCheck.available);

        const nextWarnings = [];
        if (!logsCheck.available) {
          nextWarnings.push("Daily activity logs table is unavailable. Check-in/check-out and notes are disabled. Visit reports are saved using backup storage.");
        }
        if (!prospectsCheck.available) {
          nextWarnings.push(`${prospectsCheck.reason}. New customers assigned metric is unavailable.`);
        }
        setWarnings(nextWarnings);

        let todaySalesQuery = supabase
          .from("active_sales")
          .select("customer_code,sales_amount")
          .eq("transaction_date", today);

        let pendingOrdersQuery = supabase
          .from("sales_orders")
          .select("id,status,created_by,salesman_code")
          .eq("status", "DRAFT");

        let submittedOrdersQuery = supabase
          .from("sales_orders")
          .select("id,status,created_by,salesman_code")
          .eq("status", "SUBMITTED")
          .gte("submitted_at", `${today}T00:00:00`)
          .lte("submitted_at", `${today}T23:59:59`);

        let todayOrdersQuery = supabase
          .from("sales_orders")
          .select("customer_code,created_by,salesman_code,created_at,submitted_at")
          .or(
            `and(created_at.gte.${today}T00:00:00,created_at.lte.${today}T23:59:59),and(submitted_at.gte.${today}T00:00:00,submitted_at.lte.${today}T23:59:59)`
          );

        let routeQuery = supabase
          .from("customers")
          .select("customer_code,customer_name,city,area,latest_transaction_date,is_active")
          .order("city")
          .limit(20);

        if (scope.hasAllAccess) {
          // no-op
        } else {
          todaySalesQuery = todaySalesQuery.in("salesman_code", scope.visibleSalesmanCodes);
          routeQuery = routeQuery.in("current_salesman_code", scope.visibleSalesmanCodes);
          todayOrdersQuery = todayOrdersQuery.in("salesman_code", scope.visibleSalesmanCodes);
        }

        const [
          todaySalesRes,
          pendingOrdersRes,
          submittedTodayRes,
          todayOrdersRes,
          customerRows,
          routeRes,
        ] = await Promise.all([
          todaySalesQuery,
          pendingOrdersQuery,
          submittedOrdersQuery,
          todayOrdersQuery,
          fetchVisibleCustomers(session.access_token),
          routeQuery,
        ]);

        if (todaySalesRes.error) throw todaySalesRes.error;
        if (pendingOrdersRes.error) throw pendingOrdersRes.error;
        if (submittedTodayRes.error) throw submittedTodayRes.error;
        if (todayOrdersRes.error) throw todayOrdersRes.error;
        if (routeRes.error) throw routeRes.error;

        let newProspectsCount = 0;
        if (prospectsCheck.available) {
          let prospectsQuery = supabase
            .from("prospects")
            .select("id")
            .gte("created_at", `${today}T00:00:00`);

          if (!scope.hasAllAccess) {
            prospectsQuery = prospectsQuery.in("salesman_code", scope.visibleSalesmanCodes);
          }

          const { data: newProspectsData, error: newProspectsError } = await prospectsQuery;

          if (!newProspectsError) {
            newProspectsCount = (newProspectsData || []).length;
          }
        }

        if (logsCheck.available) {
          let logsQuery = supabase
            .from("daily_activity_logs")
            .select("id,user_id,entry_type,note,created_at")
            .gte("created_at", `${today}T00:00:00`)

          if (!scope.hasAllAccess) {
            logsQuery = logsQuery.in("user_id", scope.visibleUserIds);
          }

          const { data: logsData, error: logsError } = await logsQuery;

          if (!logsError) {
            const rows = logsData || [];
            setTodayLogs(rows);

          } else {
            setTodayLogs([]);
          }
        } else {
          setTodayLogs([]);
        }

        const visibleTodayOrders = (todayOrdersRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return (
            scope.visibleUserIds.includes(row.created_by) ||
            scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase())
          );
        });

        const todayOrderCustomers = new Set(
          visibleTodayOrders
            .map((row) => String(row.customer_code || "").trim().toUpperCase())
            .filter(Boolean)
        );

        const todayCustomers = new Set(
          (todaySalesRes.data || [])
            .map((row) => String(row.customer_code || "").trim().toUpperCase())
            .filter(Boolean)
        );
        todayOrderCustomers.forEach((customerCode) => todayCustomers.add(customerCode));
        const productiveCustomers = new Set(
          (todaySalesRes.data || [])
            .filter((row) => Number(row.sales_amount || 0) > 0)
            .map((row) => String(row.customer_code || "").trim().toUpperCase())
            .filter(Boolean)
        );

        const latestVisitByCustomer = new Map();
        const nextVisitByCustomer = new Map();

        if (logsCheck.available) {
          let visitReportsQuery = supabase
            .from("daily_activity_logs")
            .select("user_id,note,created_at")
            .eq("entry_type", "VISIT_REPORT")
            .order("created_at", { ascending: false })
            .limit(5000);

          if (!scope.hasAllAccess) {
            visitReportsQuery = visitReportsQuery.in("user_id", scope.visibleUserIds);
          }

          const { data: visitReportsData, error: visitReportsError } = await visitReportsQuery;
          if (!visitReportsError) {
            (visitReportsData || []).forEach((row) => {
              if (!row?.note) return;

              try {
                const parsed = JSON.parse(row.note);
                const customerCode = String(parsed?.customer_code || "").trim().toUpperCase();
                if (!customerCode) return;

                const visitAt = parsed?.captured_at || row.created_at;
                const current = latestVisitByCustomer.get(customerCode);
                if (!current || getSortTimestamp(visitAt) > getSortTimestamp(current)) {
                  latestVisitByCustomer.set(customerCode, visitAt);
                }

                if (!nextVisitByCustomer.has(customerCode)) {
                  nextVisitByCustomer.set(customerCode, parsed?.next_visit_at ? String(parsed.next_visit_at) : null);
                }
              } catch {
                // Ignore malformed notes.
              }
            });
          }
        } else {
          const customerCodes = customerRows
            .map((row) => String(row.customer_code || "").trim().toUpperCase())
            .filter(Boolean);

          if (customerCodes.length > 0) {
            const settingKeys = customerCodes.map((code) => `visit_report_latest:${code}`);
            const { data: fallbackReports, error: fallbackReportsError } = await supabase
              .from("system_settings")
              .select("setting_key,setting_value")
              .in("setting_key", settingKeys);

            if (!fallbackReportsError) {
              (fallbackReports || []).forEach((row) => {
                if (!row?.setting_value) return;

                try {
                  const parsed = JSON.parse(String(row.setting_value));
                  const customerCode = String(parsed?.customer_code || "").trim().toUpperCase();
                  if (!customerCode) return;

                  const visitAt = parsed?.captured_at || parsed?.saved_at || null;
                  if (!visitAt) return;

                  const current = latestVisitByCustomer.get(customerCode);
                  if (!current || getSortTimestamp(visitAt) > getSortTimestamp(current)) {
                    latestVisitByCustomer.set(customerCode, visitAt);
                  }

                  if (!nextVisitByCustomer.has(customerCode)) {
                    nextVisitByCustomer.set(customerCode, parsed?.next_visit_at ? String(parsed.next_visit_at) : null);
                  }
                } catch {
                  // Ignore malformed fallback records.
                }
              });
            }
          }
        }

        const overdueRows = customerRows.filter((row) => daysBetween(row.latest_transaction_date) > 21);
        const followUpRows = customerRows.filter((row) => daysBetween(row.latest_transaction_date) > 10);

        const visiblePendingOrders = (pendingOrdersRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return scope.visibleUserIds.includes(row.created_by) || scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase());
        });

        const visibleSubmittedOrders = (submittedTodayRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return scope.visibleUserIds.includes(row.created_by) || scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase());
        });

        setSummary({
          visitsToday: todayCustomers.size,
          followUps: followUpRows.length,
          pendingOrders: visiblePendingOrders.length,
          overdueVisits: overdueRows.length,
          newCustomersAssigned: newProspectsCount,
          completedVisits: productiveCustomers.size,
        });

        setRouteRows((routeRes.data || []).filter(isVisitStatusCustomer));

        setVisitStatusRows(
          customerRows
            .filter(isVisitStatusCustomer)
            .map((row) => ({
              customer_code: row.customer_code,
              customer_name: row.customer_name,
              city: row.city,
              area: row.area,
              last_invoice_date: row.latest_transaction_date || null,
              last_visit_date: latestVisitByCustomer.get(String(row.customer_code || "").trim().toUpperCase()) || null,
              days_since_last_invoice: daysBetweenNullable(row.latest_transaction_date),
              days_since_last_visit: daysBetweenNullable(latestVisitByCustomer.get(String(row.customer_code || "").trim().toUpperCase()) || null),
              next_visit_at: nextVisitByCustomer.get(String(row.customer_code || "").trim().toUpperCase()) || null,
              recent_sales_value: Number(row.recent_sales_value || 0),
              outstanding_0_30: Number(row.outstanding_0_30 || 0),
              outstanding_30_60: Number(row.outstanding_30_60 || 0),
              outstanding_above_60: Number(row.outstanding_above_60 || 0),
              status: todayCustomers.has(String(row.customer_code || "").trim().toUpperCase())
                ? "Visited"
                : daysBetween(row.latest_transaction_date) > 21
                ? "Overdue"
                : "Planned",
            }))
        );
      } catch (err) {
        setError(err.message || "Unable to load My Day planner.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [today]);

  async function captureLocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation is not supported on this device.");
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6)),
            accuracy: Number(position.coords.accuracy.toFixed(1)),
          });
        },
        () => reject(new Error("Unable to read GPS location.")),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function addLog(entryType) {
    if (!logsEnabled) {
      setError("Daily activity logs are disabled until the daily_activity_logs table is available.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error("Please login again.");
      }

      const location = await captureLocation();

      const payload = {
        user_id: session.user.id,
        entry_type: entryType,
        note: JSON.stringify({
          action: entryType,
          note: entryType === "NOTE" ? note || null : null,
          captured_at: new Date().toISOString(),
          location,
        }),
      };

      const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
      if (insertError) throw insertError;

      setMessage(entryType === "NOTE" ? "Note saved with GPS." : `${entryType} logged with GPS.`);
      if (entryType === "NOTE") setNote("");

      const { data: logs, error: logsError } = await supabase
        .from("daily_activity_logs")
        .select("id,entry_type,note,created_at")
        .eq("user_id", session.user.id)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`)
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;
      const rows = logs || [];
      setTodayLogs(rows);
    } catch (err) {
      setError(err.message || "Unable to save activity log.");
    }
  }

  async function handleAttendanceAction(entryType) {
    setAttendanceBusy(entryType);
    setError("");
    setMessage("");

    try {
      await addLog(entryType);
    } catch (err) {
      setError(err.message || "Unable to save attendance action.");
    } finally {
      setAttendanceBusy("");
    }
  }

  async function openVisitReport(customer) {
    const nextCode = activeVisitCustomerCode === customer.customer_code ? "" : customer.customer_code;
    setActiveVisitCustomerCode(nextCode);

    if (!nextCode) {
      setVisitItemsLoading(false);
      setVisitForm({
        outcome: "PAYMENT_FOLLOWUP",
        nextVisitAt: "",
        note: "",
        stockChecks: [],
      });
      return;
    }

    setVisitItemsLoading(true);
    setVisitForm({
      outcome: "PAYMENT_FOLLOWUP",
      nextVisitAt: toDatetimeLocalValue(customer?.next_visit_at),
      note: "",
      stockChecks: [],
    });

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      let itemsQuery = supabase
        .from("active_sales")
        .select("item_code,item_name,transaction_date,salesman_code")
        .eq("customer_code", customer.customer_code)
          .order("transaction_date", { ascending: false });

      if (!accessScope?.hasAllAccess) {
        itemsQuery = itemsQuery.in("salesman_code", accessScope?.visibleSalesmanCodes || []);
      }

      const { data, error: itemsError } = await itemsQuery;
      if (itemsError) throw itemsError;

      const uniqueItems = [];
      const seen = new Set();
      (data || []).forEach((row) => {
        const key = String(row.item_code || row.item_name || "").trim().toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        uniqueItems.push({
          itemCode: row.item_code || "",
          itemName: row.item_name || row.item_code || key,
          status: "",
        });
      });

      setVisitForm((current) => ({
        ...current,
        stockChecks: uniqueItems,
      }));
    } catch (err) {
      setError(err.message || "Unable to load bought items for this customer.");
    } finally {
      setVisitItemsLoading(false);
    }
  }

  function setStockStatus(itemKey, status) {
    setVisitForm((current) => ({
      ...current,
      stockChecks: current.stockChecks.map((item) => {
        const key = String(item.itemCode || item.itemName).trim().toUpperCase();
        if (key !== itemKey) return item;
        return {
          ...item,
          status,
        };
      }),
    }));
  }

  async function saveVisitReport(customer) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setVisitSaving(true);
    setError("");
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error("Please login again.");
      }

      const location = await captureLocation();
      const capturedAt = new Date().toISOString();

      if (logsEnabled) {
        const payload = {
          user_id: session.user.id,
          entry_type: "VISIT_REPORT",
          note: JSON.stringify({
            action: "VISIT_REPORT",
            customer_code: customer.customer_code,
            customer_name: customer.customer_name,
            outcome: visitForm.outcome,
            next_visit_at: visitForm.nextVisitAt || null,
            note: visitForm.note || null,
            stock_checks: visitForm.stockChecks,
            captured_at: capturedAt,
            location,
          }),
        };

        const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
        if (insertError) throw insertError;
      } else {
        const response = await fetch("/api/visit-reports", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            customerCode: customer.customer_code,
            customerName: customer.customer_name,
            outcome: visitForm.outcome,
            nextVisitAt: visitForm.nextVisitAt || null,
            note: visitForm.note || null,
            stockChecks: visitForm.stockChecks,
            capturedAt,
            location,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || "Unable to save visit report.");
        }
      }

      setMessage(`${customer.customer_name} ${language === "ar" ? "تم حفظ تقرير الزيارة" : "visit report saved"}.`);
      setVisitStatusRows((current) =>
        current.map((row) => {
          if (row.customer_code !== customer.customer_code) return row;
          return {
            ...row,
            last_visit_date: capturedAt,
            days_since_last_visit: 0,
            status: "Visited",
            next_visit_at: visitForm.nextVisitAt || null,
          };
        })
      );
      setActiveVisitCustomerCode("");
      setVisitForm({
        outcome: "PAYMENT_FOLLOWUP",
        nextVisitAt: "",
        note: "",
        stockChecks: [],
      });
    } catch (err) {
      setError(err.message || "Unable to save visit report.");
    } finally {
      setVisitSaving(false);
    }
  }

  async function markCustomerInactive(customer) {
    const code = String(customer?.customer_code || "").trim();
    if (!code) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setInactiveCustomerCode(code);
    setError("");
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const response = await fetch("/api/visit-reports", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ customerCode: code, isActive: false }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Unable to mark customer inactive.");
      }

      setVisitStatusRows((current) => current.filter((row) => row.customer_code !== code));
      setRouteRows((current) => current.filter((row) => row.customer_code !== code));
      if (activeVisitCustomerCode === code) {
        setActiveVisitCustomerCode("");
      }
      setMessage(t("inactiveSaved"));
    } catch (err) {
      setError(err.message || "Unable to mark customer inactive.");
    } finally {
      setInactiveCustomerCode("");
    }
  }

  function toggleVisitNoteDictation() {
    if (dictationActive) {
      speechRecognitionRef.current?.stop?.();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = language === "ar" ? "ar-SA" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (!transcript) return;
      setVisitForm((current) => ({
        ...current,
        note: [current.note.trim(), transcript].filter(Boolean).join(" "),
      }));
    };
    recognition.onend = () => setDictationActive(false);
    recognition.onerror = (event) => {
      setDictationActive(false);
      if (event?.error !== "aborted") {
        setError("Voice dictation could not start. Check microphone permission and try again.");
      }
    };
    speechRecognitionRef.current = recognition;
    recognition.start();
    setDictationActive(true);
  }

  const routeSummary = useMemo(() => {
    const map = new Map();
    routeRows.forEach((row) => {
      const key = row.city || "Unknown";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [routeRows]);

  const rankedVisitStatusRows = useMemo(
    () => filterAndRankVisitCustomers(visitStatusRows, visitStatusSearch),
    [visitStatusRows, visitStatusSearch]
  );

  const groupedVisitStatusRows = useMemo(
    () => splitVisitCustomersByOutstanding(rankedVisitStatusRows),
    [rankedVisitStatusRows]
  );

  const plannedVisitRows = useMemo(
    () =>
      visitStatusRows
        .filter((row) => row.next_visit_at)
        .sort((a, b) => {
          const bySchedule = getSortTimestamp(a.next_visit_at) - getSortTimestamp(b.next_visit_at);
          if (bySchedule !== 0) return bySchedule;
          return String(a.customer_name || a.customer_code || "").localeCompare(String(b.customer_name || b.customer_code || ""));
        }),
    [visitStatusRows]
  );

  const visitCalendar = useMemo(() => {
    const dayMap = new Map();
    const unscheduled = [];

    plannedVisitRows.forEach((row) => {
      const time = getSortTimestamp(row.next_visit_at);
      if (!time) {
        unscheduled.push(row);
        return;
      }

      const dateKey = new Date(time).toISOString().slice(0, 10);
      const current = dayMap.get(dateKey) || [];
      current.push(row);
      dayMap.set(dateKey, current);
    });

    const days = Array.from(dayMap.entries())
      .map(([dateKey, rows]) => ({
        dateKey,
        label: new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        rows: rows.sort((a, b) => getSortTimestamp(a.next_visit_at) - getSortTimestamp(b.next_visit_at)),
      }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    return { days, unscheduled };
  }, [plannedVisitRows]);

  const isAdministrator = String(profile?.role || "").toLowerCase() === "admin";

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="My Day unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to load daily planner data."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
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
          <div className="moduleHeaderMeta">
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
            <Link href="/" className="moduleBackLink">{t("dashboard")}</Link>
          </div>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}
        {warnings.map((warning) => (
          <div key={warning} className="moduleWarning">{warning}</div>
        ))}

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>{t("visitsToday")}</span><strong>{summary.visitsToday}</strong></section>
          <section className="moduleMetricCard"><span>{t("followUps")}</span><strong>{summary.followUps}</strong></section>
          <section className="moduleMetricCard"><span>{t("pendingOrders")}</span><strong>{summary.pendingOrders}</strong></section>
          <section className="moduleMetricCard"><span>{t("overdueVisits")}</span><strong>{summary.overdueVisits}</strong></section>
          <section className="moduleMetricCard"><span>{t("newCustomers")}</span><strong>{summary.newCustomersAssigned}</strong></section>
          <section className="moduleMetricCard"><span>{t("completedVisits")}</span><strong>{summary.completedVisits}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("attendance")}</h2>
            <span>{profile?.salesman_name || profile?.salesman_code || ""}</span>
          </div>
          <div className="moduleActionRow">
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("MORNING_ATTENDANCE")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "MORNING_ATTENDANCE" ? t("saving") : t("morningAttendance")}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("LUNCH_BREAK_OUT")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "LUNCH_BREAK_OUT" ? t("saving") : t("lunchBreakOut")}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("LUNCH_BREAK_IN")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "LUNCH_BREAK_IN" ? t("saving") : t("lunchBreakIn")}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("END_OF_DAY")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "END_OF_DAY" ? t("saving") : t("endOfDay")}
            </button>
          </div>
          <div className="moduleFilterRow">
            <input
              className="moduleInput"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("addPlannerNote")}
              disabled={!logsEnabled}
            />
            <button type="button" className="moduleInlineButton" onClick={() => handleAttendanceAction("NOTE")} disabled={!logsEnabled || Boolean(attendanceBusy)}>{t("saveNote")}</button>
          </div>
          {isAdministrator && (
            <ul className="moduleList">
              {todayLogs.map((row) => (
                <li key={row.id}>
                  <strong>{row.entry_type}</strong>
                  <span>{row.created_at ? new Date(row.created_at).toLocaleTimeString("en-GB") : ""}</span>
                  {getLogPreview(row) ? <p>{getLogPreview(row)}</p> : null}
                </li>
              ))}
              {todayLogs.length === 0 && <li>{t("noLogs")}</li>}
            </ul>
          )}
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("routeSummary")}</h2>
          </div>
          <div className="moduleHealthGrid">
            {routeSummary.map(([city, count]) => (
              <div key={city}><span>{city}</span><strong>{count} {t("customersCount")}</strong></div>
            ))}
            {routeSummary.length === 0 && <div><span>{t("noRoutes")}</span><strong>0 {t("customersCount")}</strong></div>}
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("visitSchedule")}</h2>
            <span>{plannedVisitRows.length} {t("plannedVisitsCount")}</span>
          </div>
          {visitCalendar.days.map((day) => (
            <div key={day.dateKey} style={{ marginTop: "10px" }}>
              <div className="moduleSectionHeader">
                <h2>{day.label}</h2>
                <span>{day.rows.length} {t("plannedVisitsCount")}</span>
              </div>
              <div className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("calendarTime")}</th>
                      <th>{t("customer")}</th>
                      <th>{t("cityArea")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.rows.map((row) => (
                      <tr key={`planned-${day.dateKey}-${row.customer_code}`}>
                        <td>{row.next_visit_at ? new Date(row.next_visit_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                        <td>{row.customer_name || row.customer_code}</td>
                        <td>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                        <td>
                          <div className="moduleInlineStack">
                            <button type="button" className="moduleInlineButton" onClick={() => openVisitReport(row)}>
                              {activeVisitCustomerCode === row.customer_code ? t("closeReport") : t("visitWithoutOrder")}
                            </button>
                            <Link
                              href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`}
                              className="moduleInlineButton"
                            >
                              {t("openAudit")}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {visitCalendar.days.length === 0 && plannedVisitRows.length === 0 && (
            <div className="moduleHint">{t("noPlannedVisits")}</div>
          )}

          {visitCalendar.unscheduled.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <div className="moduleSectionHeader">
                <h2>{t("unscheduledVisits")}</h2>
                <span>{visitCalendar.unscheduled.length}</span>
              </div>
              <div className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("customer")}</th>
                      <th>{t("cityArea")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitCalendar.unscheduled.map((row) => (
                      <tr key={`unscheduled-${row.customer_code}`}>
                        <td>{row.customer_name || row.customer_code}</td>
                        <td>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                        <td>
                          <div className="moduleInlineStack">
                            <button type="button" className="moduleInlineButton" onClick={() => openVisitReport(row)}>
                              {activeVisitCustomerCode === row.customer_code ? t("closeReport") : t("visitWithoutOrder")}
                            </button>
                            <Link
                              href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`}
                              className="moduleInlineButton"
                            >
                              {t("openAudit")}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("visitStatus")}</h2>
            <span>{rankedVisitStatusRows.length} {t("customersCount")}</span>
          </div>
          <input
            className="moduleInput"
            style={{ marginBottom: "10px" }}
            type="search"
            value={visitStatusSearch}
            onChange={(event) => setVisitStatusSearch(event.target.value)}
            placeholder={t("searchCustomer")}
          />
          {[
            { key: "under-60", title: t("outstandingUnder60"), rows: groupedVisitStatusRows.under60 },
            { key: "above-60", title: t("outstandingAbove60"), rows: groupedVisitStatusRows.above60 },
          ].map((group) => (
          <div key={group.key} style={{ marginTop: "14px" }}>
            <div className="moduleSectionHeader">
              <h2>{group.title}</h2>
              <span>{group.rows.length} {t("customersCount")}</span>
            </div>
            <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>{t("customer")}</th>
                  <th>{t("cityArea")}</th>
                  <th>{t("daysSinceLastInvoice")}</th>
                  <th>{t("daysSinceLastVisit")}</th>
                  <th>{t("recentValue")}</th>
                  <th>{t("outstanding0To30")}</th>
                  <th>{t("outstanding30To60")}</th>
                  <th>{t("outstandingAbove60Column")}</th>
                  <th>{t("status")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <Fragment key={row.customer_code}>
                  <tr>
                    <td>
                      <div className="moduleInlineStack">
                        <span>{row.customer_name || row.customer_code}</span>
                        <button type="button" className="moduleInlineButton" onClick={() => openVisitReport(row)}>
                          {activeVisitCustomerCode === row.customer_code ? t("closeReport") : t("visitWithoutOrder")}
                        </button>
                      </div>
                    </td>
                    <td>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                    <td>{row.days_since_last_invoice == null ? "-" : row.days_since_last_invoice}</td>
                    <td>{row.days_since_last_visit == null ? "-" : row.days_since_last_visit}</td>
                    <td>SAR {Number(row.recent_sales_value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                    <td>SAR {Number(row.outstanding_0_30 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>SAR {Number(row.outstanding_30_60 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>SAR {Number(row.outstanding_above_60 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>{row.status === "Visited" ? t("visited") : row.status === "Overdue" ? t("overdue") : t("planned")}</td>
                    <td>
                      <div className="moduleInlineStack">
                        <Link
                          href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`}
                          className="moduleInlineButton"
                        >
                          {t("openAudit")}
                        </Link>
                        <button
                          type="button"
                          className="moduleInlineButton"
                          onClick={() => markCustomerInactive(row)}
                          disabled={inactiveCustomerCode === row.customer_code}
                        >
                          {inactiveCustomerCode === row.customer_code ? t("markingInactive") : t("markInactive")}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {activeVisitCustomerCode === row.customer_code && (
                    <tr>
                      <td colSpan={10}>
                        <div className="moduleVisitPanel">
                          <div className="moduleSectionHeader">
                            <h2>{t("visitReport")}</h2>
                            <span>{row.customer_name || row.customer_code}</span>
                          </div>
                          <div className="moduleFormGrid">
                            <label>
                              {t("visitOutcome")}
                              <select className="moduleInput" value={visitForm.outcome} onChange={(event) => setVisitForm((current) => ({ ...current, outcome: event.target.value }))}>
                                <option value="PAYMENT_FOLLOWUP">{t("paymentFollowup")}</option>
                                <option value="COME_BACK_LATER">{t("comeBackLater")}</option>
                                <option value="PURCHASE_MANAGER_NOT_AVAILABLE">{t("purchaseManagerUnavailable")}</option>
                                <option value="STOCKS_AVAILABLE">{t("stocksAvailable")}</option>
                                <option value="ORDER_TAKEN">{t("orderTaken")}</option>
                              </select>
                            </label>
                            <label>
                              {t("nextVisit")}
                              <input className="moduleInput" type="datetime-local" value={visitForm.nextVisitAt} onChange={(event) => setVisitForm((current) => ({ ...current, nextVisitAt: event.target.value }))} />
                            </label>
                            <label className="moduleFieldFull">
                              {t("visitNotes")}
                              <textarea className="moduleTextArea" rows={3} value={visitForm.note} onChange={(event) => setVisitForm((current) => ({ ...current, note: event.target.value }))} />
                              {dictationSupported && (
                                <button type="button" className="moduleInlineButton" aria-pressed={dictationActive} onClick={toggleVisitNoteDictation}>
                                  {dictationActive ? t("stopDictation") : t("startDictation")}
                                </button>
                              )}
                            </label>
                            <div className="moduleFieldFull">
                              <div className="moduleSectionHeader">
                                <h2>{t("boughtItems")}</h2>
                              </div>
                              {visitItemsLoading && <div className="moduleLoading">{t("loadingItems")}</div>}
                              {!visitItemsLoading && visitForm.stockChecks.length > 0 && (
                                <ul className="moduleList">
                                  {visitForm.stockChecks.map((stockCheck, index) => (
                                    <li key={`${stockCheck.itemName}-${index}`}>
                                      <div className="moduleStockRow">
                                        <strong>{stockCheck.itemName}</strong>
                                        <button type="button" className={`moduleChipButton ${stockCheck.status === "AVAILABLE" ? "active" : ""}`} onClick={() => setStockStatus(String(stockCheck.itemCode || stockCheck.itemName).trim().toUpperCase(), "AVAILABLE")}>{t("available")}</button>
                                        <button type="button" className={`moduleChipButton ${stockCheck.status === "NOT_AVAILABLE" ? "active" : ""}`} onClick={() => setStockStatus(String(stockCheck.itemCode || stockCheck.itemName).trim().toUpperCase(), "NOT_AVAILABLE")}>{t("notAvailable")}</button>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {!visitItemsLoading && visitForm.stockChecks.length === 0 && <div className="moduleHint">{t("noBoughtItems")}</div>}
                            </div>
                            <div className="moduleFieldFull">
                              <button type="button" className="modulePrimaryButton" onClick={() => saveVisitReport(row)} disabled={visitSaving}>
                                {visitSaving ? t("saving") : t("saveVisitReport")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {group.rows.length === 0 && (
                  <tr>
                    <td colSpan={10}>{t("noCustomers")}</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
          ))}
        </section>
      </div>
    </main>
    </MorningAttendanceGate>
  );
}
