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
import CategoryGrowthReport from "./CategoryGrowthReport";
import SalesmanMomReport, { emptySalesmanMomFilters } from "./SalesmanMomReport";
import { emptyGrowthFilters, pickBiMeasure } from "../../lib/categoryGrowth";
import { GrowthBarChart, GrowthChartPanel, GrowthSignalChart } from "./GrowthCharts";

const TEXT = {
  title: { en: "Business Intelligence", ar: "ذكاء الأعمال" },
  subtitle: {
    en: "Prepared after each sales upload. Open a report and it reads the ready model instead of scanning every invoice line.",
    ar: "يُجهَّز النموذج بعد كل رفع مبيعات. عند فتح التقرير يُقرأ النموذج الجاهز بدل مسح كل سطر فاتورة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading business dashboard...", ar: "جاري تحميل لوحة الأعمال..." },
  categoryGrowth: { en: "Category growth", ar: "نمو الفئات" },
  salesmanMom: { en: "Salesman MoM", ar: "المندوب شهرياً" },
  operations: { en: "Daily operations", ar: "التشغيل اليومي" },
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
  alertMix: { en: "Alert mix", ar: "مزيج التنبيهات" },
  moneyChart: { en: "Sales and collections", ar: "المبيعات والتحصيل" },
  activityChart: { en: "Field activity", ar: "نشاط الميدان" },
  measure: { en: "Show numbers", ar: "عرض الأرقام" },
  sales: { en: "Sales", ar: "المبيعات" },
  profit: { en: "Profit", ar: "الربح" },
  profitHint: {
    en: "Profit uses the GP amount from the sales file. Re-upload sales after this update if Profit is empty.",
    ar: "الربح من مبلغ GP في ملف المبيعات. أعد رفع المبيعات بعد هذا التحديث إذا كان الربح فارغاً.",
  },
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
  const [view, setView] = useState("category-growth");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(() => getKsaDateString());
  const [dashboard, setDashboard] = useState(null);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [growthReport, setGrowthReport] = useState(null);
  const [growthDraft, setGrowthDraft] = useState(() => emptyGrowthFilters());
  const [growthApplied, setGrowthApplied] = useState(() => emptyGrowthFilters());
  const [growthCatalogs, setGrowthCatalogs] = useState({});
  const [growthSearch, setGrowthSearch] = useState("");
  const [growthStatusFilter, setGrowthStatusFilter] = useState([]);
  const [salesmanLoading, setSalesmanLoading] = useState(true);
  const [salesmanReport, setSalesmanReport] = useState(null);
  const [salesmanDraft, setSalesmanDraft] = useState(() => emptySalesmanMomFilters());
  const [salesmanApplied, setSalesmanApplied] = useState(() => emptySalesmanMomFilters());
  const [salesmanSearch, setSalesmanSearch] = useState("");
  const [salesmanStatusFilter, setSalesmanStatusFilter] = useState([]);
  const [amountMeasure, setAmountMeasure] = useState("sales");
  const visibleGrowthReport = useMemo(
    () => pickBiMeasure(growthReport, amountMeasure),
    [growthReport, amountMeasure],
  );
  const visibleSalesmanReport = useMemo(
    () => pickBiMeasure(salesmanReport, amountMeasure),
    [salesmanReport, amountMeasure],
  );

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

    if (view !== "operations") {
      stopSafetyTimer();
      setLoading(false);
      return () => {
        cancelled = true;
        stopSafetyTimer();
      };
    }

    loadDashboard();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [reportDate, view]);

  useEffect(() => {
    let cancelled = false;

    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setGrowthLoading(false);
      setError((current) => current || "Category growth timed out. Please refresh.");
    });

    async function loadGrowth() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        stopSafetyTimer();
        setGrowthLoading(false);
        return;
      }

      setGrowthLoading(true);
      setError("");

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error("Please login again.");

        const { response, payload } = await fetchJsonWithTimeout(
          "/api/business-dashboard/category-growth",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ filters: growthApplied }),
          },
          60000,
        );

        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load category growth.");
        }

        setGrowthReport(payload);
        if (payload.catalogs) setGrowthCatalogs(payload.catalogs);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Unable to load category growth.");
        setGrowthReport(null);
      } finally {
        stopSafetyTimer();
        if (!cancelled) setGrowthLoading(false);
      }
    }

    if (view !== "category-growth") {
      stopSafetyTimer();
      setGrowthLoading(false);
      return () => {
        cancelled = true;
        stopSafetyTimer();
      };
    }

    loadGrowth();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [view, growthApplied]);

  useEffect(() => {
    let cancelled = false;

    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setSalesmanLoading(false);
      setError((current) => current || "Salesman performance timed out. Please refresh.");
    });

    async function loadSalesmen() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        stopSafetyTimer();
        setSalesmanLoading(false);
        return;
      }

      setSalesmanLoading(true);
      setError("");

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error("Please login again.");

        const { response, payload } = await fetchJsonWithTimeout(
          "/api/business-dashboard/category-growth",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ filters: salesmanApplied }),
          },
          60000,
        );

        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load salesman performance.");
        }

        setSalesmanReport(payload);
        if (payload.catalogs) setGrowthCatalogs(payload.catalogs);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Unable to load salesman performance.");
        setSalesmanReport(null);
      } finally {
        stopSafetyTimer();
        if (!cancelled) setSalesmanLoading(false);
      }
    }

    if (view !== "salesman-mom") {
      stopSafetyTimer();
      setSalesmanLoading(false);
      return () => {
        cancelled = true;
        stopSafetyTimer();
      };
    }

    loadSalesmen();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [view, salesmanApplied]);

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
            <div className="moduleBiTabs" role="tablist" aria-label={t("title")}>
              <button
                type="button"
                role="tab"
                aria-selected={view === "category-growth"}
                className={`moduleBiTab${view === "category-growth" ? " isActive" : ""}`}
                onClick={() => setView("category-growth")}
              >
                {t("categoryGrowth")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "salesman-mom"}
                className={`moduleBiTab${view === "salesman-mom" ? " isActive" : ""}`}
                onClick={() => setView("salesman-mom")}
              >
                {t("salesmanMom")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "operations"}
                className={`moduleBiTab${view === "operations" ? " isActive" : ""}`}
                onClick={() => setView("operations")}
              >
                {t("operations")}
              </button>
            </div>
          </section>

          {view === "category-growth" || view === "salesman-mom" ? (
            <section className="moduleSection">
              <div className="moduleBiMeasureBar">
                <span>{t("measure")}</span>
                <div className="moduleBiTabs" role="group" aria-label={t("measure")}>
                  <button
                    type="button"
                    className={`moduleBiTab${amountMeasure === "sales" ? " isActive" : ""}`}
                    onClick={() => setAmountMeasure("sales")}
                  >
                    {t("sales")}
                  </button>
                  <button
                    type="button"
                    className={`moduleBiTab${amountMeasure === "profit" ? " isActive" : ""}`}
                    onClick={() => setAmountMeasure("profit")}
                  >
                    {t("profit")}
                  </button>
                </div>
              </div>
              {amountMeasure === "profit" ? <p className="moduleHint">{t("profitHint")}</p> : null}
            </section>
          ) : null}

          {view === "category-growth" ? (
            <CategoryGrowthReport
              language={language}
              loading={growthLoading}
              report={visibleGrowthReport}
              draft={growthDraft}
              catalogs={growthCatalogs}
              applied={growthApplied}
              search={growthSearch}
              statusFilter={growthStatusFilter}
              onSearchChange={setGrowthSearch}
              onStatusFilterChange={setGrowthStatusFilter}
              onDraftChange={setGrowthDraft}
              onGroupByChange={(groupBy) => {
                setGrowthDraft((current) => ({ ...current, groupBy }));
                setGrowthApplied((current) => ({ ...current, groupBy }));
              }}
              onApply={() => setGrowthApplied({ ...growthDraft })}
              onClear={() => {
                const empty = emptyGrowthFilters();
                setGrowthDraft(empty);
                setGrowthApplied(empty);
                setGrowthSearch("");
                setGrowthStatusFilter([]);
              }}
            />
          ) : null}

          {view === "salesman-mom" ? (
            <SalesmanMomReport
              language={language}
              loading={salesmanLoading}
              report={visibleSalesmanReport}
              draft={salesmanDraft}
              catalogs={growthCatalogs}
              applied={salesmanApplied}
              search={salesmanSearch}
              statusFilter={salesmanStatusFilter}
              onSearchChange={setSalesmanSearch}
              onStatusFilterChange={setSalesmanStatusFilter}
              onDraftChange={setSalesmanDraft}
              onApply={() => setSalesmanApplied({ ...salesmanDraft, groupBy: "salesman" })}
              onClear={() => {
                const empty = emptySalesmanMomFilters();
                setSalesmanDraft(empty);
                setSalesmanApplied(empty);
                setSalesmanSearch("");
                setSalesmanStatusFilter([]);
              }}
            />
          ) : null}

          {view === "operations" ? (
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
          ) : null}

          {view === "operations" && loading && <div className="moduleLoading">{t("loading")}</div>}

          {view === "operations" && !loading && dashboard && (
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
              <div className="moduleBiChartGrid">
                <GrowthChartPanel title={t("alertMix")}>
                  <GrowthSignalChart
                    counts={{
                      red: Number(dashboard.meta?.redAlerts || 0),
                      orange: Number(dashboard.meta?.orangeAlerts || 0),
                    }}
                    labels={{ red: t("redAlerts"), orange: t("warnings") }}
                  />
                </GrowthChartPanel>
                <GrowthChartPanel title={t("activityChart")}>
                  <GrowthBarChart
                    items={[
                      { key: "attendance", label: t("attendance"), value: Number(dashboard.meta?.attendanceRate || 0), display: `${dashboard.meta?.attendanceRate || 0}%` },
                      { key: "due", label: t("customersDue"), value: Number(dashboard.meta?.customersWithOutstanding || 0) },
                    ]}
                  />
                </GrowthChartPanel>
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
                <GrowthChartPanel title={t("moneyChart")}>
                  <GrowthBarChart
                    items={(dashboard.kpis || [])
                      .filter((kpi) => ["sales_today", "sales_mtd", "collected_today", "collected_mtd", "outstanding_total", "outstanding_90plus"].includes(kpi.key))
                      .map((kpi) => ({
                        key: kpi.key,
                        label: kpi.label,
                        value: kpi.value,
                        display: kpi.display,
                        status: kpi.status,
                      }))}
                  />
                </GrowthChartPanel>
                <GrowthChartPanel title={t("activityChart")}>
                  <GrowthBarChart
                    items={(dashboard.kpis || [])
                      .filter((kpi) => !["sales_today", "sales_mtd", "collected_today", "collected_mtd", "outstanding_total", "outstanding_90plus"].includes(kpi.key))
                      .map((kpi) => ({
                        key: kpi.key,
                        label: kpi.label,
                        value: kpi.value,
                        display: kpi.display,
                        status: kpi.status,
                      }))}
                  />
                </GrowthChartPanel>
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
