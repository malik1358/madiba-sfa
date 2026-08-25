"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import {
  DEFAULT_TRANSIT_SPEED_KMH,
  TRANSIT_SPEED_OPTIONS_KMH,
  applyReverseGeocoding,
  buildGoogleMapsPointUrl,
  buildGpsActivityNote,
  formatDurationMinutes,
  resolveWaitingMinutesFromPrevious,
  resolveGpsCapturePlatform,
  sumWaitingMinutesFromTimeline,
} from "../../lib/geo";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { useReverseGeocodeCache } from "../../hooks/useReverseGeocodeCache";
import { getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

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
    en: "Elapsed time minus estimated driving time at the assumed speed below.",
    ar: "الوقت المنقضي ناقص وقت القيادة التقديري بالسرعة المفترضة أدناه.",
  },
  transitSpeed: { en: "Assumed driving speed", ar: "سرعة القيادة المفترضة" },
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
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);
  const [urlParamsApplied, setUrlParamsApplied] = useState(false);
  const [transitSpeedKmh, setTransitSpeedKmh] = useState(DEFAULT_TRANSIT_SPEED_KMH);

  usePopupMessages({ error });

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
      (total, entryUser) => total + sumWaitingMinutesFromTimeline(entryUser.entries, transitSpeedKmh),
      0,
    );
  }, [displayUsers, transitSpeedKmh]);

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
              <label className="moduleField">
                {t("transitSpeed")}
                <select
                  className="moduleInput"
                  value={transitSpeedKmh}
                  onChange={(event) => setTransitSpeedKmh(Number(event.target.value))}
                >
                  {TRANSIT_SPEED_OPTIONS_KMH.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed} km/h
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

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
                  transitSpeedKmh,
                );

                return (
                <section key={entryUser.userId} className="moduleSection">
                  <div className="moduleSectionHeader">
                    <h2>{entryUser.userName}</h2>
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
                          <tr key={entry.id}>
                            <td>{entry.visitSequence}</td>
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
                            <td>{entry.area || "-"}</td>
                            <td>{entry.street || "-"}</td>
                            <td>
                              {entry.speedKmh === null || entry.speedKmh === undefined
                                ? "-"
                                : `${formatNumber(entry.speedKmh, 1)} km/h`}
                            </td>
                            <td>
                              {(() => {
                                const waiting = resolveWaitingMinutesFromPrevious(
                                  entry,
                                  entryIndex > 0 ? entries[entryIndex - 1] : null,
                                  transitSpeedKmh,
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
                  </div>
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
