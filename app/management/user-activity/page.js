"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, waitForInitialSession } from "../../lib/authSession";
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
  note: {
    en: "Login time uses morning attendance when available, otherwise last sign-in or first activity. Distance is straight-line GPS route, not road distance.",
    ar: "وقت الدخول يعتمد على حضور الصباح عند توفره، وإلا آخر تسجيل دخول أو أول نشاط. المسافة خط مستقيم GPS وليست مسافة الطريق.",
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
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserActivityPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);

  const userOptions = useMemo(
    () => (Array.isArray(report?.availableUsers) ? report.availableUsers : []),
    [report],
  );

  useEffect(() => {
    let cancelled = false;

    const safetyTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) => current || "Report load timed out. Please login and refresh the page.");
    }, 15000);

    async function loadReport() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const session = await waitForInitialSession(supabase);
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
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
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
              </div>

              <section className="moduleSection">
                <div className="moduleTableWrap">
                  <table className="moduleTable moduleUserActivityTable">
                    <thead>
                      <tr>
                        <th>{t("colUser")}</th>
                        <th>{t("colRole")}</th>
                        <th>{t("colLogin")}</th>
                        <th>{t("colLogout")}</th>
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
                        <tr key={row.userId}>
                          <td>
                            <strong>{row.userName}</strong>
                            {row.salesmanCode ? <div className="moduleCode">{row.salesmanCode}</div> : null}
                            {row.email ? <div className="moduleCode">{row.email}</div> : null}
                          </td>
                          <td>{row.role || "-"}</td>
                          <td>{formatDateTime(row.loginAt)}</td>
                          <td>{formatDateTime(row.logoutAt)}</td>
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
                          <td colSpan={12}>{t("noEntries")}</td>
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
