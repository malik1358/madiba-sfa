"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { buildGoogleMapsPointUrl } from "../../lib/geo";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "Collection Route Report", ar: "تقرير مسار التحصيل" },
  subtitle: {
    en: "Payment collection visits from the Collections screen, including both collectors and salesmen.",
    ar: "زيارات تحصيل المدفوعات من شاشة التحصيل، تشمل المحصلين والمندوبين.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  collections: { en: "Collections", ar: "التحصيلات" },
  loading: { en: "Loading collection route report...", ar: "جاري تحميل تقرير مسار التحصيل..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  collector: { en: "Collector / Salesman", ar: "المحصل / المندوب" },
  allCollectors: { en: "All collectors and salesmen", ar: "كل المحصلين والمندوبين" },
  userRole: { en: "User type", ar: "نوع المستخدم" },
  allUserRoles: { en: "All user types", ar: "كل أنواع المستخدمين" },
  collectorsOnly: { en: "Collectors only", ar: "المحصلون فقط" },
  salesmenOnly: { en: "Salesmen only", ar: "المندوبون فقط" },
  refresh: { en: "Refresh", ar: "تحديث" },
  noVisits: {
    en: "No payment collection visits found for this date. Salesman visits and orders appear on Daily Visit Report.",
    ar: "لا توجد زيارات تحصيل مدفوعات في هذا التاريخ. زيارات المندوبين والطلبات تظهر في تقرير الزيارات اليومي.",
  },
  gpsNote: {
    en: "GPS is captured automatically when a collection visit is saved. Older visits saved before this update may not have GPS.",
    ar: "يتم التقاط GPS تلقائياً عند حفظ زيارة التحصيل. الزيارات القديمة قد لا تحتوي GPS.",
  },
  migrationPending: {
    en: "GPS columns are not applied in Supabase yet. Run sql/add_collection_visit_gps.sql in SQL Editor to enable GPS distances.",
    ar: "أعمدة GPS غير مُطبقة في Supabase بعد. نفّذ sql/add_collection_visit_gps.sql في SQL Editor لتفعيل مسافات GPS.",
  },
  totalVisits: { en: "Total visits", ar: "إجمالي الزيارات" },
  uniqueCustomers: { en: "Unique customers visited", ar: "عملاء مختلفون تمت زيارتهم" },
  totalDistance: { en: "Total route distance", ar: "إجمالي مسافة المسار" },
  collectorsActive: { en: "Users active", ar: "المستخدمون النشطون" },
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
  nextVisitDate: { en: "Next Visit", ar: "الزيارة القادمة" },
  amount: { en: "Amount", ar: "المبلغ" },
  gps: { en: "GPS", ar: "GPS" },
  distance: { en: "Distance from previous", ar: "المسافة من السابق" },
  speed: { en: "Speed from previous", ar: "السرعة من السابق" },
  map: { en: "Map", ar: "الخريطة" },
  visits: { en: "visits", ar: "زيارات" },
  uniqueCustomersShort: { en: "unique customers", ar: "عملاء مختلفون" },
  gpsCaptured: { en: "GPS captured", ar: "تم التقاط GPS" },
  routeTotal: { en: "Route total", ar: "إجمالي المسار" },
  noGps: { en: "No GPS", ar: "لا GPS" },
  openMap: { en: "Open", ar: "فتح" },
  viewReport: { en: "View Report", ar: "عرض التقرير" },
  visitReportTitle: { en: "Collection Visit Report", ar: "تقرير زيارة التحصيل" },
  whatsappSummary: { en: "WhatsApp summary", ar: "ملخص الواتساب" },
  priorityCustomer: { en: "Priority customer visit", ar: "زيارة عميل ذو أولوية" },
  priorityYes: { en: "Yes — higher collection probability", ar: "نعم — احتمالية تحصيل أعلى" },
  priorityNo: { en: "No — lower priority / not recorded", ar: "لا — أولوية أقل / غير مسجل" },
  queuePriority: { en: "Queue priority", ar: "أولوية الزيارة" },
  probability: { en: "Payment probability", ar: "احتمالية التحصيل" },
  copySummary: { en: "Copy summary", ar: "نسخ الملخص" },
  copied: { en: "Copied", ar: "تم النسخ" },
  close: { en: "Close", ar: "إغلاق" },
  summaryReconstructed: {
    en: "Rebuilt from saved visit data. Priority details are only exact for visits saved after the latest update.",
    ar: "أُعيد بناؤه من بيانات الزيارة المحفوظة. تفاصيل الأولوية دقيقة فقط للزيارات المحفوظة بعد آخر تحديث.",
  },
  notRecorded: { en: "Not recorded", ar: "غير مسجل" },
  priorityEstimated: { en: "Estimated from outstanding queue", ar: "تقدير من قائمة التحصيل" },
  priorityRecorded: { en: "Recorded at visit save", ar: "مسجل عند حفظ الزيارة" },
  queueCompliance: { en: "Route compliance", ar: "الالتزام بالمسار" },
  complianceOnPriority: { en: "On priority — visited a top-ranked customer for this visit order", ar: "ضمن الأولوية — زار عميلاً ذا ترتيب مناسب لهذه الزيارة" },
  complianceSlightlyDelayed: { en: "Slightly off — customer was a few places lower in queue", ar: "انحراف بسيط — العميل كان أدنى قليلاً في القائمة" },
  complianceOffPriority: { en: "Off priority — collector skipped many higher-ranked customers", ar: "خارج الأولوية — تم تجاوز عملاء أعلى في القائمة" },
  complianceUnknown: { en: "Queue rank unavailable for this visit", ar: "ترتيب القائمة غير متاح لهذه الزيارة" },
  visitOrderVsQueue: { en: "Visit # vs queue rank", ar: "رقم الزيارة مقابل ترتيب القائمة" },
  scheduledRevisitOnly: { en: "Scheduled revisit (not in due queue rank)", ar: "زيارة مجدولة (ليست ضمن ترتيب القائمة المستحقة)" },
  area: { en: "Area", ar: "المنطقة" },
  street: { en: "Street", ar: "الشارع" },
  lunchOut: { en: "Lunch out", ar: "خروج استراحة الغداء" },
  lunchIn: { en: "Lunch in", ar: "العودة من استراحة الغداء" },
  daySummaryTitle: { en: "Daily visit summary", ar: "ملخص الزيارات اليومي" },
  collectorDaySummaryTitle: { en: "Route summary", ar: "ملخص المسار" },
};

function formatNumber(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(value) {
  const input = String(value || "").trim();
  if (!input) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function formatProbabilityLabel(label, t) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  if (!normalized || normalized === "n/a") return t("notRecorded");
  return String(label);
}

function formatQueueCompliance(visit, t) {
  if (visit.isScheduledRevisit && !visit.queuePriority) return t("scheduledRevisitOnly");
  if (visit.queueCompliance === "on_priority") return t("complianceOnPriority");
  if (visit.queueCompliance === "slightly_delayed") return t("complianceSlightlyDelayed");
  if (visit.queueCompliance === "off_priority") return t("complianceOffPriority");
  return t("complianceUnknown");
}

function formatVisitOrderVsQueue(visit) {
  if (!visit.visitNumberForDay || !visit.queuePriority) return "-";
  return `#${visit.visitNumberForDay} visit · queue #${visit.queuePriority}`;
}

function isLunchTimelineRow(row) {
  return row?.rowType === "lunch";
}

function formatTimelineEventLabel(row, t) {
  if (row.entryType === "LUNCH_BREAK_OUT") return t("lunchOut");
  if (row.entryType === "LUNCH_BREAK_IN") return t("lunchIn");
  return row.eventLabel || "-";
}

function DaySummaryBox({ summary, language, title }) {
  if (!summary?.lines?.length) return null;
  const lines = language === "ar" ? (summary.linesAr || summary.lines) : summary.lines;

  return (
    <section className="moduleDaySummary" aria-label={title}>
      <h3>{title}</h3>
      <ul className="moduleDaySummaryList">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export default function CollectionReportPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [collectorId, setCollectorId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [report, setReport] = useState(null);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");

  const collectorOptions = useMemo(
    () => (Array.isArray(report?.availableCollectors) ? report.availableCollectors : []),
    [report],
  );

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
        if (collectorId) params.set("collectorId", collectorId);
        if (userRole) params.set("userRole", userRole);

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/payment-collections/report?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          45000,
        );

        if (cancelled) return;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load collection route report.");
        }

        setReport(payload);
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load collection route report.");
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
  }, [reportDate, collectorId, userRole]);

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
              <AccessibleHeaderLink moduleKey="dailyVisitReport" href="/management/daily-visit-report" className="moduleBackLink">
                Daily Visit Report
              </AccessibleHeaderLink>
              <AccessibleHeaderLink moduleKey="paymentCollections" href="/management/payment-collections" className="moduleBackLink">
                {t("collections")}
              </AccessibleHeaderLink>
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
                {t("userRole")}
                <select
                  className="moduleInput"
                  value={userRole}
                  onChange={(event) => {
                    setCollectorId("");
                    setUserRole(event.target.value);
                  }}
                >
                  <option value="">{t("allUserRoles")}</option>
                  <option value="collector">{t("collectorsOnly")}</option>
                  <option value="salesman">{t("salesmenOnly")}</option>
                </select>
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

          {error && (
            <div className="moduleError">
              {error}
              {error.includes("login") ? (
                <div style={{ marginTop: "8px" }}>
                  <Link href="/" className="moduleInlineButton">Go to login</Link>
                </div>
              ) : null}
            </div>
          )}
          {!loading && report?.migrationHint && (
            <div className="moduleWarning">{report.migrationHint}</div>
          )}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              <DaySummaryBox
                summary={report.daySummary}
                language={language}
                title={t("daySummaryTitle")}
              />

              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("totalVisits")}</span>
                  <strong>{report.visitCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("uniqueCustomers")}</span>
                  <strong>{report.uniqueCustomerVisitCount || 0}</strong>
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
                    <h2>
                      {collector.collectorName}
                      {collector.userRoleLabel ? ` · ${collector.userRoleLabel}` : ""}
                    </h2>
                    <span>
                      {collector.visitCount} {t("visits")}
                      {" · "}
                      {collector.uniqueCustomerVisitCount ?? collector.visitCount} {t("uniqueCustomersShort")}
                      {" · "}
                      {collector.gpsVisitCount} {t("gpsCaptured")}
                      {" · "}
                      {t("routeTotal")}: {formatNumber(collector.totalDistanceKm)} km
                    </span>
                  </div>

                  {(report.collectors || []).length > 1 && collector.daySummary ? (
                    <DaySummaryBox
                      summary={collector.daySummary}
                      language={language}
                      title={t("collectorDaySummaryTitle")}
                    />
                  ) : null}

                  <div className="moduleTableWrap">
                    <table className="moduleTable">
                      <thead>
                        <tr>
                          <th>{t("sequence")}</th>
                          <th>{t("time")}</th>
                          <th>{t("userName")}</th>
                          <th>{t("viewReport")}</th>
                          <th>{t("queuePriority")}</th>
                          <th>{t("customer")}</th>
                          <th>{t("area")}</th>
                          <th>{t("street")}</th>
                          <th>{t("outcome")}</th>
                          <th>{t("nextVisitDate")}</th>
                          <th>{t("amount")}</th>
                          <th>{t("gps")}</th>
                          <th>{t("distance")}</th>
                          <th>{t("speed")}</th>
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
                              {isLunchTimelineRow(visit) ? (
                                "-"
                              ) : (
                                <button
                                  type="button"
                                  className="moduleInlineButton"
                                  onClick={() => setSelectedVisit({ visit, collector })}
                                >
                                  {t("viewReport")}
                                </button>
                              )}
                            </td>
                            <td>
                              {isLunchTimelineRow(visit) ? (
                                "-"
                              ) : (
                                <>
                                  {visit.queuePriority ? `#${visit.queuePriority}` : t("notRecorded")}
                                  <div className="moduleCode">{formatVisitOrderVsQueue(visit)}</div>
                                  {visit.queueCompliance === "off_priority" ? (
                                    <div className="moduleCollectorProbability moduleCollectorProbabilityLOW">
                                      {t("complianceOffPriority")}
                                    </div>
                                  ) : visit.queueCompliance === "on_priority" ? (
                                    <div className="moduleCollectorProbability moduleCollectorProbabilityHIGH">
                                      {t("complianceOnPriority")}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td>
                              {isLunchTimelineRow(visit) ? (
                                "-"
                              ) : (
                                <>
                                  {visit.customerName}
                                  <div className="moduleCode">{visit.customerCode}</div>
                                  {visit.isPriorityCustomer ? (
                                    <div className="moduleCollectorProbability moduleCollectorProbabilityHIGH">
                                      {t("priorityYes")}
                                    </div>
                                  ) : visit.probabilityLabel || visit.queuePriority ? (
                                    <div className="moduleCollectorProbability moduleCollectorProbabilityLOW">
                                      {t("priorityNo")}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td>{visit.area || "-"}</td>
                            <td>{visit.street || "-"}</td>
                            <td>
                              {isLunchTimelineRow(visit)
                                ? formatTimelineEventLabel(visit, t)
                                : (visit.visitOutcomeLabel || visit.visitOutcome)}
                            </td>
                            <td>{isLunchTimelineRow(visit) ? "-" : formatDateOnly(visit.nextVisitAt)}</td>
                            <td>{isLunchTimelineRow(visit) ? "-" : formatAmount(visit.amountReceived)}</td>
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
                              {visit.speedFromPreviousKmH === null || visit.speedFromPreviousKmH === undefined
                                ? "-"
                                : `${formatNumber(visit.speedFromPreviousKmH, 1)} km/h`}
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
                            <td colSpan={15}>{t("noVisits")}</td>
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

        {selectedVisit ? (
          <div className="moduleModalOverlay" dir={dir}>
            <div className="moduleModal" role="dialog" aria-modal="true">
              <h2>{t("visitReportTitle")}</h2>
              <p className="moduleHint">
                {selectedVisit.visit.customerName}
                {" · "}
                {selectedVisit.visit.customerCode}
                {" · "}
                {formatTime(selectedVisit.visit.savedAt)}
              </p>

              <section className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("priorityCustomer")}</span>
                  <strong>{selectedVisit.visit.isPriorityCustomer ? t("priorityYes") : t("priorityNo")}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("probability")}</span>
                  <strong>{formatProbabilityLabel(selectedVisit.visit.probabilityLabel, t)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("queuePriority")}</span>
                  <strong>{selectedVisit.visit.queuePriority ? `#${selectedVisit.visit.queuePriority}` : t("notRecorded")}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("visitOrderVsQueue")}</span>
                  <strong>{formatVisitOrderVsQueue(selectedVisit.visit)}</strong>
                </section>
              </section>

              <div className="moduleHint">{formatQueueCompliance(selectedVisit.visit, t)}</div>

              {selectedVisit.visit.prioritySource === "reconstructed" ? (
                <div className="moduleHint">{t("priorityEstimated")}</div>
              ) : selectedVisit.visit.prioritySource === "stored" || selectedVisit.visit.prioritySource === "summary_text" ? (
                <div className="moduleHint">{t("priorityRecorded")}</div>
              ) : null}

              {!selectedVisit.visit.hasStoredSummary ? (
                <div className="moduleHint">{t("summaryReconstructed")}</div>
              ) : null}

              <label className="moduleField">
                {t("whatsappSummary")}
                <textarea
                  className="moduleTextArea"
                  rows={16}
                  value={selectedVisit.visit.whatsappSummary || ""}
                  readOnly
                />
              </label>

              <div className="moduleOrderActions">
                <button
                  type="button"
                  className="modulePrimaryButton"
                  onClick={async () => {
                    const copied = await copyTextToClipboard(selectedVisit.visit.whatsappSummary);
                    if (copied) {
                      setCopyStatus(t("copied"));
                      setTimeout(() => setCopyStatus(""), 1200);
                    }
                  }}
                  disabled={!selectedVisit.visit.whatsappSummary}
                >
                  {t("copySummary")}
                </button>
                <button
                  type="button"
                  className="moduleSecondaryButton"
                  onClick={() => {
                    setSelectedVisit(null);
                    setCopyStatus("");
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
