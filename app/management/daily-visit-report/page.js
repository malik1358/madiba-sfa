"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import DayRouteMap from "../../components/DayRouteMap";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import {
  DEFAULT_TRANSIT_SPEED_KMH,
  applyReverseGeocoding,
  buildGoogleMapsPointUrl,
  buildGpsActivityNote,
  formatDurationMinutes,
  resolveWaitingMinutesFromPreviousVisit,
  resolveGpsCapturePlatform,
  sumWaitingMinutesFromTimeline,
} from "../../lib/geo";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { useReverseGeocodeCache } from "../../hooks/useReverseGeocodeCache";
import { addKsaCalendarDays, formatKsaTime, getKsaDateString, getKsaWeekdayIndexForDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { visitReportRowClassName, VISIT_REPORT_ROW_LEGEND } from "../../lib/visitReportRowColors";
import { entryDisplayAmount, formatEntryCoordinates, formatSplitMoney } from "../../lib/dailyVisitReportStats";

const TEXT = {
  title: { en: "Daily Visit Report", ar: "تقرير الزيارات اليومي" },
  subtitle: {
    en: "User timeline with login, lunch, idle GPS pings, visits, orders, and movement",
    ar: "الجدول الزمني للمستخدم مع تسجيل الدخول والغداء ونبضات GPS والزيارات والطلبات والحركة",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading daily visit report...", ar: "جاري تحميل تقرير الزيارات اليومي..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  user: { en: "User", ar: "المستخدم" },
  allUsers: { en: "All users", ar: "كل المستخدمين" },
  noEntries: { en: "No visits or orders found for this date.", ar: "لا توجد زيارات أو طلبات في هذا التاريخ." },
  totalEntries: { en: "Total entries", ar: "إجمالي الإدخالات" },
  totalRouteDistance: { en: "Total route distance", ar: "إجمالي مسافة المسار" },
  farFromCustomer: { en: "Far from customer", ar: "بعيد عن العميل" },
  usersActive: { en: "Users active", ar: "المستخدمون النشطون" },
  thresholdNote: {
    en: "Entries more than 0.5 km from saved customer location are marked far from customer.",
    ar: "الإدخالات التي تبعد أكثر من 0.5 كم عن موقع العميل المحفوظ تُ marked بعيدة عن العميل.",
  },
  sequence: { en: "#", ar: "#" },
  time: { en: "Time", ar: "الوقت" },
  userName: { en: "User name", ar: "اسم المستخدم" },
  customer: { en: "Customer", ar: "العميل" },
  transaction: { en: "Transaction", ar: "المعاملة" },
  distanceFromCustomer: { en: "Distance from customer", ar: "المسافة من العميل" },
  distanceFromPrevious: { en: "Distance from previous", ar: "المسافة من السابق" },
  area: { en: "Area", ar: "المنطقة" },
  street: { en: "Street", ar: "الشارع" },
  speed: { en: "Speed (km/h)", ar: "السرعة (كم/س)" },
  waitingTime: { en: "Est. waiting", ar: "وقت الانتظار التقديري" },
  waitingTimeHint: {
    en: "Elapsed time between visits minus estimated driving time at 50 km/h. Idle GPS pings are ignored.",
    ar: "الوقت المنقضي بين الزيارات ناقص وقت القيادة التقديري بسرعة 50 كم/س. يتم تجاهل نبضات GPS الخاملة.",
  },
  totalWaiting: { en: "Est. total waiting", ar: "إجمالي وقت الانتظار التقديري" },
  waitingTotalShort: { en: "Est. waiting total", ar: "إجمالي الانتظار التقديري" },
  map: { en: "Map", ar: "الخريطة" },
  openMap: { en: "Open", ar: "فتح" },
  noCustomerLocation: { en: "No customer location", ar: "لا موقع للعميل" },
  noEntryGps: { en: "No entry GPS", ar: "لا GPS للإدخال" },
  farBadge: { en: "Far", ar: "بعيد" },
  entries: { en: "entries", ar: "إدخالات" },
  routeTotal: { en: "Route total", ar: "إجمالي المسار" },
  autoClosed: { en: "Auto-closed", ar: "إغلاق تلقائي" },
  platform: { en: "Platform", ar: "المنصة" },
  dayRoute: { en: "Day route", ar: "مسار اليوم" },
  openRouteMap: { en: "Driving route (no names)", ar: "مسار القيادة (بدون أسماء)" },
  mapsHint: {
    en: "Google Maps driving route has no customer names. Open a stop below to drop a labeled pin on that street. Look at the neighborhood around the pin — that is the GPS place.",
    ar: "مسار القيادة في خرائط جوجل لا يعرض أسماء العملاء. افتح محطة أدناه لإسقاط دبوس باسم الشارع. انظر إلى الحي حول الدبوس — هذا مكان الـ GPS.",
  },
  longestIdleTitle: { en: "Longest idle", ar: "أطول توقف" },
  openThisPlace: { en: "Open this place", ar: "فتح هذا المكان" },
  openLongestIdle: { en: "Open longest idle in Google Maps", ar: "فتح أطول توقف في خرائط جوجل" },
  routeStops: { en: "Login, lunch, logout, and idle", ar: "الدخول والغداء والخروج والتوقف" },
  workingHours: { en: "Working hours", ar: "ساعات العمل" },
  visitNumber: { en: "Visit #", ar: "رقم الزيارة" },
  coordinates: { en: "Coordinates", ar: "الإحداثيات" },
  daySplitTitle: { en: "Day split", ar: "تفصيل اليوم" },
  visitWithoutOrder: { en: "Visit without order", ar: "زيارة بدون طلب" },
  newCustomerOrders: { en: "New-customer orders", ar: "طلبات عملاء جدد" },
  repeatCustomerOrders: { en: "Repeat-customer orders", ar: "طلبات عملاء متكررين" },
  collectionsSplit: { en: "Collections", ar: "تحصيلات" },
  splitCount: { en: "Count", ar: "العدد" },
  splitValue: { en: "Value", ar: "القيمة" },
  idleBubblesTitle: { en: "Unlogged idle circles", ar: "دوائر التوقف غير المسجل" },
  idleBubblesHint: {
    en: "Bigger red circle = longer time with no visit, order, collection, or lunch logged.",
    ar: "الدائرة الحمراء الأكبر = وقت أطول بدون زيارة أو طلب أو تحصيل أو غداء.",
  },
  idleGpsLegend: { en: "Idle GPS ping", ar: "نبضة GPS خاملة" },
  unloggedIdleLegend: { en: "Unlogged idle", ar: "توقف غير مسجل" },
  loggedStopLegend: { en: "Logged stop", ar: "محطة مسجلة" },
  emailUsers: { en: "Users to email", ar: "المستخدمون للإرسال" },
  reportEmail: { en: "Report email", ar: "بريد التقرير" },
  reportEmailHint: {
    en: "Visit report mail is sent to this address and to every head above the user. Login usernames are not used.",
    ar: "يُرسل بريد تقرير الزيارة إلى هذا العنوان وإلى كل الرؤساء فوق المستخدم. لا يُستخدم اسم الدخول.",
  },
  selectAllUsers: { en: "Select all users", ar: "تحديد كل المستخدمين" },
  sendEmail: { en: "Send selected", ar: "إرسال المحددين" },
  sendAllDate: { en: "Send this date to all", ar: "إرسال هذا التاريخ للجميع" },
  sendThursday: { en: "Send Thursday report", ar: "إرسال تقرير الخميس" },
  sendSaturday: { en: "Send Saturday report", ar: "إرسال تقرير السبت" },
  sendMidnight: { en: "Run midnight send now", ar: "تشغيل إرسال منتصف الليل الآن" },
  sendingEmail: { en: "Sending email...", ar: "جاري إرسال البريد..." },
  emailNoUsers: { en: "Select at least one user to email.", ar: "حدد مستخدماً واحداً على الأقل لإرسال البريد." },
  emailConfirm: {
    en: "Send the daily visit report email for {count} selected user(s) on {date}?",
    ar: "إرسال تقرير الزيارات اليومي بالبريد لـ {count} مستخدم في {date}؟",
  },
  emailConfirmAll: {
    en: "Send the daily visit report email to all users for {date}?",
    ar: "إرسال تقرير الزيارات اليومي لجميع المستخدمين لتاريخ {date}؟",
  },
  emailConfirmMidnight: {
    en: "Run the midnight visit-report send now? Thursday goes out Friday midnight, Saturday goes out Sunday 00:10.",
    ar: "تشغيل إرسال تقرير الزيارات لمنتصف الليل الآن؟ يُرسل الخميس منتصف ليل الجمعة والسبت الأحد 00:10.",
  },
  emailSent: {
    en: "Sent {sent} of {total} report emails for {date}.",
    ar: "تم إرسال {sent} من {total} تقارير لـ {date}.",
  },
  tableLegend: { en: "Row colors", ar: "ألوان الصفوف" },
  inactivityLogTitle: { en: "Inactivity email log", ar: "سجل بريد عدم النشاط" },
  inactivityLogHint: {
    en: "Cron checks about every 10 minutes. A new email is due every 40 minutes of idle time. Lunch is skipped. Gap shows minutes since the previous email for that user.",
    ar: "يتحقق الكرون كل 10 دقائق تقريباً. يُستحق بريد جديد كل 40 دقيقة من التوقف. يُستثنى الغداء. الفجوة هي الدقائق منذ البريد السابق لنفس المستخدم.",
  },
  inactivitySent: { en: "Emails sent", ar: "رسائل أُرسلت" },
  inactivityChecks: { en: "Cron checks", ar: "فحوصات الكرون" },
  inactivityGap: { en: "Gap", ar: "الفجوة" },
  inactivityStatus: { en: "Status", ar: "الحالة" },
  inactivityReason: { en: "Reason", ar: "السبب" },
  inactivitySlot: { en: "Slot", ar: "الفترة" },
  inactivityIdle: { en: "Idle", ar: "التوقف" },
  inactivityNoSends: { en: "No inactivity emails logged for this date.", ar: "لا يوجد بريد عدم نشاط لهذا التاريخ." },
  inactivityNoChecks: {
    en: "No cron check rows yet. After the next inactivity job, skipped and sent attempts appear here.",
    ar: "لا توجد فحوصات كرون بعد. بعد مهمة عدم النشاط التالية تظهر هنا المحاولات المرسلة والمتخطاة.",
  },
  inactivityTypeInactivity: { en: "Inactivity", ar: "عدم نشاط" },
  inactivityTypeLateLogin: { en: "Late login", ar: "تأخر الدخول" },
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function mostRecentKsaDateOnWeekday(weekday) {
  let date = getKsaDateString();
  for (let index = 0; index < 7; index += 1) {
    if (getKsaWeekdayIndexForDateString(date) === weekday) return date;
    date = addKsaCalendarDays(date, -1);
  }
  return date;
}

function formatTime(value) {
  return formatKsaTime(value);
}

const INACTIVITY_REASON_LABELS = {
  sent: { en: "Sent", ar: "أُرسل" },
  already_sent: { en: "Already sent this 40-minute slot", ar: "أُرسل في فترة الـ 40 دقيقة هذه" },
  no_recipients: { en: "No recipient emails", ar: "لا يوجد بريد للمستلمين" },
  lunch_break: { en: "Lunch break", ar: "استراحة الغداء" },
  logged_out: { en: "Logged out", ar: "تم تسجيل الخروج" },
  not_in_work_session: { en: "Between lunch out and lunch in", ar: "بين خروج الغداء ودخول الغداء" },
  idle_under_40_minutes: { en: "Idle under 40 minutes", ar: "التوقف أقل من 40 دقيقة" },
  outside_hours: { en: "Outside working hours", ar: "خارج ساعات العمل" },
  not_logged_in: { en: "Not logged in", ar: "لم يسجل الدخول" },
  failed: { en: "Send failed", ar: "فشل الإرسال" },
  email_not_configured: { en: "Email not configured", ar: "البريد غير مضبوط" },
};

function inactivityReasonLabel(reason, language) {
  const labels = INACTIVITY_REASON_LABELS[String(reason || "")];
  if (!labels) return reason || "-";
  return language === "ar" ? labels.ar : labels.en;
}

function formatGapMinutes(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value)}m`;
}

export default function DailyVisitReportPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);
  const [urlParamsApplied, setUrlParamsApplied] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [reportEmails, setReportEmails] = useState({});
  const [emailBusy, setEmailBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inactivityLog, setInactivityLog] = useState(null);

  usePopupMessages({ error, message });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    const userParam = params.get("userId");

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setReportDate(dateParam);
    }
    if (userParam) {
      setUserId(userParam);
    }
    setUrlParamsApplied(true);
  }, []);

  const userOptions = useMemo(
    () => (Array.isArray(report?.availableUsers) ? report.availableUsers : []),
    [report],
  );

  const emailUserOptions = useMemo(() => {
    const byId = new Map();
    userOptions.forEach((user) => {
      if (user?.userId) byId.set(user.userId, user);
    });
    (report?.users || []).forEach((user) => {
      if (user?.userId) {
        byId.set(user.userId, {
          userId: user.userId,
          userName: user.userName,
          reportEmail: user.reportEmail || byId.get(user.userId)?.reportEmail || "",
          email: user.email || byId.get(user.userId)?.email || "",
        });
      }
    });
    return [...byId.values()].sort((left, right) => String(left.userName || "").localeCompare(String(right.userName || "")));
  }, [report, userOptions]);

  const allEmailUsersSelected = emailUserOptions.length > 0
    && emailUserOptions.every((user) => selectedUserIds.includes(user.userId));

  useEffect(() => {
    setSelectedUserIds(userId ? [userId] : []);
    setMessage("");
  }, [reportDate, userId]);

  useEffect(() => {
    const next = {};
    emailUserOptions.forEach((user) => {
      next[user.userId] = user.reportEmail || user.email || "";
    });
    setReportEmails(next);
  }, [emailUserOptions]);

  const geocodeCache = useReverseGeocodeCache(report);

  const displayUsers = useMemo(() => {
    if (!report?.users?.length) return [];
    if (!geocodeCache?.size) return report.users;

    return report.users.map((entryUser) => ({
      ...entryUser,
      entries: (entryUser.entries || []).map((entry) => applyReverseGeocoding(entry, geocodeCache)),
    }));
  }, [report, geocodeCache]);

  const totalWaitingMinutes = useMemo(() => {
    if (!displayUsers.length) return 0;
    return displayUsers.reduce(
      (total, entryUser) => total + sumWaitingMinutesFromTimeline(entryUser.entries, DEFAULT_TRANSIT_SPEED_KMH),
      0,
    );
  }, [displayUsers]);

  useEffect(() => {
    if (!urlParamsApplied) return undefined;

    let cancelled = false;

    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) => current || "Report load timed out. Please login and refresh the page.");
    });

    async function loadReport() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        stopSafetyTimer();
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setInactivityLog(null);

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;

        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const params = new URLSearchParams({ date: reportDate });
        if (userId) params.set("userId", userId);

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/daily-visit-report?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          45000,
        );

        if (cancelled) return;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load daily visit report.");
        }

        setReport(payload);

        try {
          const logParams = new URLSearchParams({ date: reportDate });
          if (userId) logParams.set("userId", userId);
          const logResult = await fetchJsonWithTimeout(
            `/api/inactivity-email-log?${logParams.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            },
            20000,
          );
          if (!cancelled && logResult.response.ok && logResult.payload?.success) {
            setInactivityLog(logResult.payload);
          } else if (!cancelled) {
            setInactivityLog(null);
          }
        } catch {
          if (!cancelled) setInactivityLog(null);
        }
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load daily visit report.");
        }
        setReport(null);
      } finally {
        stopSafetyTimer();
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [reportDate, userId, urlParamsApplied]);

  function toggleEmailUser(nextUserId) {
    setSelectedUserIds((current) => (
      current.includes(nextUserId)
        ? current.filter((id) => id !== nextUserId)
        : [...current, nextUserId]
    ));
  }

  function toggleAllEmailUsers() {
    if (allEmailUsersSelected) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds(emailUserOptions.map((user) => user.userId));
  }

  async function sendVisitReportEmails({
    date = reportDate,
    userIds = [],
    allUsers = false,
    midnight = false,
    confirmText,
  } = {}) {
    if (emailBusy) return;

    const userIdsToSend = [...new Set((userIds || []).filter(Boolean))];
    if (!allUsers && !midnight && !userIdsToSend.length) {
      setError(t("emailNoUsers"));
      return;
    }

    if (!window.confirm(confirmText)) return;

    setEmailBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/daily-visit-report/email",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date: midnight ? undefined : date,
            allUsers,
            midnight,
            userIds: allUsers || midnight ? undefined : userIdsToSend,
            reportEmails: Object.fromEntries(
              (allUsers || midnight ? emailUserOptions.map((user) => user.userId) : userIdsToSend)
                .map((id) => [id, String(reportEmails[id] || "").trim()]),
            ),
          }),
        },
        120000,
      );

      if (!response.ok || !payload.success) {
        const failedNames = (payload.results || [])
          .filter((row) => row.status === "failed")
          .map((row) => row.userName || row.userId)
          .filter(Boolean);
        const extra = failedNames.length ? ` ${failedNames.join(", ")}` : "";
        throw new Error(`${payload.error || "Unable to send daily visit report email."}${extra}`);
      }

      if (payload.skipped) {
        setMessage(payload.message || `Skipped ${payload.date || date}: ${payload.reason || "not due"}.`);
        return;
      }

      const sentCount = Number(payload.sentCount || 0);
      const skippedCount = Number(payload.skippedCount || 0);
      const total = sentCount + skippedCount + Number(payload.failedCount || 0);
      let nextMessage = t("emailSent")
        .replace("{sent}", String(sentCount))
        .replace("{total}", String(total || userIdsToSend.length || sentCount))
        .replace("{date}", payload.date || date);
      if (skippedCount) {
        nextMessage += ` ${skippedCount} skipped.`;
      }
      setMessage(nextMessage);
    } catch (err) {
      const nextError = String(err.message || "");
      if (nextError === "SESSION_TIMEOUT") {
        setError("Session check timed out. Please refresh the page or login again.");
      } else {
        setError(nextError || "Unable to send daily visit report email.");
      }
    } finally {
      setEmailBusy(false);
    }
  }

  function sendSelectedUserEmails() {
    return sendVisitReportEmails({
      date: reportDate,
      userIds: selectedUserIds,
      confirmText: t("emailConfirm")
        .replace("{count}", String(selectedUserIds.length))
        .replace("{date}", reportDate),
    });
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Daily visit report unavailable"
        message="The daily visit report needs Supabase credentials."
      />
    );
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
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <MostVisitedPages />
              <AccessibleHeaderLink moduleKey="collectionReport" href="/management/collection-report" className="moduleBackLink">
                Collection Report
              </AccessibleHeaderLink>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleHint">{t("thresholdNote")}</div>

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("date")}
                <input
                  className="moduleInput"
                  type="date"
                  value={reportDate}
                  onChange={(event) => {
                    setUserId("");
                    setReportDate(event.target.value);
                  }}
                />
              </label>
              <label className="moduleField">
                {t("user")}
                <select
                  className="moduleInput"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                >
                  <option value="">{t("allUsers")}</option>
                  {userOptions.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.userName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {report?.canSendVisitReportEmail ? (
              <div style={{ marginTop: "12px" }}>
                <div className="moduleField">{t("emailUsers")}</div>
                <div className="moduleHint" style={{ marginBottom: "8px" }}>{t("reportEmailHint")}</div>
                <div className="moduleCollectorCheckboxList" role="group" aria-label={t("emailUsers")}>
                  {emailUserOptions.length === 0 ? (
                    <div className="moduleHint">{t("noEntries")}</div>
                  ) : (
                    <>
                      <label className="moduleCollectorCheckbox moduleCollectorCheckboxSelectAll">
                        <input
                          type="checkbox"
                          checked={allEmailUsersSelected}
                          onChange={toggleAllEmailUsers}
                          disabled={emailBusy}
                        />
                        <span>{t("selectAllUsers")}</span>
                      </label>
                      {emailUserOptions.map((user) => (
                        <label key={user.userId} className="moduleCollectorCheckbox" style={{ alignItems: "flex-start" }}>
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(user.userId)}
                            onChange={() => toggleEmailUser(user.userId)}
                            disabled={emailBusy}
                          />
                          <span>
                            <strong>{user.userName}</strong>
                            <input
                              className="moduleInput"
                              type="email"
                              value={reportEmails[user.userId] || ""}
                              placeholder={t("reportEmail")}
                              aria-label={`${t("reportEmail")} ${user.userName}`}
                              disabled={emailBusy}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const value = event.target.value;
                                setReportEmails((current) => ({ ...current, [user.userId]: value }));
                              }}
                              style={{ marginTop: "6px", minWidth: "220px" }}
                            />
                          </span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
                <div className="moduleActionRow" style={{ marginTop: "10px", flexWrap: "wrap", gap: "8px" }}>
                  <button
                    type="button"
                    className="modulePrimaryButton"
                    onClick={sendSelectedUserEmails}
                    disabled={emailBusy || !emailUserOptions.length}
                  >
                    {emailBusy ? t("sendingEmail") : t("sendEmail")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    onClick={() => sendVisitReportEmails({
                      date: reportDate,
                      allUsers: true,
                      confirmText: t("emailConfirmAll").replace("{date}", reportDate),
                    })}
                    disabled={emailBusy}
                  >
                    {t("sendAllDate")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    onClick={() => {
                      const date = mostRecentKsaDateOnWeekday(4);
                      return sendVisitReportEmails({
                        date,
                        allUsers: true,
                        confirmText: t("emailConfirmAll").replace("{date}", date),
                      });
                    }}
                    disabled={emailBusy}
                  >
                    {t("sendThursday")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    onClick={() => {
                      const date = mostRecentKsaDateOnWeekday(6);
                      return sendVisitReportEmails({
                        date,
                        allUsers: true,
                        confirmText: t("emailConfirmAll").replace("{date}", date),
                      });
                    }}
                    disabled={emailBusy}
                  >
                    {t("sendSaturday")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    onClick={() => sendVisitReportEmails({
                      midnight: true,
                      confirmText: t("emailConfirmMidnight"),
                    })}
                    disabled={emailBusy}
                  >
                    {t("sendMidnight")}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {inactivityLog ? (
            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>{t("inactivityLogTitle")}</h2>
              </div>
              <p className="moduleHint">{t("inactivityLogHint")}</p>
              <h3 style={{ marginTop: "12px", fontSize: "15px" }}>{t("inactivitySent")}</h3>
              {(inactivityLog.sends || []).length === 0 ? (
                <p className="moduleHint">{t("inactivityNoSends")}</p>
              ) : (
                <ExportableTable filename="inactivity-emails" sheetName="Inactivity Emails" className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>{t("time")}</th>
                        <th>{t("userName")}</th>
                        <th>{t("transaction")}</th>
                        <th>{t("inactivityGap")}</th>
                        <th>{t("inactivityStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inactivityLog.sends.map((row) => (
                        <tr key={row.id}>
                          <td>{formatTime(row.sentAt)}</td>
                          <td>{row.userName}</td>
                          <td>
                            {row.type === "late_login_email"
                              ? t("inactivityTypeLateLogin")
                              : t("inactivityTypeInactivity")}
                          </td>
                          <td>{formatGapMinutes(row.gapMinutes)}</td>
                          <td>{row.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ExportableTable>
              )}
              <h3 style={{ marginTop: "16px", fontSize: "15px" }}>{t("inactivityChecks")}</h3>
              {(inactivityLog.checks || []).length === 0 && (inactivityLog.cycles || []).length === 0 ? (
                <p className="moduleHint">{t("inactivityNoChecks")}</p>
              ) : (
                <ExportableTable filename="inactivity-checks" sheetName="Inactivity Checks" className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>{t("time")}</th>
                        <th>{t("userName")}</th>
                        <th>{t("inactivityStatus")}</th>
                        <th>{t("inactivityReason")}</th>
                        <th>{t("inactivitySlot")}</th>
                        <th>{t("inactivityIdle")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(inactivityLog.checks || []).length
                        ? inactivityLog.checks.map((row, index) => (
                          <tr key={`${row.ranAt}-${row.userId}-${index}`}>
                            <td>{formatTime(row.ranAt)}</td>
                            <td>{row.userName}</td>
                            <td>{row.status}</td>
                            <td>{inactivityReasonLabel(row.reason, language)}</td>
                            <td>{row.slot ?? "—"}</td>
                            <td>{row.idleMinutes != null ? `${row.idleMinutes}m` : "—"}</td>
                          </tr>
                        ))
                        : (inactivityLog.cycles || []).map((row) => (
                          <tr key={row.id}>
                            <td>{formatTime(row.ranAt)}</td>
                            <td>—</td>
                            <td>{row.skipped ? "skipped" : `checked ${row.checked}`}</td>
                            <td>{inactivityReasonLabel(row.skipReason, language)}</td>
                            <td>—</td>
                            <td>—</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {error && error.includes("login") ? (
            <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
              <Link href="/" className="moduleInlineButton">Go to login</Link>
            </div>
          ) : null}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("totalEntries")}</span>
                  <strong>{report.visitCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalRouteDistance")}</span>
                  <strong>{formatNumber(report.totalRouteDistanceKm)} km</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("farFromCustomer")}</span>
                  <strong>{report.farFromCustomerCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("usersActive")}</span>
                  <strong>{report.userCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalWaiting")}</span>
                  <strong>{formatDurationMinutes(totalWaitingMinutes)}</strong>
                </section>
              </div>

              {displayUsers.map((entryUser) => {
                const userWaitingMinutes = sumWaitingMinutesFromTimeline(
                  entryUser.entries,
                  DEFAULT_TRANSIT_SPEED_KMH,
                );

                return (
                <section key={entryUser.userId} className="moduleSection">
                  <div className="moduleSectionHeader">
                    <h2>
                      {report?.canSendVisitReportEmail ? (
                        <label className="moduleCollectorCheckbox" style={{ display: "inline-flex", marginInlineEnd: "10px" }}>
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(entryUser.userId)}
                            onChange={() => toggleEmailUser(entryUser.userId)}
                            disabled={emailBusy}
                            aria-label={entryUser.userName}
                          />
                        </label>
                      ) : null}
                      {entryUser.userName}
                    </h2>
                    <span>
                      {entryUser.visitCount} {t("entries")}
                      {" · "}
                      {entryUser.farFromCustomerCount} {t("farFromCustomer")}
                      {" · "}
                      {t("routeTotal")}: {formatNumber(entryUser.totalRouteDistanceKm)} km
                      {" · "}
                      {t("waitingTotalShort")}: {formatDurationMinutes(userWaitingMinutes)}
                    </span>
                  </div>

                  {entryUser.activitySplit ? (
                    <table className="moduleTable visitDaySplitTable">
                      <thead>
                        <tr>
                          <th>{t("daySplitTitle")}</th>
                          <th>{t("splitCount")}</th>
                          <th>{t("splitValue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{t("visitWithoutOrder")}</td>
                          <td>{entryUser.activitySplit.visitWithoutOrderCount}</td>
                          <td>-</td>
                        </tr>
                        <tr>
                          <td>{t("newCustomerOrders")}</td>
                          <td>{entryUser.activitySplit.newCustomerOrderCount}</td>
                          <td>{formatSplitMoney(entryUser.activitySplit.newCustomerOrderValue)} SAR</td>
                        </tr>
                        <tr>
                          <td>{t("repeatCustomerOrders")}</td>
                          <td>{entryUser.activitySplit.repeatCustomerOrderCount}</td>
                          <td>{formatSplitMoney(entryUser.activitySplit.repeatCustomerOrderValue)} SAR</td>
                        </tr>
                        <tr>
                          <td>{t("collectionsSplit")}</td>
                          <td>{entryUser.activitySplit.collectionCount}</td>
                          <td>{formatSplitMoney(entryUser.activitySplit.collectionValue)} SAR</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : null}

                  <DayRouteMap
                    points={entryUser.routePoints || []}
                    idleGaps={entryUser.idleGaps || entryUser.daySummary?.idleGaps || []}
                    title={t("dayRoute")}
                    openLabel={t("openRouteMap")}
                    idleLegend={t("idleGpsLegend")}
                    unloggedLegend={t("unloggedIdleLegend")}
                    stopLegend={t("loggedStopLegend")}
                    mapsHint={t("mapsHint")}
                    longestIdleTitle={t("longestIdleTitle")}
                    openPlaceLabel={t("openThisPlace")}
                    openLongestIdleLabel={t("openLongestIdle")}
                    stopsTitle={t("routeStops")}
                    idleBubblesTitle={t("idleBubblesTitle")}
                    idleBubblesHint={t("idleBubblesHint")}
                    entries={entryUser.entries || []}
                    workingHoursTitle={t("workingHours")}
                  />

                  <div className="visitReportLegend" aria-label={t("tableLegend")}>
                    {VISIT_REPORT_ROW_LEGEND.map((item) => (
                      <span key={item.tone} className={`visitReportLegendItem visitReportRow-${item.tone}`}>
                        {item.label}
                      </span>
                    ))}
                  </div>
                  <ExportableTable filename={`daily-visit-report-${entryUser.userName || entryUser.userId}`} sheetName="Daily Visits" className="moduleTableWrap">
                    <table className="moduleTable">
                      <thead>
                        <tr>
                          <th>{t("sequence")}</th>
                          <th>{t("visitNumber")}</th>
                          <th>{t("time")}</th>
                          <th>{t("userName")}</th>
                          <th>{t("customer")}</th>
                          <th>{t("transaction")}</th>
                          <th>{t("distanceFromCustomer")}</th>
                          <th>{t("distanceFromPrevious")}</th>
                          <th>{t("coordinates")}</th>
                          <th>{t("area")}</th>
                          <th>{t("street")}</th>
                          <th>{t("speed")}</th>
                          <th title={t("waitingTimeHint")}>{t("waitingTime")}</th>
                          <th>{t("platform")}</th>
                          <th>{t("map")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(entryUser.entries || []).map((entry, entryIndex, entries) => (
                          <tr key={entry.id} className={visitReportRowClassName(entry, entryUser.idleGaps)}>
                            <td>{entry.visitSequence}</td>
                            <td>{entry.onSiteVisitNumber || "-"}</td>
                            <td>{formatTime(entry.savedAt)}</td>
                            <td>{entry.userName || entryUser.userName}</td>
                            <td>
                              {entry.customerName ? (
                                <>
                                  {entry.customerName}
                                  {entry.customerCode ? (
                                    <div className="moduleCode">{entry.customerCode}</div>
                                  ) : null}
                                </>
                              ) : "-"}
                            </td>
                            <td>
                              {entry.transactionLabel}
                              {entryDisplayAmount(entry) > 0 ? (
                                <div className="moduleCode">
                                  {entryDisplayAmount(entry).toLocaleString("en-US", { maximumFractionDigits: 2 })} SAR
                                </div>
                              ) : null}
                              {entry.logoutAutoClosed ? (
                                <div className="moduleCode">{t("autoClosed")}</div>
                              ) : null}
                              {entry.isFarFromCustomer ? (
                                <div className="moduleCode">{t("farBadge")}</div>
                              ) : null}
                            </td>
                            <td>
                              {!entry.hasEntryGps
                                ? t("noEntryGps")
                                : !entry.hasCustomerLocation
                                  ? t("noCustomerLocation")
                                  : `${formatNumber(entry.distanceFromCustomerKm)} km`}
                            </td>
                            <td>
                              {entry.distanceFromPreviousKm === null
                                ? "-"
                                : `${formatNumber(entry.distanceFromPreviousKm)} km`}
                            </td>
                            <td>{formatEntryCoordinates(entry)}</td>
                            <td>{entry.area || "-"}</td>
                            <td>{entry.street || "-"}</td>
                            <td>
                              {entry.speedKmh === null || entry.speedKmh === undefined
                                ? "-"
                                : `${formatNumber(entry.speedKmh, 1)} km/h`}
                            </td>
                            <td>
                              {(() => {
                                const waiting = resolveWaitingMinutesFromPreviousVisit(
                                  entryUser.entries,
                                  entryIndex,
                                  DEFAULT_TRANSIT_SPEED_KMH,
                                );
                                return waiting === null ? "-" : formatDurationMinutes(waiting);
                              })()}
                            </td>
                            <td>{entry.capturePlatformLabel || "-"}</td>
                            <td>
                              {entry.hasEntryGps ? (
                                <a
                                  className="moduleInlineButton"
                                  href={buildGoogleMapsPointUrl(entry.entryLatitude, entry.entryLongitude)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t("openMap")}
                                </a>
                              ) : "-"}
                            </td>
                          </tr>
                        ))}
                        {(entryUser.entries || []).length === 0 && (
                          <tr>
                            <td colSpan={13}>{t("noEntries")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </ExportableTable>
                </section>
                );
              })}

              {displayUsers.length === 0 && (
                <section className="moduleSection">
                  <div className="moduleHint">{t("noEntries")}</div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
