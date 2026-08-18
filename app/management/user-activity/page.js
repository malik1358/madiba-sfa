"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { formatKsaDateTime, formatWorkingHours, getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "User Activity", ar: "نشاط المستخدمين" },
  subtitle: {
    en: "Login time, visits, collections, orders, and travel distance by user",
    ar: "وقت تسجيل الدخول والزيارات والتحصيل والطلبات ومسافة التنقل حسب المستخدم",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading user activity...", ar: "جاري تحميل نشاط المستخدمين..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  user: { en: "User", ar: "المستخدم" },
  allUsers: { en: "All users", ar: "كل المستخدمين" },
  noEntries: { en: "No user activity found for this date.", ar: "لا يوجد نشاط للمستخدمين في هذا التاريخ." },
  usersActive: { en: "Active users", ar: "المستخدمون النشطون" },
  totalVisits: { en: "Visit reports", ar: "تقارير الزيارة" },
  totalCollections: { en: "Collections", ar: "التحصيل" },
  totalOrders: { en: "Orders submitted", ar: "الطلبات المرسلة" },
  totalDistance: { en: "Total distance", ar: "إجمالي المسافة" },
  totalWorkingHours: { en: "Total working hours", ar: "إجمالي ساعات العمل" },
  note: {
    en: "Login time uses morning attendance when available, otherwise last sign-in or first activity. Working hours = login to lunch out plus lunch in to logout. Distance is straight-line GPS route, not road distance.",
    ar: "وقت الدخول يعتمد على حضور الصباح عند توفره، وإلا آخر تسجيل دخول أو أول نشاط. ساعات العمل = من تسجيل الدخول إلى خروج الغداء، ومن عودة الغداء إلى تسجيل الخروج. المسافة خط مستقيم GPS وليست مسافة الطريق.",
  },
  colUser: { en: "User", ar: "المستخدم" },
  colRole: { en: "Role", ar: "الدور" },
  colLogin: { en: "Login", ar: "تسجيل الدخول" },
  colLogout: { en: "Logout", ar: "تسجيل الخروج" },
  colLastActivity: { en: "Last activity", ar: "آخر نشاط" },
  colVisits: { en: "Visits", ar: "الزيارات" },
  colCollections: { en: "Collections", ar: "التحصيل" },
  colOrders: { en: "Orders", ar: "الطلبات" },
  colDrafts: { en: "Drafts", ar: "المسودات" },
  colProspects: { en: "Prospects", ar: "العملاء المحتملون" },
  colDistance: { en: "Distance (km)", ar: "المسافة (كم)" },
  colGpsPings: { en: "GPS pings", ar: "نبضات GPS" },
  colLunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  colLunchIn: { en: "Lunch in", ar: "عودة الغداء" },
  colWorkingHours: { en: "Working hours", ar: "ساعات العمل" },
  legendTitle: { en: "Status (today, working hours)", ar: "الحالة (اليوم، ساعات العمل)" },
  legendRed: { en: "Red — not logged in today", ar: "أحمر — لم يسجل الدخول اليوم" },
  legendOrange: { en: "Orange — no transaction in last 30 min", ar: "برتقالي — لا معاملات خلال آخر 30 دقيقة" },
  legendGreen: { en: "Green — transaction in last 30 min", ar: "أخضر — معاملة خلال آخر 30 دقيقة" },
  autoClosed: { en: "Auto-closed", ar: "إغلاق تلقائي" },
  openVisitReport: { en: "Open daily visit report", ar: "فتح تقرير الزيارات اليومي" },
  notLoggedIn: { en: "Not logged in", ar: "لم يسجل الدخول" },
  idleNow: { en: "Idle now", ar: "خامل الآن" },
  activeNow: { en: "Active now", ar: "نشط الآن" },
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatDateTime(value) {
  return formatKsaDateTime(value);
}

function activityRowClass(status) {
  if (status === "not_logged_in") return "moduleUserActivityRow--red";
  if (status === "idle") return "moduleUserActivityRow--orange";
  if (status === "active") return "moduleUserActivityRow--green";
  return "";
}

export default function UserActivityPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const router = useRouter();
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);

  const userOptions = useMemo(
    () => (Array.isArray(report?.availableUsers) ? report.availableUsers : []),
    [report],
  );

  function openUserVisitReport(row) {
    const params = new URLSearchParams({ date: reportDate, userId: row.userId });
    router.push(`/management/daily-visit-report?${params.toString()}`);
  }

  useEffect(() => {
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

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;

        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const params = new URLSearchParams({ date: reportDate });
        if (userId) params.set("userId", userId);

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/user-activity?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          45000,
        );

        if (cancelled) return;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load user activity.");
        }

        setReport(payload);
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load user activity.");
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
  }, [reportDate, userId]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="User activity unavailable"
        message="The user activity report needs Supabase credentials."
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
              <Link href="/management/daily-visit-report" className="moduleBackLink">Daily Visit Report</Link>
              <Link href="/management/gps-map" className="moduleBackLink">GPS Map</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleHint">{t("note")}</div>

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
          </section>

          {error && <div className="moduleError">{error}</div>}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("usersActive")}</span>
                  <strong>{report.userCount || 0}</strong>
                </section>
                {report.isToday && (
                  <>
                    <section className="moduleMetricCard moduleUserActivityMetric--red">
                      <span>{t("notLoggedIn")}</span>
                      <strong>{report.totals?.notLoggedIn || 0}</strong>
                    </section>
                    <section className="moduleMetricCard moduleUserActivityMetric--orange">
                      <span>{t("idleNow")}</span>
                      <strong>{report.totals?.idleNow || 0}</strong>
                    </section>
                    <section className="moduleMetricCard moduleUserActivityMetric--green">
                      <span>{t("activeNow")}</span>
                      <strong>{report.totals?.activeNow || 0}</strong>
                    </section>
                  </>
                )}
                <section className="moduleMetricCard">
                  <span>{t("totalVisits")}</span>
                  <strong>{report.totals?.visitReports || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalCollections")}</span>
                  <strong>{report.totals?.collections || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalOrders")}</span>
                  <strong>{report.totals?.ordersSubmitted || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalDistance")}</span>
                  <strong>{formatNumber(report.totals?.routeDistanceKm)} km</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalWorkingHours")}</span>
                  <strong>{formatWorkingHours(report.totals?.workingHoursMinutes)}</strong>
                </section>
              </div>

              {report.isToday && (
                <div className="moduleUserActivityLegend">
                  <strong>{t("legendTitle")}</strong>
                  <span className="moduleUserActivityLegendItem moduleUserActivityLegendItem--red">{t("legendRed")}</span>
                  <span className="moduleUserActivityLegendItem moduleUserActivityLegendItem--orange">{t("legendOrange")}</span>
                  <span className="moduleUserActivityLegendItem moduleUserActivityLegendItem--green">{t("legendGreen")}</span>
                </div>
              )}

              <section className="moduleSection">
                <div className="moduleTableWrap">
                  <table className="moduleTable moduleUserActivityTable">
                    <thead>
                      <tr>
                        <th>{t("colUser")}</th>
                        <th>{t("colRole")}</th>
                        <th>{t("colLogin")}</th>
                        <th>{t("colLogout")}</th>
                        <th>{t("colLunchOut")}</th>
                        <th>{t("colLunchIn")}</th>
                        <th>{t("colWorkingHours")}</th>
                        <th>{t("colLastActivity")}</th>
                        <th>{t("colVisits")}</th>
                        <th>{t("colCollections")}</th>
                        <th>{t("colOrders")}</th>
                        <th>{t("colDrafts")}</th>
                        <th>{t("colProspects")}</th>
                        <th>{t("colDistance")}</th>
                        <th>{t("colGpsPings")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.users || []).map((row) => (
                        <tr key={row.userId} className={activityRowClass(row.activityStatus)}>
                          <td>
                            <button
                              type="button"
                              className="moduleUserActivityUserLink"
                              title={t("openVisitReport")}
                              onClick={() => openUserVisitReport(row)}
                            >
                              <strong>{row.userName}</strong>
                            </button>
                            {row.salesmanCode ? <div className="moduleCode">{row.salesmanCode}</div> : null}
                            {row.email ? <div className="moduleCode">{row.email}</div> : null}
                          </td>
                          <td>{row.role || "-"}</td>
                          <td>{formatDateTime(row.loginAt)}</td>
                          <td>
                            {formatDateTime(row.logoutAt)}
                            {row.logoutAutoClosed ? (
                              <div className="moduleCode">{t("autoClosed")}</div>
                            ) : null}
                          </td>
                          <td>{formatDateTime(row.lunchOutAt)}</td>
                          <td>{formatDateTime(row.lunchInAt)}</td>
                          <td>{row.workingHoursLabel || formatWorkingHours(row.workingHoursMinutes)}</td>
                          <td>{formatDateTime(row.lastActivityAt)}</td>
                          <td>{row.visitReports || 0}</td>
                          <td>{row.collections || 0}</td>
                          <td>{row.ordersSubmitted || 0}</td>
                          <td>{row.ordersDraft || 0}</td>
                          <td>{row.prospectFollowUps || 0}</td>
                          <td>{formatNumber(row.routeDistanceKm)}</td>
                          <td>{row.gpsPingCount || 0}</td>
                        </tr>
                      ))}
                      {(report.users || []).length === 0 && (
                        <tr>
                          <td colSpan={15}>{t("noEntries")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
