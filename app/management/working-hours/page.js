"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { formatKsaTime, formatWorkingHours, getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Working Hours", ar: "ساعات العمل" },
  subtitle: {
    en: "Daily salesman attendance and working hours from non-far visits around lunch",
    ar: "حضور المندوبين اليومي وساعات العمل من الزيارات القريبة حول الغداء",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading working hours...", ar: "جاري تحميل ساعات العمل..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  user: { en: "Salesman", ar: "المندوب" },
  allUsers: { en: "All salesmen", ar: "كل المندوبين" },
  noEntries: { en: "No attendance or field activity found for this date.", ar: "لا يوجد حضور أو نشاط ميداني في هذا التاريخ." },
  note: {
    en: "Working hours = first→last non-far stop before lunch out, plus first→last non-far stop after lunch in (from 08:00 KSA). Far stops are excluded. Login, logout, and GPS alone count as 0h.",
    ar: "ساعات العمل = من أول إلى آخر توقف غير بعيد قبل خروج الغداء، ومن أول إلى آخر توقف غير بعيد بعد عودة الغداء (من 08:00 بتوقيت السعودية). تُستبعد التوقفات البعيدة. تسجيل الدخول والخروج وGPS وحدها تُحسب 0 ساعة.",
  },
  usersActive: { en: "People listed", ar: "المدرجون" },
  loggedIn: { en: "Logged in", ar: "سجّلوا الدخول" },
  withHours: { en: "With hours", ar: "لديهم ساعات" },
  totalWorkingHours: { en: "Total working hours", ar: "إجمالي ساعات العمل" },
  nearStops: { en: "Near stops", ar: "توقفات قريبة" },
  farStops: { en: "Far stops", ar: "توقفات بعيدة" },
  colUser: { en: "Salesman", ar: "المندوب" },
  colRole: { en: "Role", ar: "الدور" },
  colLogin: { en: "Login", ar: "تسجيل الدخول" },
  colLunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  colLunchIn: { en: "Lunch in", ar: "عودة الغداء" },
  colLogout: { en: "Logout", ar: "تسجيل الخروج" },
  colWorkingHours: { en: "Working hours", ar: "ساعات العمل" },
  colNear: { en: "Near stops", ar: "قريبة" },
  colFar: { en: "Far stops", ar: "بعيدة" },
  colVisits: { en: "Visits", ar: "زيارات" },
  colOrders: { en: "Orders", ar: "طلبات" },
  colCollections: { en: "Collections", ar: "تحصيل" },
  autoClosed: { en: "Auto-closed", ar: "إغلاق تلقائي" },
  openVisitReport: { en: "Open daily visit report", ar: "فتح تقرير الزيارات اليومي" },
  totalFooter: { en: "Total", ar: "الإجمالي" },
};

function formatTime(value) {
  return formatKsaTime(value);
}

export default function WorkingHoursPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const router = useRouter();
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);

  usePopupMessages({ error });

  const userOptions = useMemo(
    () => (Array.isArray(report?.availableUsers) ? report.availableUsers : []),
    [report],
  );

  const rows = useMemo(
    () => (Array.isArray(report?.users) ? report.users : []),
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
          `/api/working-hours?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          60000,
        );

        if (cancelled) return;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load working hours.");
        }

        setReport(payload.report || null);
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load working hours.");
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
    return <SupabaseUnavailable />;
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <header className="moduleHeader">
            <div>
              <AccessibleHeaderLink href="/management">{t("back")}</AccessibleHeaderLink>
              <h1>{t("title")}</h1>
              <p>{t("subtitle")}</p>
            </div>
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
          </header>

          <div className="moduleToolbar">
            <label>
              {t("date")}
              <input
                type="date"
                className="moduleInput"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
            </label>
            <label>
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

          <p className="moduleHint">{t("note")}</p>

          {loading ? <p>{t("loading")}</p> : null}
          {!loading && report ? (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("usersActive")}</span>
                  <strong>{report.totals?.userCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("loggedIn")}</span>
                  <strong>{report.totals?.loggedInCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("withHours")}</span>
                  <strong>{report.totals?.withHoursCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalWorkingHours")}</span>
                  <strong>{formatWorkingHours(report.totals?.totalWorkingMinutes)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("nearStops")}</span>
                  <strong>{report.totals?.totalNearStops || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("farStops")}</span>
                  <strong>{report.totals?.totalFarStops || 0}</strong>
                </section>
              </div>

              <section className="moduleSection">
                <ExportableTable filename={`working-hours-${reportDate}`} sheetName="Working Hours" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th>{t("colUser")}</th>
                        <th>{t("colRole")}</th>
                        <th>{t("colLogin")}</th>
                        <th>{t("colLunchOut")}</th>
                        <th>{t("colLunchIn")}</th>
                        <th>{t("colLogout")}</th>
                        <th className="moduleBiTotalCol">{t("colWorkingHours")}</th>
                        <th>{t("colNear")}</th>
                        <th>{t("colFar")}</th>
                        <th>{t("colVisits")}</th>
                        <th>{t("colOrders")}</th>
                        <th>{t("colCollections")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.userId}>
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
                          </td>
                          <td>{row.role || "-"}</td>
                          <td>{formatTime(row.loginAt)}</td>
                          <td>{formatTime(row.lunchOutAt)}</td>
                          <td>{formatTime(row.lunchInAt)}</td>
                          <td>
                            {formatTime(row.logoutAt)}
                            {row.logoutAutoClosed ? (
                              <div className="moduleCode">{t("autoClosed")}</div>
                            ) : null}
                          </td>
                          <td className="moduleBiTotalCol">
                            {row.workingHoursLabel || formatWorkingHours(row.workingHoursMinutes)}
                          </td>
                          <td>{row.nearStopCount || 0}</td>
                          <td>{row.farStopCount || 0}</td>
                          <td>{row.visitReports || 0}</td>
                          <td>{row.ordersSubmitted || 0}</td>
                          <td>{row.collections || 0}</td>
                        </tr>
                      ))}
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={12}>{t("noEntries")}</td>
                        </tr>
                      ) : (
                        <tr>
                          <td colSpan={6}><strong>{t("totalFooter")}</strong></td>
                          <td className="moduleBiTotalCol">
                            <strong>{formatWorkingHours(report.totals?.totalWorkingMinutes)}</strong>
                          </td>
                          <td><strong>{report.totals?.totalNearStops || 0}</strong></td>
                          <td><strong>{report.totals?.totalFarStops || 0}</strong></td>
                          <td colSpan={3} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ExportableTable>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
