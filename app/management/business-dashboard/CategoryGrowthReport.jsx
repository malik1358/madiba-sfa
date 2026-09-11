"use client";

import { useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import CategoryGrowthFilters, { filterGrowthRows } from "./CategoryGrowthFilters";
import GrowthPeriodGrid from "./GrowthPeriodGrid";
import { GrowthBarChart, GrowthChartPanel, GrowthSignalChart, GrowthTrendChart } from "./GrowthCharts";
import {
  buildPeriodChartModel,
  buildShareChartItems,
  buildSignalMix,
} from "../../lib/growthCharts";
import {
  formatGrowthPercent,
  formatMoneyAmount,
  formatSharePercent,
  growthDimensionLabel,
  monthChangeTone,
  monthGridTotals,
  previousMonthKey,
  previousQuarterKey,
  quarterGridTotals,
  quarterLabel,
} from "../../lib/categoryGrowth";
import { translate } from "../../lib/appLanguage";

function formatPreparedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TEXT = {
  loading: { en: "Opening the prepared sales model...", ar: "جاري فتح نموذج المبيعات الجاهز..." },
  readyModel: {
    en: "Ready from the last sales upload",
    ar: "جاهز من آخر رفع مبيعات",
  },
  staleModel: {
    en: "A newer sales file was uploaded. Showing the last ready model while it refreshes.",
    ar: "تم رفع ملف مبيعات أحدث. يتم عرض آخر نموذج جاهز أثناء التحديث.",
  },
  empty: {
    en: "No uploaded sales found. Import a sales file first, then open this report.",
    ar: "لا توجد مبيعات مرفوعة. استورد ملف المبيعات أولاً ثم افتح هذا التقرير.",
  },
  emptySlice: {
    en: "No rows match the current slice. Clear filters or choose another grouping.",
    ar: "لا توجد صفوف تطابق الشريحة الحالية. امسح التصفية أو غيّر التجميع.",
  },
  missingTable: {
    en: "Sales table is not available yet, so this report cannot be built.",
    ar: "جدول المبيعات غير متاح بعد، لذلك لا يمكن بناء هذا التقرير.",
  },
  summary: { en: "Category growth since first sale", ar: "نمو الفئات منذ أول بيع" },
  summaryHint: {
    en: "Growth is calculated on the current slice of uploaded sales. Current year is year-to-date through the latest invoice date in the slice.",
    ar: "يُحسب النمو على شريحة المبيعات الحالية. السنة الحالية حتى تاريخ آخر فاتورة في الشريحة.",
  },
  categories: { en: "Rows", ar: "الصفوف" },
  growing: { en: "Growing", ar: "نمو" },
  declining: { en: "Red lights", ar: "إشارات حمراء" },
  warnings: { en: "Watch list", ar: "قائمة المراقبة" },
  lifetime: { en: "Lifetime sales", ar: "مبيعات العمر" },
  companyYoy: { en: "Company YTD vs last year", ar: "الشركة هذا العام مقابل العام الماضي" },
  range: { en: "Sales history", ar: "تاريخ المبيعات" },
  redAlerts: { en: "Categories needing attention", ar: "فئات تحتاج متابعة" },
  noAlerts: { en: "No category red lights from uploaded sales.", ar: "لا توجد إشارات حمراء على الفئات من المبيعات المرفوعة." },
  yearly: { en: "Sales by year since inception", ar: "المبيعات حسب السنة منذ البداية" },
  yearlyHint: {
    en: "Green is higher than the previous year. Red is lower. The current year is year-to-date only.",
    ar: "الأخضر أعلى من السنة السابقة. الأحمر أقل. السنة الحالية حتى اليوم فقط.",
  },
  monthly: { en: "Last 12 months", ar: "آخر 12 شهراً" },
  quarterly: { en: "Last 8 quarters", ar: "آخر 8 أرباع" },
  total: { en: "Total", ar: "الإجمالي" },
  monthlyHint: {
    en: "Green is higher than the previous month. Red is lower. The current month is month-to-date only.",
    ar: "الأخضر أعلى من الشهر السابق. الأحمر أقل. الشهر الحالي حتى اليوم فقط.",
  },
  chartHint: {
    en: "Hover a period for amounts. Click a name to hide or show that line. Charts follow the current filters.",
    ar: "مرّر على الفترة لمشاهدة المبالغ. انقر اسماً لإخفاء الخط أو إظهاره. الرسوم تتبع التصفية الحالية.",
  },
  shareChart: { en: "Share of lifetime sales", ar: "حصة مبيعات العمر" },
  signalChart: { en: "Signal mix", ar: "مزيج الإشارات" },
  trendChart: { en: "Trend", ar: "الاتجاه" },
  quarterlyHint: {
    en: "Green is higher than the previous quarter. Red is lower. The current quarter is quarter-to-date only.",
    ar: "الأخضر أعلى من الربع السابق. الأحمر أقل. الربع الحالي حتى اليوم فقط.",
  },
  category: { en: "Category", ar: "الفئة" },
  firstSale: { en: "First sale", ar: "أول بيع" },
  lastSale: { en: "Last sale", ar: "آخر بيع" },
  share: { en: "Share", ar: "الحصة" },
  cagr: { en: "CAGR", ar: "معدل النمو السنوي" },
  yoy: { en: "YTD vs LY", ar: "هذا العام مقابل الماضي" },
  mom: { en: "Latest month vs prior", ar: "آخر شهر مقابل السابق" },
  status: { en: "Signal", ar: "الإشارة" },
};

function statusClass(status) {
  if (status === "red") return "moduleKpiStatus moduleKpiStatus--behind";
  if (status === "orange") return "moduleKpiStatus moduleKpiStatus--onTrack";
  if (status === "green") return "moduleKpiStatus moduleKpiStatus--achieved";
  return "moduleKpiStatus moduleKpiStatus--neutral";
}

function percentTone(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "up" : "down";
}

function trendClass(value) {
  const tone = percentTone(value);
  if (tone === "up") return "moduleBiTrend--up";
  if (tone === "down") return value <= -15 ? "moduleBiTrend--downHard" : "moduleBiTrend--down";
  return "";
}

function periodCellClass(tone, isCurrent = false) {
  return [
    tone ? `moduleBiMonthCell--${tone}` : "",
    isCurrent ? "moduleBiMonthCell--current" : "",
  ].filter(Boolean).join(" ");
}

function monthLabel(month, currentMonth) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} MTD` : label;
}

export default function CategoryGrowthReport({
  language,
  loading,
  report,
  draft,
  catalogs,
  applied,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onDraftChange,
  onGroupByChange,
  onApply,
  onClear,
}) {
  const t = translate(language, TEXT);
  const groupBy = applied?.groupBy || report?.filters?.groupBy || "category";
  const groupLabel = growthDimensionLabel(groupBy, language);
  const allRows = report?.groups || report?.categories || [];
  const categories = useMemo(
    () => filterGrowthRows(allRows, { search, statusFilter }),
    [allRows, search, statusFilter],
  );
  const years = report?.years || [];
  const currentYear = (report?.currentMonth || report?.lastDate || "").slice(0, 4);
  const recentMonths = report?.recentMonths || [];
  const currentMonth = report?.currentMonth || "";
  const recentQuarters = report?.recentQuarters || [];
  const currentQuarter = report?.currentQuarter || "";
  const monthTotals = useMemo(
    () => monthGridTotals(categories, recentMonths),
    [categories, recentMonths],
  );
  const quarterTotals = useMemo(
    () => quarterGridTotals(categories, recentQuarters),
    [categories, recentQuarters],
  );
  const yearChart = useMemo(
    () => buildPeriodChartModel(categories, years, (row) => row.yearValues),
    [categories, years],
  );
  const quarterChart = useMemo(
    () => buildPeriodChartModel(categories, recentQuarters, (row) => row.quarterValues),
    [categories, recentQuarters],
  );
  const monthChart = useMemo(
    () => buildPeriodChartModel(categories, recentMonths),
    [categories, recentMonths],
  );
  const shareItems = useMemo(() => buildShareChartItems(categories), [categories]);
  const signalMix = useMemo(() => buildSignalMix(categories), [categories]);

  const hasData = allRows.length > 0;

  const historyLabel = useMemo(() => {
    if (!report?.firstDate || !report?.lastDate) return "—";
    return `${report.firstDate} → ${report.lastDate}`;
  }, [report]);

  const filters = (
    <CategoryGrowthFilters
      language={language}
      draft={draft}
      catalogs={catalogs}
      applied={applied}
      search={search}
      onSearchChange={onSearchChange}
      statusFilter={statusFilter}
      onStatusFilterChange={onStatusFilterChange}
      onDraftChange={onDraftChange}
      onGroupByChange={onGroupByChange}
      onApply={onApply}
      onClear={onClear}
    />
  );

  if (loading) {
    return (
      <>
        {filters}
        <div className="moduleLoading">{t("loading")}</div>
      </>
    );
  }

  if (report?.meta?.missingTable) {
    return (
      <>
        {filters}
        <div className="moduleHint">{t("missingTable")}</div>
      </>
    );
  }

  if (!hasData) {
    return (
      <>
        {filters}
        <div className="moduleHint">{t("empty")}</div>
      </>
    );
  }

  return (
    <>
      {filters}
      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("summary")}</h2>
        </div>
        <p className="moduleHint">{t("summaryHint")}</p>
        {report.meta?.preparedAt ? (
          <p className="moduleHint">
            {report.meta.stale ? t("staleModel") : `${t("readyModel")}: ${formatPreparedAt(report.meta.preparedAt)}`}
          </p>
        ) : null}
        <div className="moduleMetricGrid">
          <section className="moduleMetricCard">
            <span>{groupLabel}</span>
            <strong>{categories.length}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--green">
            <span>{t("growing")}</span>
            <strong>{report.meta?.growingCount || 0}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--red">
            <span>{t("declining")}</span>
            <strong>{report.meta?.decliningCount || 0}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--orange">
            <span>{t("warnings")}</span>
            <strong>{report.meta?.warningCount || 0}</strong>
          </section>
          <section className="moduleMetricCard">
            <span>{t("lifetime")}</span>
            <strong>{formatMoneyAmount(report.lifetimeTotal)}</strong>
          </section>
          <section className={`moduleMetricCard ${trendClass(report.yoyPercent)}`}>
            <span>{t("companyYoy")}</span>
            <strong>{formatGrowthPercent(report.yoyPercent)}</strong>
          </section>
        </div>
        <div className="moduleHint">{t("range")}: {historyLabel}</div>
        {categories.length > 0 ? (
          <div className="moduleBiChartGrid">
            <GrowthChartPanel title={t("signalChart")}>
              <GrowthSignalChart counts={signalMix} />
            </GrowthChartPanel>
            <GrowthChartPanel title={t("shareChart")}>
              <GrowthBarChart items={shareItems} formatValue={formatMoneyAmount} />
            </GrowthChartPanel>
          </div>
        ) : null}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("redAlerts")}</h2>
        </div>
        {(report.alerts || []).length === 0 ? (
          <div className="moduleHint">{t("noAlerts")}</div>
        ) : (
          <div className="moduleBusinessAlertList">
            {(report.alerts || []).map((alert) => (
              <article key={alert.code} className="moduleBusinessAlert moduleBusinessAlert--red">
                <div className="moduleBusinessAlertBody">
                  <strong>{alert.title}</strong>
                  <p>{alert.detail}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("yearly")}</h2>
        </div>
        <p className="moduleHint">{t("yearlyHint")}</p>
        {categories.length > 0 ? (
          <GrowthChartPanel title={t("trendChart")} hint={t("chartHint")}>
            <GrowthTrendChart
              periods={yearChart.periods}
              series={yearChart.series}
              periodLabel={(year) => (year === currentYear ? `${year} YTD` : year)}
              formatValue={formatMoneyAmount}
            />
          </GrowthChartPanel>
        ) : null}
        {categories.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
        <ExportableTable filename={`sales-growth-${groupBy}`} sheetName="Growth" className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>{groupLabel}</th>
                <th>{t("firstSale")}</th>
                <th>{t("lastSale")}</th>
                <th>{t("lifetime")}</th>
                <th>{t("share")}</th>
                <th>{t("cagr")}</th>
                <th>{t("yoy")}</th>
                <th>{t("mom")}</th>
                <th>{t("status")}</th>
                {years.map((year) => (
                  <th key={year} className={year === currentYear ? "moduleBiMonthHead--current" : ""}>
                    {year === currentYear ? `${year} YTD` : year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={row.label || row.category}>
                  <td>{row.label || row.category}</td>
                  <td>{row.firstDate}</td>
                  <td>{row.lastDate}</td>
                  <td>{formatMoneyAmount(row.lifetime)}</td>
                  <td>{formatSharePercent(row.sharePercent)}</td>
                  <td className={periodCellClass(percentTone(row.cagrPercent))}>{formatGrowthPercent(row.cagrPercent)}</td>
                  <td className={periodCellClass(percentTone(row.yoyPercent))}>{formatGrowthPercent(row.yoyPercent)}</td>
                  <td className={periodCellClass(percentTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                  <td>
                    <span className={statusClass(row.status)}>{row.statusLabel}</span>
                  </td>
                  {years.map((year, index) => {
                    const amount = Number(row.yearValues?.[year] || 0);
                    const previousYear = index > 0 ? years[index - 1] : "";
                    const previous = previousYear ? Number(row.yearValues?.[previousYear] || 0) : 0;
                    const tone = monthChangeTone(amount, previous, Boolean(previousYear));
                    return (
                      <td key={year} className={periodCellClass(tone, year === currentYear)}>
                        {amount ? formatMoneyAmount(amount) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ExportableTable>
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("quarterly")}</h2>
        </div>
        <p className="moduleHint">{t("quarterlyHint")}</p>
        {categories.length > 0 ? (
          <GrowthChartPanel title={t("trendChart")} hint={t("chartHint")}>
            <GrowthTrendChart
              periods={quarterChart.periods}
              series={quarterChart.series}
              periodLabel={quarterLabel}
              formatValue={formatMoneyAmount}
            />
          </GrowthChartPanel>
        ) : null}
        {categories.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <GrowthPeriodGrid
            filename={`sales-growth-${groupBy}-quarters`}
            sheetName="Last 8 Quarters"
            rowHeader={groupLabel}
            rows={categories}
            periods={recentQuarters}
            currentPeriod={currentQuarter}
            periodLabel={quarterLabel}
            valuesOf={(row) => row.quarterValues}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousQuarterKey(period))}
            totals={quarterTotals}
            totalLabel={t("total")}
          />
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("monthly")}</h2>
        </div>
        <p className="moduleHint">{t("monthlyHint")}</p>
        {categories.length > 0 ? (
          <GrowthChartPanel title={t("trendChart")} hint={t("chartHint")}>
            <GrowthTrendChart
              periods={monthChart.periods}
              series={monthChart.series}
              periodLabel={(month) => monthLabel(month, currentMonth)}
              formatValue={formatMoneyAmount}
            />
          </GrowthChartPanel>
        ) : null}
        {categories.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <GrowthPeriodGrid
            filename={`sales-growth-${groupBy}-months`}
            sheetName="Last 12 Months"
            rowHeader={groupLabel}
            rows={categories}
            periods={recentMonths}
            currentPeriod={currentMonth}
            periodLabel={monthLabel}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousMonthKey(period))}
            totals={monthTotals}
            totalLabel={t("total")}
          />
        )}
      </section>
    </>
  );
}
