"use client";

import { useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import CategoryGrowthFilters, { filterGrowthRows } from "./CategoryGrowthFilters";
import { formatGrowthPercent, formatMoneyAmount, formatSharePercent, growthDimensionLabel } from "../../lib/categoryGrowth";
import { translate } from "../../lib/appLanguage";

const TEXT = {
  loading: { en: "Loading category growth from uploaded sales...", ar: "جاري تحميل نمو الفئات من المبيعات المرفوعة..." },
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
  monthly: { en: "Last 12 months", ar: "آخر 12 شهراً" },
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

function trendClass(value) {
  if (value == null || !Number.isFinite(value)) return "";
  if (value <= -15) return "moduleBiTrend--downHard";
  if (value < 0) return "moduleBiTrend--down";
  if (value >= 5) return "moduleBiTrend--up";
  return "";
}

function monthLabel(month) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
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
  const recentMonths = report?.recentMonths || [];

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
                  <th key={year}>{year}</th>
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
                  <td className={trendClass(row.cagrPercent)}>{formatGrowthPercent(row.cagrPercent)}</td>
                  <td className={trendClass(row.yoyPercent)}>{formatGrowthPercent(row.yoyPercent)}</td>
                  <td className={trendClass(row.momPercent)}>{formatGrowthPercent(row.momPercent)}</td>
                  <td>
                    <span className={statusClass(row.status)}>{row.statusLabel}</span>
                  </td>
                  {years.map((year) => (
                    <td key={year}>{row.yearValues?.[year] ? formatMoneyAmount(row.yearValues[year]) : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ExportableTable>
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("monthly")}</h2>
        </div>
        {categories.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
        <ExportableTable filename={`sales-growth-${groupBy}-months`} sheetName="Last 12 Months" className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>{groupLabel}</th>
                {recentMonths.map((month) => (
                  <th key={month}>{monthLabel(month)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={`month-${row.label || row.category}`}>
                  <td>{row.label || row.category}</td>
                  {recentMonths.map((month) => (
                    <td key={month}>
                      {row.monthValues?.[month] ? formatMoneyAmount(row.monthValues[month]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ExportableTable>
        )}
      </section>
    </>
  );
}
