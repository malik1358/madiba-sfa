"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Business Dashboard", ar: "لوحة الأعمال" },
  subtitle: {
    en: "KRAs, KPIs, and red alerts from live field, sales, and collection data",
    ar: "مؤشرات الأداء والتنبيهات الحمراء من بيانات الميدان والمبيعات والتحصيل",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading business dashboard...", ar: "جاري تحميل لوحة الأعمال..." },
  date: { en: "Report date", ar: "تاريخ التقرير" },
  redAlerts: { en: "Red alerts", ar: "تنبيهات حمراء" },
  warnings: { en: "Warnings", ar: "تحذيرات" },
  kpis: { en: "Key metrics", ar: "المؤشرات الرئيسية" },
  noAlerts: { en: "No red alerts for this date.", ar: "لا توجد تنبيهات حمراء لهذا التاريخ." },
  noWarnings: { en: "No warnings for this date.", ar: "لا توجد تحذيرات لهذا التاريخ." },
  attendance: { en: "Field attendance", ar: "حضور الميدان" },
  outstandingFile: { en: "Outstanding file", ar: "ملف المستحقات" },
  customersDue: { en: "Customers with due", ar: "عملاء بمستحقات" },
  quickLinks: { en: "Quick reports", ar: "تقارير سريعة" },
  takeAction: { en: "Take action", ar: "اتخاذ إجراء" },
};

function kpiClass(status) {
  if (status === "red") return "moduleBusinessKpi--red";
  if (status === "orange") return "moduleBusinessKpi--orange";
  if (status === "green") return "moduleBusinessKpi--green";
  return "";
}

function alertClass(severity) {
  return severity === "red" ? "moduleBusinessAlert--red" : "moduleBusinessAlert--orange";
}

export default function BusinessDashboardPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [dashboard, setDashboard] = useState(null);

  usePopupMessages({ error });

  useEffect(() => {
    let cancelled = false;

    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) => current || "Dashboard load timed out. Please refresh.");
    });

    async function loadDashboard() {
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
        if (!session?.access_token) throw new Error("Please login again.");

        const params = new URLSearchParams({ date: reportDate });
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/business-dashboard?${params.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          60000,
        );

        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load business dashboard.");
        }

        setDashboard(payload);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Unable to load business dashboard.");
        setDashboard(null);
      } finally {
        stopSafetyTimer();
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [reportDate]);

  const redAlerts = useMemo(
    () => (dashboard?.alerts || []).filter((row) => row.severity === "red"),
    [dashboard],
  );
  const orangeAlerts = useMemo(
    () => (dashboard?.alerts || []).filter((row) => row.severity === "orange"),
    [dashboard],
  );

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Business dashboard unavailable"
        message="The business dashboard needs Supabase credentials."
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
              <AccessibleHeaderLink moduleKey="userActivity" href="/management/user-activity" className="moduleBackLink">
                User Activity
              </AccessibleHeaderLink>
              <AccessibleHeaderLink moduleKey="collectionReport" href="/management/collection-report" className="moduleBackLink">
                Collection Report
              </AccessibleHeaderLink>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <label className="moduleField">
              {t("date")}
              <input
                className="moduleInput"
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
            </label>
          </section>

          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && dashboard && (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard moduleBusinessKpi--red">
                  <span>{t("redAlerts")}</span>
                  <strong>{dashboard.meta?.redAlerts || 0}</strong>
                </section>
                <section className="moduleMetricCard moduleBusinessKpi--orange">
                  <span>{t("warnings")}</span>
                  <strong>{dashboard.meta?.orangeAlerts || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("attendance")}</span>
                  <strong>{dashboard.meta?.attendanceRate || 0}%</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("customersDue")}</span>
                  <strong>{dashboard.meta?.customersWithOutstanding || 0}</strong>
                </section>
              </div>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("redAlerts")}</h2>
                </div>
                {redAlerts.length === 0 ? (
                  <div className="moduleHint">{t("noAlerts")}</div>
                ) : (
                  <div className="moduleBusinessAlertList">
                    {redAlerts.map((alert) => (
                      <article key={alert.code} className={`moduleBusinessAlert ${alertClass(alert.severity)}`}>
                        <div className="moduleBusinessAlertBody">
                          <strong>{alert.title}</strong>
                          <p>{alert.detail}</p>
                          {Array.isArray(alert.names) && alert.names.length > 0 ? (
                            <p className="moduleCode">{alert.names.join(", ")}{alert.count > alert.names.length ? ` +${alert.count - alert.names.length} more` : ""}</p>
                          ) : null}
                        </div>
                        {alert.actionHref ? (
                          <Link href={alert.actionHref} className="moduleInlineButton moduleActionButton">
                            {alert.actionLabel || t("takeAction")}
                          </Link>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("warnings")}</h2>
                </div>
                {orangeAlerts.length === 0 ? (
                  <div className="moduleHint">{t("noWarnings")}</div>
                ) : (
                  <div className="moduleBusinessAlertList">
                    {orangeAlerts.map((alert) => (
                      <article key={alert.code} className={`moduleBusinessAlert ${alertClass(alert.severity)}`}>
                        <div className="moduleBusinessAlertBody">
                          <strong>{alert.title}</strong>
                          <p>{alert.detail}</p>
                        </div>
                        {alert.actionHref ? (
                          <Link href={alert.actionHref} className="moduleInlineButton moduleActionButton">
                            {alert.actionLabel || t("takeAction")}
                          </Link>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("kpis")}</h2>
                </div>
                <div className="moduleMetricGrid">
                  {(dashboard.kpis || []).map((kpi) => (
                    <section key={kpi.key} className={`moduleMetricCard ${kpiClass(kpi.status)}`}>
                      <span>{kpi.label}</span>
                      <strong>{kpi.display}</strong>
                    </section>
                  ))}
                </div>
                {dashboard.meta?.outstandingUploadedAt ? (
                  <div className="moduleHint">
                    {t("outstandingFile")}: {dashboard.meta.outstandingFileName || "-"} ({String(dashboard.meta.outstandingUploadedAt).slice(0, 10)})
                  </div>
                ) : null}
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("quickLinks")}</h2>
                </div>
                <div className="moduleInlineStack moduleActionStack">
                  <AccessibleHeaderLink moduleKey="userActivity" href={`/management/user-activity?date=${reportDate}`} className="moduleInlineButton moduleActionButton">
                    User Activity
                  </AccessibleHeaderLink>
                  <AccessibleHeaderLink moduleKey="dailyVisitReport" href={`/management/daily-visit-report?date=${reportDate}`} className="moduleInlineButton moduleActionButton">
                    Daily Visit Report
                  </AccessibleHeaderLink>
                  <AccessibleHeaderLink moduleKey="collectionReport" href={`/management/collection-report?date=${reportDate}`} className="moduleInlineButton moduleActionButton">
                    Collection Report
                  </AccessibleHeaderLink>
                  <AccessibleHeaderLink moduleKey="pendingOrders" href="/management/pending-orders" className="moduleInlineButton moduleActionButton">
                    Pending Orders
                  </AccessibleHeaderLink>
                  <AccessibleHeaderLink moduleKey="paymentCollections" href="/management/payment-collections" className="moduleInlineButton moduleActionButton">
                    Collections
                  </AccessibleHeaderLink>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
