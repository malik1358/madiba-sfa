"use client";

import { useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import CategoryGrowthFilters, { filterGrowthRows } from "./CategoryGrowthFilters";
import {
  emptyGrowthFilters,
  formatGrowthPercent,
  formatMoneyAmount,
  monthGridTotals,
  previousMonthKey,
  previousQuarterKey,
  quarterGridTotals,
  quarterLabel,
} from "../../lib/categoryGrowth";
import { buildSalesmanMomRows, resolveMomComparisonMonths, summarizeSalesmanMom } from "../../lib/salesmanMom";
import { buildTeamMomRows } from "../../lib/salesmanTeamMom";
import { translate } from "../../lib/appLanguage";
import GrowthPeriodGrid from "./GrowthPeriodGrid";

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
  teams: { en: "Teams", ar: "الفرق" },
  teamSummary: { en: "Team month-on-month performance", ar: "أداء الفريق شهراً بعد شهر" },
  teamSummaryHint: {
    en: "Each team is the first-level leader plus the salesmen who report to that leader. Green and red follow the same month-on-month rules as the salesman scorecard.",
    ar: "كل فريق هو القائد من المستوى الأول والمندوبون التابعون له. الأخضر والأحمر بنفس قواعد المندوب شهراً بعد شهر.",
  },
  teamScorecard: { en: "Team month-on-month scorecard", ar: "بطاقة الفريق شهراً بعد شهر" },
  team: { en: "Team", ar: "الفريق" },
  people: { en: "People", ar: "الأفراد" },
  teamMonthly: { en: "Team last 12 months", ar: "الفريق آخر 12 شهراً" },
  teamQuarterly: { en: "Team last 8 quarters", ar: "الفريق آخر 8 أرباع" },
  teamAlerts: { en: "Teams not improving", ar: "فرق لا تتحسن" },
  noTeamAlerts: { en: "No team is flagged as not improving.", ar: "لا يوجد فريق مُعلَّم بأنه لا يتحسن." },
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
  quarterly: { en: "Last 8 quarters", ar: "آخر 8 أرباع" },
  total: { en: "Total", ar: "الإجمالي" },
  monthlyHint: {
    en: "Green is higher than the previous month. Red is lower. The current month is month-to-date only.",
    ar: "الأخضر أعلى من الشهر السابق. الأحمر أقل. الشهر الحالي حتى اليوم فقط.",
  },
  quarterlyHint: {
    en: "Green is higher than the previous quarter. Red is lower. The current quarter is quarter-to-date only.",
    ar: "الأخضر أعلى من الربع السابق. الأحمر أقل. الربع الحالي حتى اليوم فقط.",
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

function MomScorecardTable({
  filename,
  sheetName,
  nameHeader,
  rows,
  latestCompleteMonth,
  priorCompleteMonth,
  showPeople = false,
  peopleHeader = "People",
  t,
}) {
  const lastMonthHeader = latestCompleteMonth
    ? `${t("lastMonth")} (${monthLabel(latestCompleteMonth, "")})`
    : t("lastMonth");
  const priorMonthHeader = priorCompleteMonth
    ? `${t("priorMonth")} (${monthLabel(priorCompleteMonth, "")})`
    : t("priorMonth");
  return (
    <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <th>{nameHeader}</th>
            {showPeople ? <th>{peopleHeader}</th> : null}
            <th>{lastMonthHeader}</th>
            <th>{priorMonthHeader}</th>
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
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {showPeople ? <td>{row.memberCount || 0}</td> : null}
              <td>{row.latestCompleteAmount ? formatMoneyAmount(row.latestCompleteAmount) : "—"}</td>
              <td>{row.priorMonthAmount ? formatMoneyAmount(row.priorMonthAmount) : "—"}</td>
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
  );
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
  const teamRows = useMemo(() => buildTeamMomRows(report || {}), [report]);
  const visibleRows = useMemo(
    () => filterGrowthRows(allRows, {
      search,
      statusFilter,
      statusOf: (row) => row.trajectory?.status,
    }),
    [allRows, search, statusFilter],
  );
  const visibleTeamRows = useMemo(
    () => filterGrowthRows(teamRows, {
      search,
      statusFilter,
      statusOf: (row) => row.trajectory?.status,
    }),
    [teamRows, search, statusFilter],
  );
  const summary = useMemo(() => summarizeSalesmanMom(allRows), [allRows]);
  const teamSummary = useMemo(() => summarizeSalesmanMom(teamRows), [teamRows]);
  const recentMonths = report?.recentMonths || [];
  const currentMonth = report?.currentMonth || "";
  const recentQuarters = report?.recentQuarters || [];
  const currentQuarter = report?.currentQuarter || "";
  const monthTotals = useMemo(
    () => monthGridTotals(visibleRows, recentMonths),
    [visibleRows, recentMonths],
  );
  const quarterTotals = useMemo(
    () => quarterGridTotals(visibleRows, recentQuarters),
    [visibleRows, recentQuarters],
  );
  const teamMonthTotals = useMemo(
    () => monthGridTotals(visibleTeamRows, recentMonths),
    [visibleTeamRows, recentMonths],
  );
  const teamQuarterTotals = useMemo(
    () => quarterGridTotals(visibleTeamRows, recentQuarters),
    [visibleTeamRows, recentQuarters],
  );
  const { latestCompleteMonth, priorCompleteMonth } = resolveMomComparisonMonths(report || {});

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
        {report.meta?.preparedAt ? (
          <p className="moduleHint">
            {report.meta.stale ? t("staleModel") : `${t("readyModel")}: ${formatPreparedAt(report.meta.preparedAt)}`}
          </p>
        ) : null}
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
          <MomScorecardTable
            filename="salesman-month-on-month"
            sheetName="Salesman MoM"
            nameHeader={t("salesman")}
            rows={visibleRows}
            latestCompleteMonth={latestCompleteMonth}
            priorCompleteMonth={priorCompleteMonth}
            t={t}
          />
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("quarterly")}</h2>
        </div>
        <p className="moduleHint">{t("quarterlyHint")}</p>
        {visibleRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <GrowthPeriodGrid
            filename="salesman-month-on-month-quarters"
            sheetName="Last 8 Quarters"
            rowHeader={t("salesman")}
            rows={visibleRows}
            periods={recentQuarters}
            currentPeriod={currentQuarter}
            periodLabel={quarterLabel}
            valuesOf={(row) => row.quarterValues}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousQuarterKey(period))}
            totals={quarterTotals}
            totalLabel={t("total")}
            rowKeyOf={(row) => row.label}
          />
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
          <GrowthPeriodGrid
            filename="salesman-month-on-month-months"
            sheetName="Last 12 Months"
            rowHeader={t("salesman")}
            rows={visibleRows}
            periods={recentMonths}
            currentPeriod={currentMonth}
            periodLabel={monthLabel}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousMonthKey(period))}
            totals={monthTotals}
            totalLabel={t("total")}
            rowKeyOf={(row) => row.label}
          />
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("teamSummary")}</h2>
        </div>
        <p className="moduleHint">{t("teamSummaryHint")}</p>
        <div className="moduleMetricGrid">
          <section className="moduleMetricCard">
            <span>{t("teams")}</span>
            <strong>{teamSummary.salesmanCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--green">
            <span>{t("improving")}</span>
            <strong>{teamSummary.improvingCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--orange">
            <span>{t("slipping")}</span>
            <strong>{teamSummary.slippingCount}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--red">
            <span>{t("notImproving")}</span>
            <strong>{teamSummary.notImprovingCount}</strong>
          </section>
        </div>
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("teamAlerts")}</h2>
        </div>
        {teamSummary.alerts.length === 0 ? (
          <div className="moduleHint">{t("noTeamAlerts")}</div>
        ) : (
          <div className="moduleBusinessAlertList">
            {teamSummary.alerts.map((alert) => (
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
          <h2>{t("teamScorecard")}</h2>
        </div>
        {visibleTeamRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <MomScorecardTable
            filename="team-month-on-month"
            sheetName="Team MoM"
            nameHeader={t("team")}
            rows={visibleTeamRows}
            latestCompleteMonth={latestCompleteMonth}
            priorCompleteMonth={priorCompleteMonth}
            showPeople
            peopleHeader={t("people")}
            t={t}
          />
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("teamQuarterly")}</h2>
        </div>
        <p className="moduleHint">{t("quarterlyHint")}</p>
        {visibleTeamRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <GrowthPeriodGrid
            filename="team-month-on-month-quarters"
            sheetName="Team Last 8 Quarters"
            rowHeader={t("team")}
            rows={visibleTeamRows}
            periods={recentQuarters}
            currentPeriod={currentQuarter}
            periodLabel={quarterLabel}
            valuesOf={(row) => row.quarterValues}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousQuarterKey(period))}
            totals={teamQuarterTotals}
            totalLabel={t("total")}
            rowKeyOf={(row) => row.label}
          />
        )}
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("teamMonthly")}</h2>
        </div>
        <p className="moduleHint">{t("monthlyHint")}</p>
        {visibleTeamRows.length === 0 ? (
          <div className="moduleHint">{t("emptySlice")}</div>
        ) : (
          <GrowthPeriodGrid
            filename="team-month-on-month-months"
            sheetName="Team Last 12 Months"
            rowHeader={t("team")}
            rows={visibleTeamRows}
            periods={recentMonths}
            currentPeriod={currentMonth}
            periodLabel={monthLabel}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousMonthKey(period))}
            totals={teamMonthTotals}
            totalLabel={t("total")}
            rowKeyOf={(row) => row.label}
          />
        )}
      </section>
    </>
  );
}

export function emptySalesmanMomFilters() {
  return { ...emptyGrowthFilters(), groupBy: "salesman" };
}
