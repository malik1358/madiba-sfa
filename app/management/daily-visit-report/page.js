"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { buildGoogleMapsPointUrl } from "../../lib/geo";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchJsonWithTimeout, waitForInitialSession } from "../../lib/authSession";

const TEXT = {
  title: { en: "Daily Visit Report", ar: "تقرير الزيارات اليومي" },
  subtitle: {
    en: "User-wise visits and orders with GPS distance from customer location",
    ar: "زيارات وطلبات حسب المستخدم مع مسافة GPS من موقع العميل",
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
  map: { en: "Map", ar: "الخريطة" },
  openMap: { en: "Open", ar: "فتح" },
  noCustomerLocation: { en: "No customer location", ar: "لا موقع للعميل" },
  noEntryGps: { en: "No entry GPS", ar: "لا GPS للإدخال" },
  farBadge: { en: "Far", ar: "بعيد" },
  entries: { en: "entries", ar: "إدخالات" },
  routeTotal: { en: "Route total", ar: "إجمالي المسار" },
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function DailyVisitReportPage() {
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
    }, 12000);

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
          `/api/daily-visit-report?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
        );

        if (cancelled) return;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load daily visit report.");
        }

        setReport(payload);
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
              <Link href="/management/collection-report" className="moduleBackLink">Collection Report</Link>
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
          </section>

          {error && <div className="moduleError">{error}</div>}
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
              </div>

              {(report.users || []).map((entryUser) => (
                <section key={entryUser.userId} className="moduleSection">
                  <div className="moduleSectionHeader">
                    <h2>{entryUser.userName}</h2>
                    <span>
                      {entryUser.visitCount} {t("entries")}
                      {" · "}
                      {entryUser.farFromCustomerCount} {t("farFromCustomer")}
                      {" · "}
                      {t("routeTotal")}: {formatNumber(entryUser.totalRouteDistanceKm)} km
                    </span>
                  </div>

                  <div className="moduleTableWrap">
                    <table className="moduleTable">
                      <thead>
                        <tr>
                          <th>{t("sequence")}</th>
                          <th>{t("time")}</th>
                          <th>{t("userName")}</th>
                          <th>{t("customer")}</th>
                          <th>{t("transaction")}</th>
                          <th>{t("distanceFromCustomer")}</th>
                          <th>{t("distanceFromPrevious")}</th>
                          <th>{t("map")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(entryUser.entries || []).map((entry) => (
                          <tr key={entry.id}>
                            <td>{entry.visitSequence}</td>
                            <td>{formatTime(entry.savedAt)}</td>
                            <td>{entry.userName || entryUser.userName}</td>
                            <td>
                              {entry.customerName}
                              <div className="moduleCode">{entry.customerCode}</div>
                            </td>
                            <td>
                              {entry.transactionLabel}
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
                            <td colSpan={8}>{t("noEntries")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              {(report.users || []).length === 0 && (
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
