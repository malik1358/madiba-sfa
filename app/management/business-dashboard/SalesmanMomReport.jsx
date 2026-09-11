"use client";

import { useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import CategoryGrowthFilters, { filterGrowthRows } from "./CategoryGrowthFilters";
import {
  emptyGrowthFilters,
  formatGrowthPercent,
  formatMoneyAmount,
  monthChangeTone,
  previousMonthKey,
} from "../../lib/categoryGrowth";
import { buildSalesmanMomRows, summarizeSalesmanMom } from "../../lib/salesmanMom";
import { translate } from "../../lib/appLanguage";

const TEXT = {
  loading: { en: "Measuring salesman month-on-month performance...", ar: "جاري قياس أداء المندوبين شهراً بعد شهر..." },
  empty: {
    en: "No uploaded sales found. Import a sales file first, then open this report.",
    ar: "لا توجد مبيعات مرفوعة. استورد ملف المبيعات أولاً ثم افتح هذا التقرير.",
  },
  emptySlice: {
    en: "No salesmen match the current slice.",
    ar: "لا يوجد مندوبون يطابقون الشريحة الحالية.",
  },
  missingTable: {
    en: "Sales table is not available yet, so this report cannot be built.",
    ar: "جدول المبيعات غير متاح بعد، لذلك لا يمكن بناء هذا التقرير.",
  },
  summary: { en: "Salesman month-on-month performance", ar: "أداء المندوب شهراً بعد شهر" },
  summaryHint: {
    en: "Latest complete month vs the month before it. Improving means sales are rising month after month. Current month is MTD only and is not used in the streak.",
    ar: "آخر شهر مكتمل مقابل الشهر السابق. التحسن يعني ارتفاع المبيعات شهراً بعد شهر. الشهر الحالي حتى اليوم فقط ولا يُحسب في التسلسل.",
  },
  filterHint: {
    en: "Filter the salesman scorecard by any imported sales field, then Apply.",
    ar: "صفّ بطاقة المندوبين بأي حقل مبيعات ثم اضغط تطبيق.",
  },
  salesmen: { en: "Salesmen", ar: "المندوبون" },
  improving: { en: "Improving", ar: "يتحسن" },
  slipping: { en: "Slipping / flat", ar: "يتراجع / ثابت" },
  notImproving: { en: "Not improving", ar: "لا يتحسن" },
  redAlerts: { en: "Salesmen not improving", ar: "مندوبون لا يتحسنون" },
  noAlerts: { en: "No salesman is flagged as not improving.", ar: "لا يوجد مندوب مُعلَّم بأنه لا يتحسن." },
  scorecard: { en: "Month-on-month scorecard", ar: "بطاقة شهر بعد شهر" },
  salesman: { en: "Salesman", ar: "المندوب" },
  lastMonth: { en: "Last complete month", ar: "آخر شهر مكتمل" },
  priorMonth: { en: "Month before", ar: "الشهر السابق" },
  mom: { en: "MoM", ar: "مقابل الشهر السابق" },
  avgMom: { en: "Avg MoM (6 mo)", ar: "متوسط النمو (6 أشهر)" },
  upMonths: { en: "Up months", ar: "أشهر صاعدة" },
  downMonths: { en: "Down months", ar: "أشهر هابطة" },
  streak: { en: "Streak", ar: "التسلسل" },
  mtd: { en: "Current MTD", ar: "الحالي حتى اليوم" },
  signal: { en: "Measure", ar: "القياس" },
  monthly: { en: "Last 12 months", ar: "آخر 12 شهراً" },
  monthlyHint: {
    en: "Green is higher than the previous month. Red is lower. The current month is month-to-date only.",
    ar: "الأخضر أعلى من الشهر السابق. الأحمر أقل. الشهر الحالي حتى اليوم فقط.",
  },
};

const STATUS_OPTIONS = [
  { key: "green", en: "Improving", ar: "يتحسن" },
  { key: "orange", en: "Slipping / flat", ar: "يتراجع / ثابت" },
  { key: "red", en: "Not improving", ar: "لا يتحسن" },
  { key: "neutral", en: "Limited history", ar: "تاريخ محدود" },
];

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

function monthLabel(month, currentMonth) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} MTD` : label;
}

function streakLabel(row) {
  if (row.improvingStreak >= 2) return `${row.improvingStreak} up`;
  if (row.decliningStreak >= 2) return `${row.decliningStreak} down`;
  if (row.improvingStreak === 1) return "1 up";
  if (row.decliningStreak === 1) return "1 down";
  return "—";
}

export default function SalesmanMomReport({
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
  onApply,
  onClear,
}) {
  const t = translate(language, TEXT);
  const allRows = useMemo(() => buildSalesmanMomRows(report || {}), [report]);
  const visibleRows = useMemo(
    () => filterGrowthRows(allRows, {
      search,
      statusFilter,
      statusOf: (row) => row.trajectory?.status,
    }),
    [allRows, search, statusFilter],
  );
  const summary = useMemo(() => summarizeSalesmanMom(allRows), [allRows]);
  const recentMonths = report?.recentMonths || [];
  const currentMonth = report?.currentMonth || "";
  const latestCompleteMonth = report?.latestCompleteMonth || "";
  const priorCompleteMonth = previousMonthKey(latestCompleteMonth);

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
      onGroupByChange={() => {}}
      onApply={onApply}
      onClear={onClear}
      lockGroupBy="salesman"
      statusOptions={STATUS_OPTIONS}
      hint={t("filterHint")}
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

  if (!allRows.length) {
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
            <span>{t("salesmen")}</span>
            <strong>{summary.salesmanCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--green">
            <span>{t("improving")}</span>
            <strong>{summary.improvingCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--orange">
            <span>{t("slipping")}</span>
            <strong>{summary.slippingCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--red">
            <span>{t("notImproving")}</span>
            <strong>{summary.notImprovingCount}</strong>
          </section>
        </div>
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("redAlerts")}</h2>
        </div>
        {summary.alerts.length === 0 ? (
          <div className="moduleHint">{t("noAlerts")}</div>
        ) : (
          <div className="moduleBusinessAlertList">
            {summary.alerts.map((alert) => (
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
          <h2>{t("scorecard")}</h2>
        </div>
        {visibleRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <ExportableTable filename="salesman-month-on-month" sheetName="Salesman MoM" className="moduleTableWrap moduleBiTableWrap">
            <table className="moduleTable moduleBiTable">
              <thead>
                <tr>
                  <th>{t("salesman")}</th>
                  <th>{t("lastMonth")}</th>
                  <th>{t("priorMonth")}</th>
                  <th>{t("mom")}</th>
                  <th>{t("avgMom")}</th>
                  <th>{t("upMonths")}</th>
                  <th>{t("downMonths")}</th>
                  <th>{t("streak")}</th>
                  <th>{t("mtd")}</th>
                  <th>{t("signal")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.latestCompleteAmount ? formatMoneyAmount(row.latestCompleteAmount) : "—"}</td>
                    <td>{row.monthValues?.[priorCompleteMonth] ? formatMoneyAmount(row.monthValues[priorCompleteMonth]) : "—"}</td>
                    <td className={trendClass(row.momPercent)}>{formatGrowthPercent(row.momPercent)}</td>
                    <td className={trendClass(row.avgMomPercent)}>{formatGrowthPercent(row.avgMomPercent)}</td>
                    <td>{row.upMonths}</td>
                    <td>{row.downMonths}</td>
                    <td>{streakLabel(row)}</td>
                    <td>{row.mtdAmount ? formatMoneyAmount(row.mtdAmount) : "—"}</td>
                    <td>
                      <span className={statusClass(row.trajectory.status)}>{row.trajectory.label}</span>
                    </td>
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
        <p className="moduleHint">{t("monthlyHint")}</p>
        {visibleRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <ExportableTable filename="salesman-month-on-month-months" sheetName="Last 12 Months" className="moduleTableWrap moduleBiTableWrap">
            <table className="moduleTable moduleBiTable">
              <thead>
                <tr>
                  <th>{t("salesman")}</th>
                  {recentMonths.map((month) => (
                    <th key={month} className={month === currentMonth ? "moduleBiMonthHead--current" : ""}>
                      {monthLabel(month, currentMonth)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`month-${row.label}`}>
                    <td>{row.label}</td>
                    {recentMonths.map((month, index) => {
                      const amount = Number(row.monthValues?.[month] || 0);
                      const previousKey = index > 0 ? recentMonths[index - 1] : previousMonthKey(month);
                      const previous = Number(row.monthValues?.[previousKey] || 0);
                      const tone = monthChangeTone(amount, previous, Boolean(previousKey));
                      const isCurrent = month === currentMonth;
                      return (
                        <td
                          key={month}
                          className={[
                            tone ? `moduleBiMonthCell--${tone}` : "",
                            isCurrent ? "moduleBiMonthCell--current" : "",
                          ].filter(Boolean).join(" ")}
                        >
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
    </>
  );
}

export function emptySalesmanMomFilters() {
  return { ...emptyGrowthFilters(), groupBy: "salesman" };
}
