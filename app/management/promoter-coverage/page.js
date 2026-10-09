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
  fromMonth: { en: "From month", ar: "من شهر" },
  toMonth: { en: "To month", ar: "إلى شهر" },
  applyPeriod: { en: "Apply period", ar: "تطبيق الفترة" },
  skuTrend: { en: "SKUs sold trend", ar: "اتجاه الأصناف المباعة" },
  monthSales: { en: "Sales", ar: "المبيعات" },
  monthSkus: { en: "SKUs", ar: "الأصناف" },
  increasingSkus: { en: "SKUs increasing", ar: "الأصناف ترتفع" },
  decreasingSkus: { en: "SKUs decreasing", ar: "الأصناف تنخفض" },
  invalidPeriod: { en: "Choose a valid month range.", ar: "اختر نطاق أشهر صحيحًا." },
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
    en: "Visits cover the last 12 months. Monthly net sales and distinct SKUs cover team-book customers regardless of invoice salesman. Sales/SKU trend compares the latest two completed months in the selected period; the incomplete current month is excluded.",
    ar: "تغطي الزيارات آخر 12 شهرًا. تعرض صافي المبيعات وعدد الأصناف الفريدة شهريًا لعملاء دفتر الفريق بغض النظر عن مندوب الفاتورة. يقارن اتجاه المبيعات والأصناف أحدث شهرين مكتملين في الفترة المحددة، مع استبعاد الشهر الحالي غير المكتمل.",
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
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [appliedPeriod, setAppliedPeriod] = useState(null);
  const [periodError, setPeriodError] = useState("");
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
        if (appliedPeriod) {
          params.set("fromMonth", appliedPeriod.fromMonth);
          params.set("toMonth", appliedPeriod.toMonth);
        }
        const query = params.toString();
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/promoter-coverage${query ? `?${query}` : ""}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          120000,
        );
        if (cancelled) return;
        if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load promoter coverage.");
        setReport(payload);
        if (!appliedPeriod && payload.monthKeys?.length) {
          setFromMonth(payload.monthKeys[0]);
          setToMonth(payload.monthKeys.at(-1));
        }
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
  }, [canAccess, loadingAccess, refreshKey, language, selectedPromoterId, appliedPeriod]);

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
                <section className="moduleMetricCard"><span>{t("increasingSkus")} / {t("decreasingSkus")}</span><strong>{report.increasingSkuCustomerCount} / {report.decreasingSkuCustomerCount}</strong></section>
              </div>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("customerCoverage")}</h2>
                  <span>{rows.length} / {report.customerCount}</span>
                </div>
                <div className="moduleActionRow" style={{ justifyContent: "space-between", marginBottom: "12px" }}>
                  <div className="moduleActionRow" style={{ margin: 0 }}>
                    <label className="moduleField">
                      {t("fromMonth")}
                      <input className="moduleInput" type="month" value={fromMonth} onChange={(event) => setFromMonth(event.target.value)} />
                    </label>
                    <label className="moduleField">
                      {t("toMonth")}
                      <input className="moduleInput" type="month" value={toMonth} onChange={(event) => setToMonth(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="moduleInlineButton"
                      onClick={() => {
                        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth) || fromMonth > toMonth) {
                          setPeriodError(t("invalidPeriod"));
                          return;
                        }
                        setPeriodError("");
                        setAppliedPeriod({ fromMonth, toMonth });
                      }}
                    >
                      {t("applyPeriod")}
                    </button>
                  </div>
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
                {periodError ? <div className="moduleHint">{periodError}</div> : null}
                <p className="moduleHint">{t("salesNote")}</p>
                <ExportableTable filename={`promoter-coverage-${fromMonth}-${toMonth}`} sheetName="Promoter Coverage" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable modulePromoterCoverageTable">
                    <thead>
                      <tr>
                        <th>{t("customer")}</th>
                        <th>{t("teamOwner")}</th>
                        <th>{t("visitCount")}</th>
                        <th>{t("lastVisit")}</th>
                        <th>{t("salesTrend")}</th>
                        <th>{t("skuTrend")}</th>
                        {report.monthKeys.flatMap((month) => [
                          <th key={`${month}-sales`}>{monthLabel(month, language)} {t("monthSales")}</th>,
                          <th key={`${month}-skus`}>{monthLabel(month, language)} {t("monthSkus")}</th>,
                        ])}
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
                          <td className={trendClass(row.skuTrend)}>
                            {trendLabel(row.skuTrend, t)}
                            {row.skuChangePercent == null ? "" : ` ${row.skuChangePercent > 0 ? "+" : ""}${row.skuChangePercent.toFixed(1)}%`}
                          </td>
                          {report.monthKeys.flatMap((month) => {
                            const salesChange = row.monthSalesChange?.[month];
                            const skuChange = row.monthSkuChange?.[month];
                            const changeClass = (change) => (
                              change?.trend === "increasing" || change?.trend === "new_sales"
                                ? "moduleBiMonthCell--up"
                                : change?.trend === "decreasing" ? "moduleBiMonthCell--down" : ""
                            );
                            return [
                              <td key={`${month}-sales`} data-sort-value={row.monthSales?.[month] || 0} className={changeClass(salesChange)}>
                                {formatAmount(row.monthSales?.[month])}
                                {salesChange?.changePercent == null ? "" : ` (${salesChange.changePercent > 0 ? "+" : ""}${salesChange.changePercent.toFixed(1)}%)`}
                              </td>,
                              <td key={`${month}-skus`} data-sort-value={row.monthSkuCount?.[month] || 0} className={changeClass(skuChange)}>
                                {formatAmount(row.monthSkuCount?.[month])}
                                {skuChange?.changePercent == null ? "" : ` (${skuChange.changePercent > 0 ? "+" : ""}${skuChange.changePercent.toFixed(1)}%)`}
                              </td>,
                            ];
                          })}
                        </tr>
                      ))}
                      {rows.length === 0 ? <tr><td colSpan={6 + report.monthKeys.length * 2}>{t("noRows")}</td></tr> : null}
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