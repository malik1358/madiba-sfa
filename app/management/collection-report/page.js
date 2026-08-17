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

const TEXT = {
  title: { en: "Collection Route Report", ar: "تقرير مسار التحصيل" },
  subtitle: {
    en: "Date-wise collection visits with GPS distance between customers",
    ar: "زيارات التحصيل حسب التاريخ مع المسافة بين العملاء",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  collections: { en: "Collections", ar: "التحصيلات" },
  loading: { en: "Loading collection route report...", ar: "جاري تحميل تقرير مسار التحصيل..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  collector: { en: "Collector", ar: "المحصل" },
  allCollectors: { en: "All collectors", ar: "كل المحصلين" },
  refresh: { en: "Refresh", ar: "تحديث" },
  noVisits: { en: "No collection visits found for this date.", ar: "لا توجد زيارات تحصيل في هذا التاريخ." },
  gpsNote: {
    en: "GPS is captured automatically when a collection visit is saved. Older visits saved before this update may not have GPS.",
    ar: "يتم التقاط GPS تلقائياً عند حفظ زيارة التحصيل. الزيارات القديمة قد لا تحتوي GPS.",
  },
  migrationPending: {
    en: "GPS columns are not applied in Supabase yet. Run sql/add_collection_visit_gps.sql in SQL Editor to enable GPS distances.",
    ar: "أعمدة GPS غير مُطبقة في Supabase بعد. نفّذ sql/add_collection_visit_gps.sql في SQL Editor لتفعيل مسافات GPS.",
  },
  totalVisits: { en: "Total visits", ar: "إجمالي الزيارات" },
  totalDistance: { en: "Total route distance", ar: "إجمالي مسافة المسار" },
  collectorsActive: { en: "Collectors active", ar: "المحصلون النشطون" },
  userName: { en: "User name", ar: "اسم المستخدم" },
  gpsEstimated: { en: "Estimated", ar: "تقديري" },
  gpsWhyNone: {
    en: "No GPS usually means: (1) visit saved before GPS feature was live, (2) browser location was blocked, or (3) Supabase GPS columns were not applied yet. New visits after allowing location should capture GPS.",
    ar: "غياب GPS يعني عادة: (1) الزيارة قبل تفعيل GPS، (2) المتصفح منع الموقع، أو (3) أعمدة GPS غير مُطبقة في Supabase.",
  },
  time: { en: "Time", ar: "الوقت" },
  sequence: { en: "#", ar: "#" },
  customer: { en: "Customer", ar: "العميل" },
  outcome: { en: "Outcome", ar: "النتيجة" },
  amount: { en: "Amount", ar: "المبلغ" },
  gps: { en: "GPS", ar: "GPS" },
  distance: { en: "Distance from previous", ar: "المسافة من السابق" },
  map: { en: "Map", ar: "الخريطة" },
  visits: { en: "visits", ar: "زيارات" },
  gpsCaptured: { en: "GPS captured", ar: "تم التقاط GPS" },
  routeTotal: { en: "Route total", ar: "إجمالي المسار" },
  noGps: { en: "No GPS", ar: "لا GPS" },
  openMap: { en: "Open", ar: "فتح" },
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function CollectionReportPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectorId, setCollectorId] = useState("");
  const [report, setReport] = useState(null);

  const collectorOptions = useMemo(
    () => (Array.isArray(report?.availableCollectors) ? report.availableCollectors : []),
    [report],
  );

  useEffect(() => {
    async function loadReport() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const params = new URLSearchParams({ date: reportDate });
        if (collectorId) params.set("collectorId", collectorId);

        const response = await fetch(`/api/payment-collections/report?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load collection route report.");
        }

        setReport(payload);
      } catch (err) {
        setError(err.message || "Unable to load collection route report.");
        setReport(null);
      } finally {
        setLoading(false);
      }
    }

    loadReport();
  }, [reportDate, collectorId]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Collection report unavailable"
        message="The collection route report needs Supabase credentials."
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
              <Link href="/management/payment-collections" className="moduleBackLink">{t("collections")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleHint">{t("gpsNote")}</div>
          {!loading && report && report.gpsVisitCount === 0 && report.visitCount > 0 && (
            <div className="moduleHint">{t("gpsWhyNone")}</div>
          )}

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("date")}
                <input
                  className="moduleInput"
                  type="date"
                  value={reportDate}
                  onChange={(event) => {
                    setCollectorId("");
                    setReportDate(event.target.value);
                  }}
                />
              </label>
              <label className="moduleField">
                {t("collector")}
                <select
                  className="moduleInput"
                  value={collectorId}
                  onChange={(event) => setCollectorId(event.target.value)}
                >
                  <option value="">{t("allCollectors")}</option>
                  {collectorOptions.map((collector) => (
                    <option key={collector.collectorId} value={collector.collectorId}>
                      {collector.collectorName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {error && <div className="moduleError">{error}</div>}
          {!loading && report?.migrationHint && (
            <div className="moduleWarning">{report.migrationHint}</div>
          )}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("totalVisits")}</span>
                  <strong>{report.visitCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalDistance")}</span>
                  <strong>{formatNumber(report.totalDistanceKm)} km</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("collectorsActive")}</span>
                  <strong>{report.collectorCount || 0}</strong>
                </section>
              </div>

              {(report.collectors || []).map((collector) => (
                <section key={collector.collectorId} className="moduleSection">
                  <div className="moduleSectionHeader">
                    <h2>{collector.collectorName}</h2>
                    <span>
                      {collector.visitCount} {t("visits")}
                      {" · "}
                      {collector.gpsVisitCount} {t("gpsCaptured")}
                      {" · "}
                      {t("routeTotal")}: {formatNumber(collector.totalDistanceKm)} km
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
                          <th>{t("outcome")}</th>
                          <th>{t("amount")}</th>
                          <th>{t("gps")}</th>
                          <th>{t("distance")}</th>
                          <th>{t("map")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(collector.visits || []).map((visit) => (
                          <tr key={visit.id}>
                            <td>{visit.visitSequence}</td>
                            <td>{formatTime(visit.savedAt)}</td>
                            <td>{visit.userName || collector.collectorName}</td>
                            <td>
                              {visit.customerName}
                              <div className="moduleCode">{visit.customerCode}</div>
                            </td>
                            <td>{visit.visitOutcomeLabel || visit.visitOutcome}</td>
                            <td>{formatAmount(visit.amountReceived)}</td>
                            <td>
                              {visit.hasGps
                                ? `${Number(visit.latitude).toFixed(5)}, ${Number(visit.longitude).toFixed(5)}${visit.gpsSource === "activity_log_fallback" ? ` (${t("gpsEstimated")})` : ""}`
                                : t("noGps")}
                            </td>
                            <td>
                              {visit.distanceFromPreviousKm === null
                                ? "-"
                                : `${formatNumber(visit.distanceFromPreviousKm)} km`}
                            </td>
                            <td>
                              {visit.hasGps ? (
                                <a
                                  className="moduleInlineButton"
                                  href={buildGoogleMapsPointUrl(visit.latitude, visit.longitude)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t("openMap")}
                                </a>
                              ) : "-"}
                            </td>
                          </tr>
                        ))}
                        {(collector.visits || []).length === 0 && (
                          <tr>
                            <td colSpan={9}>{t("noVisits")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              {(report.collectors || []).length === 0 && (
                <section className="moduleSection">
                  <div className="moduleHint">{t("noVisits")}</div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
