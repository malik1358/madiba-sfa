"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Promoter Coverage", ar: "تغطية مروج المنتجات" },
  subtitle: {
    en: "Review a product promoter's visits across their head salesman's customer book and each customer's sales trend.",
    ar: "راجع زيارات مروج المنتجات لعملاء فريق مديره واتجاه مبيعات كل عميل.",
  },
  back: { en: "My Day", ar: "يومي" },
  customers: { en: "Team customers", ar: "عملاء الفريق" },
  visited: { en: "Visited", ar: "تمت زيارتهم" },
  notVisited: { en: "Not visited", ar: "لم تتم زيارتهم" },
  repeated: { en: "Visited more than once", ar: "تمت زيارتهم أكثر من مرة" },
  salesIncreasing: { en: "Sales increasing", ar: "المبيعات ترتفع" },
  salesDecreasing: { en: "Sales decreasing", ar: "المبيعات تنخفض" },
  coverage: { en: "Coverage", ar: "التغطية" },
  customerCoverage: { en: "Customer coverage", ar: "تغطية العملاء" },
  selectPromoter: { en: "Product promoter", ar: "مروج المنتجات" },
  choosePromoter: { en: "Select a promoter", ar: "اختر مروجًا" },
  allCustomers: { en: "All customers", ar: "كل العملاء" },
  repeatOnly: { en: "Repeated visits", ar: "الزيارات المتكررة" },
  notVisitedOnly: { en: "Not visited", ar: "لم تتم زيارتهم" },
  decreasingOnly: { en: "Sales decreasing", ar: "المبيعات تنخفض" },
  refresh: { en: "Refresh", ar: "تحديث" },
  loading: { en: "Loading team coverage...", ar: "جاري تحميل تغطية الفريق..." },
  customer: { en: "Customer", ar: "العميل" },
  teamOwner: { en: "Team salesman", ar: "مندوب الفريق" },
  visitCount: { en: "Visits (12 months)", ar: "الزيارات (12 شهرًا)" },
  lastVisit: { en: "Last visit", ar: "آخر زيارة" },
  salesTrend: { en: "Sales trend", ar: "اتجاه المبيعات" },
  increasing: { en: "Increasing", ar: "ترتفع" },
  decreasing: { en: "Decreasing", ar: "تنخفض" },
  stable: { en: "Stable", ar: "مستقرة" },
  newSales: { en: "New sales", ar: "مبيعات جديدة" },
  noSales: { en: "No sales", ar: "لا توجد مبيعات" },
  insufficientHistory: { en: "Not enough history", ar: "لا يوجد سجل كافٍ" },
  neverVisited: { en: "Never visited", ar: "لم تتم الزيارة" },
  visitedOnce: { en: "Once", ar: "مرة واحدة" },
  repeatedStatus: { en: "Repeated", ar: "متكرر" },
  salesNote: {
    en: "Visit counts cover the last 12 months. Sales columns show the last six completed months; trend compares the latest three with the previous three and deducts credit notes.",
    ar: "عدد الزيارات لآخر 12 شهرًا. أعمدة المبيعات تعرض آخر ستة أشهر مكتملة؛ ويقارن الاتجاه آخر ثلاثة أشهر بالثلاثة السابقة بعد خصم الإشعارات الدائنة.",
  },
  noRows: { en: "No customers match this filter.", ar: "لا يوجد عملاء يطابقون هذا التصفية." },
  choosePromoterHint: { en: "Select a product promoter to view their team coverage.", ar: "اختر مروج منتجات لعرض تغطية فريقه." },
  loginAgain: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
};

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value, language) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(date);
}

function monthLabel(value, language) {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function trendLabel(trend, t) {
  const labels = {
    increasing: t("increasing"),
    decreasing: t("decreasing"),
    stable: t("stable"),
    new_sales: t("newSales"),
    no_sales: t("noSales"),
    insufficient_history: t("insufficientHistory"),
  };
  return labels[trend] || t("insufficientHistory");
}

function trendClass(trend) {
  if (trend === "increasing" || trend === "new_sales") return "moduleBiMonthCell--up";
  if (trend === "decreasing") return "moduleBiMonthCell--down";
  return "";
}

export default function PromoterCoveragePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: loadingAccess } = useModuleAccess();
  const supabaseClient = getSupabaseClient();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPromoterId, setSelectedPromoterId] = useState("");
  const canAccess = access.canAccess("promoterCoverage");

  usePopupMessages({ error });

  useEffect(() => {
    if (loadingAccess) return undefined;
    if (!canAccess) {
      setLoading(false);
      setReport(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (!cancelled) {
        setLoading(false);
        setError("Report load timed out. Please login and refresh the page.");
      }
    });

    (async () => {
      try {
        const session = await resolveAuthSession(getSupabaseClient(), 12000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error(t("loginAgain"));
        const params = new URLSearchParams();
        if (selectedPromoterId) params.set("promoterId", selectedPromoterId);
        const query = params.toString();
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/promoter-coverage${query ? `?${query}` : ""}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          120000,
        );
        if (cancelled) return;
        if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load promoter coverage.");
        setReport(payload);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load promoter coverage.");
      } finally {
        if (!cancelled) setLoading(false);
        stopSafetyTimer();
      }
    })();

    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [canAccess, loadingAccess, refreshKey, language, selectedPromoterId]);

  if (!supabaseClient) {
    return <SupabaseUnavailable title={t("title")} message="This report needs Supabase credentials." />;
  }

  const rows = (report?.rows || []).filter((row) => {
    if (filter === "not_visited") return row.visitStatus === "not_visited";
    if (filter === "repeated") return row.visitStatus === "repeated";
    if (filter === "decreasing") return row.trend === "decreasing";
    return true;
  });
  const totalCustomers = Number(report?.customerCount || 0);
  const coveragePercent = totalCustomers > 0
    ? Math.round((Number(report?.visitedCustomerCount || 0) / totalCustomers) * 100)
    : 0;

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
              <AccessibleHeaderLink moduleKey="myDay" href="/management/my-day" className="moduleBackLink">{t("back")}</AccessibleHeaderLink>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{report?.promoter?.salesmanName || report?.promoter?.salesmanCode || t("customerCoverage")}</h2>
              {report?.headSalesman ? <span>{(report?.teamSalesmen || []).length} {t("teamOwner")}</span> : null}
            </div>
            {!loading && (report?.promoterOptions || []).length > 0 ? (
              <label className="moduleField" style={{ maxWidth: "360px", marginTop: "12px" }}>
                {t("selectPromoter")}
                <select
                  className="moduleInput"
                  value={selectedPromoterId || report?.promoter?.userId || ""}
                  onChange={(event) => setSelectedPromoterId(event.target.value)}
                >
                  <option value="">{t("choosePromoter")}</option>
                  {(report.promoterOptions || []).map((option) => (
                    <option key={option.userId} value={option.userId}>
                      {[option.salesmanName, option.salesmanCode].filter(Boolean).join(" · ") || option.userId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>

          {loading && <div className="moduleLoading">{t("loading")}</div>}
          {error ? <div className="moduleHint">{error}</div> : null}

          {!loading && report?.requiresPromoterSelection ? (
            <div className="moduleHint">{t("choosePromoterHint")}</div>
          ) : null}

          {!loading && report && !report.requiresPromoterSelection ? (
            <>
              <div className="moduleMetricGrid moduleMetricGridCols6">
                <section className="moduleMetricCard"><span>{t("customers")}</span><strong>{report.customerCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("visited")}</span><strong>{report.visitedCustomerCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("coverage")}</span><strong>{coveragePercent}%</strong></section>
                <section className="moduleMetricCard"><span>{t("notVisited")}</span><strong>{report.notVisitedCustomerCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("repeated")}</span><strong>{report.repeatedCustomerCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("salesIncreasing")} / {t("salesDecreasing")}</span><strong>{report.increasingCustomerCount} / {report.decreasingCustomerCount}</strong></section>
              </div>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("customerCoverage")}</h2>
                  <span>{rows.length} / {report.customerCount}</span>
                </div>
                <div className="moduleActionRow" style={{ justifyContent: "space-between", marginBottom: "12px" }}>
                  <label className="moduleField">
                    {t("customerCoverage")}
                    <select className="moduleInput" value={filter} onChange={(event) => setFilter(event.target.value)}>
                      <option value="all">{t("allCustomers")}</option>
                      <option value="not_visited">{t("notVisitedOnly")}</option>
                      <option value="repeated">{t("repeatOnly")}</option>
                      <option value="decreasing">{t("decreasingOnly")}</option>
                    </select>
                  </label>
                  <button type="button" className="moduleInlineButton" onClick={() => setRefreshKey((value) => value + 1)}>
                    {t("refresh")}
                  </button>
                </div>
                <p className="moduleHint">{t("salesNote")}</p>
                <ExportableTable filename={`promoter-coverage-${report.reportDate}`} sheetName="Promoter Coverage" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th>{t("customer")}</th>
                        <th>{t("teamOwner")}</th>
                        <th>{t("visitCount")}</th>
                        <th>{t("lastVisit")}</th>
                        <th>{t("salesTrend")}</th>
                        {report.monthKeys.map((month) => <th key={month}>{monthLabel(month, language)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.customerCode}>
                          <td>
                            <strong>{row.customerName || row.customerCode}</strong>
                            <div className="moduleCode">{row.customerCode}</div>
                          </td>
                          <td>{row.teamSalesmanCode || "-"}</td>
                          <td className={row.visitStatus === "not_visited" ? "moduleBiMonthCell--down" : ""}>
                            {row.visitCount} <span className="moduleCode">{row.visitCount === 0 ? t("neverVisited") : row.visitCount === 1 ? t("visitedOnce") : t("repeatedStatus")}</span>
                          </td>
                          <td>{formatDate(row.lastVisitAt, language)}</td>
                          <td className={trendClass(row.trend)}>
                            {trendLabel(row.trend, t)}
                            {row.changePercent == null ? "" : ` ${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(1)}%`}
                          </td>
                          {report.monthKeys.map((month) => <td key={month}>{formatAmount(row.monthSales?.[month])}</td>)}
                        </tr>
                      ))}
                      {rows.length === 0 ? <tr><td colSpan={5 + report.monthKeys.length}>{t("noRows")}</td></tr> : null}
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