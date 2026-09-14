"use client";

import { useMemo } from "react";
import { translate } from "../../lib/appLanguage";
import { buildBiOverviewModel, formatOverviewKpi, overviewKpiTone } from "../../lib/biOverview";
import {
  formatContributionPercent,
  formatGrowthPercent,
  formatMoneyAmount,
  formatSharePercent,
  monthChangeTone,
  previousMonthKey,
} from "../../lib/categoryGrowth";
import { buildPeriodChartModel, buildShareChartItems, buildSignalMix } from "../../lib/growthCharts";
import { GrowthBarChart, GrowthChartPanel, GrowthSignalChart, GrowthTrendChart } from "./GrowthCharts";
import GrowthPeriodGrid from "./GrowthPeriodGrid";

const TEXT = {
  title: { en: "Business Intelligence dashboard", ar: "لوحة ذكاء الأعمال" },
  hint: {
    en: "Tap any card to open that report.",
    ar: "اضغط أي بطاقة لفتح ذلك التقرير.",
  },
  openReport: { en: "Open report", ar: "فتح التقرير" },
  loading: { en: "Opening the prepared dashboard...", ar: "جاري فتح اللوحة الجاهزة..." },
  empty: { en: "Upload sales to fill this dashboard.", ar: "ارفع المبيعات لتعبئة هذه اللوحة." },
  lifetime: { en: "Lifetime", ar: "العمر" },
  ytd: { en: "YTD", ar: "هذا العام" },
  yoy: { en: "YTD vs last year", ar: "هذا العام مقابل الماضي" },
  categories: { en: "Categories", ar: "الفئات" },
  customers: { en: "Customers", ar: "العملاء" },
  customerGrowing: { en: "Growing customers", ar: "عملاء نامون" },
  customerDeclining: { en: "Customer red lights", ar: "عملاء بإشارات حمراء" },
  items: { en: "Items", ar: "الأصناف" },
  itemGrowing: { en: "Growing items", ar: "أصناف نامية" },
  itemDeclining: { en: "Item red lights", ar: "أصناف بإشارات حمراء" },
  growing: { en: "Growing", ar: "نمو" },
  declining: { en: "Red lights", ar: "إشارات حمراء" },
  salesmen: { en: "Salesmen", ar: "المندوبون" },
  improving: { en: "Improving", ar: "يتحسن" },
  notImproving: { en: "Not improving", ar: "لا يتحسن" },
  teams: { en: "Teams / channels", ar: "الفرق / القنوات" },
  openCategory: { en: "Category growth", ar: "نمو الفئات" },
  openCustomer: { en: "Customer growth", ar: "نمو العملاء" },
  openItem: { en: "Item growth", ar: "نمو الأصناف" },
  openContribution: { en: "Contribution %", ar: "نسبة المساهمة" },
  openSalesman: { en: "Salesman MoM", ar: "المندوب شهرياً" },
  openTeams: { en: "Teams, ecom, store", ar: "الفرق والإلكترون والمتجر" },
  openOperations: { en: "Daily operations", ar: "التشغيل اليومي" },
  topCategories: { en: "Top categories", ar: "أعلى الفئات" },
  topCustomers: { en: "Top customers", ar: "أعلى العملاء" },
  topItems: { en: "Top items", ar: "أعلى الأصناف" },
  contribution: { en: "Contribution last 6 months", ar: "المساهمة آخر 6 أشهر" },
  salesmanPulse: { en: "Salesman pulse", ar: "نبض المندوبين" },
  teamPulse: { en: "Team and channel pulse", ar: "نبض الفرق والقنوات" },
  shareChart: { en: "Share of lifetime", ar: "حصة العمر" },
  signalChart: { en: "Category signals", ar: "إشارات الفئات" },
  trendChart: { en: "Top category trend", ar: "اتجاه أعلى الفئات" },
  opsRed: { en: "Ops red alerts", ar: "تنبيهات التشغيل الحمراء" },
  opsWarn: { en: "Ops warnings", ar: "تحذيرات التشغيل" },
  name: { en: "Name", ar: "الاسم" },
  lifetimeCol: { en: "Lifetime", ar: "العمر" },
  share: { en: "Share", ar: "الحصة" },
  lastMonth: { en: "Last complete", ar: "آخر مكتمل" },
  mom: { en: "MoM", ar: "شهرياً" },
  signal: { en: "Signal", ar: "الإشارة" },
  total: { en: "Total", ar: "الإجمالي" },
};

function toneClass(tone) {
  if (tone === "up") return "moduleBiMonthCell--up";
  if (tone === "down") return "moduleBiMonthCell--down";
  return "";
}

function kpiCardClass(tone) {
  if (tone === "up" || tone === "green") return "moduleBiDashKpi moduleBiDashKpi--up";
  if (tone === "down" || tone === "red") return "moduleBiDashKpi moduleBiDashKpi--down";
  if (tone === "orange") return "moduleBiDashKpi moduleBiDashKpi--watch";
  return "moduleBiDashKpi";
}

function statusClass(status) {
  if (status === "red") return "moduleKpiStatus moduleKpiStatus--behind";
  if (status === "orange") return "moduleKpiStatus moduleKpiStatus--onTrack";
  if (status === "green") return "moduleKpiStatus moduleKpiStatus--achieved";
  return "moduleKpiStatus moduleKpiStatus--neutral";
}

function DashLink({ className, view, section, onOpen, label, children }) {
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={() => onOpen?.(view, section)}
    >
      {children}
    </button>
  );
}

function monthLabel(month, currentMonth) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} MTD` : label;
}

export default function BiOverviewDashboard({
  language,
  loading,
  growthReport,
  salesmanReport,
  customerReport,
  itemReport,
  operations,
  onOpen,
}) {
  const t = translate(language, TEXT);
  const model = useMemo(
    () => buildBiOverviewModel({ growth: growthReport, salesman: salesmanReport, customer: customerReport, item: itemReport }),
    [customerReport, growthReport, itemReport, salesmanReport],
  );
  const shareItems = useMemo(() => buildShareChartItems(model.topCategories), [model.topCategories]);
  const signalMix = useMemo(() => buildSignalMix(model.topCategories), [model.topCategories]);
  const monthChart = useMemo(
    () => buildPeriodChartModel(model.topCategories, model.recentMonths),
    [model.recentMonths, model.topCategories],
  );

  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!model.categoryCount && !model.salesmanSummary.salesmanCount && !model.customerCount && !model.itemCount) {
    return <div className="moduleHint">{t("empty")}</div>;
  }

  return (
    <>
      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>{t("title")}</h2>
        </div>
        <p className="moduleHint">{t("hint")}</p>
        <div className="moduleBiDashKpis">
          <DashLink className={kpiCardClass(overviewKpiTone(model.yoyPercent))} view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("lifetime")}</span>
            <strong>{formatOverviewKpi(model.lifetimeTotal)}</strong>
          </DashLink>
          <DashLink className={kpiCardClass(overviewKpiTone(model.yoyPercent))} view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("ytd")}</span>
            <strong>{formatOverviewKpi(model.currentYtd)}</strong>
            <em>{t("yoy")} {formatOverviewKpi(model.yoyPercent, "percent")}</em>
          </DashLink>
          <DashLink className="moduleBiDashKpi" view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("categories")}</span>
            <strong>{model.categoryCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("green")} view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("growing")}</span>
            <strong>{model.growingCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("red")} view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("declining")}</span>
            <strong>{model.decliningCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashKpi" view="customer-growth" section="bi-customer-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCustomer")}`}>
            <span>{t("customers")}</span>
            <strong>{model.customerCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("green")} view="customer-growth" section="bi-customer-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCustomer")}`}>
            <span>{t("customerGrowing")}</span>
            <strong>{model.customerGrowingCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("red")} view="customer-growth" section="bi-customer-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCustomer")}`}>
            <span>{t("customerDeclining")}</span>
            <strong>{model.customerDecliningCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashKpi" view="item-growth" section="bi-item-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openItem")}`}>
            <span>{t("items")}</span>
            <strong>{model.itemCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("green")} view="item-growth" section="bi-item-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openItem")}`}>
            <span>{t("itemGrowing")}</span>
            <strong>{model.itemGrowingCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("red")} view="item-growth" section="bi-item-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openItem")}`}>
            <span>{t("itemDeclining")}</span>
            <strong>{model.itemDecliningCount}</strong>
          </DashLink>
          <DashLink className={kpiCardClass("green")} view="salesman-mom" section="bi-salesman-mom" onOpen={onOpen} label={`${t("openReport")}: ${t("openSalesman")}`}>
            <span>{t("improving")}</span>
            <strong>{model.salesmanSummary.improvingCount}</strong>
            <em>{t("salesmen")} {model.salesmanSummary.salesmanCount}</em>
          </DashLink>
          <DashLink className={kpiCardClass("red")} view="salesman-mom" section="bi-salesman-mom" onOpen={onOpen} label={`${t("openReport")}: ${t("openSalesman")}`}>
            <span>{t("notImproving")}</span>
            <strong>{model.salesmanSummary.notImprovingCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashKpi" view="salesman-mom" section="bi-teams" onOpen={onOpen} label={`${t("openReport")}: ${t("openTeams")}`}>
            <span>{t("teams")}</span>
            <strong>{model.teamSummary.salesmanCount}</strong>
          </DashLink>
          {operations ? (
            <>
              <DashLink className={kpiCardClass("red")} view="operations" section="bi-operations" onOpen={onOpen} label={`${t("openReport")}: ${t("openOperations")}`}>
                <span>{t("opsRed")}</span>
                <strong>{operations.redAlerts || 0}</strong>
              </DashLink>
              <DashLink className={kpiCardClass("orange")} view="operations" section="bi-operations" onOpen={onOpen} label={`${t("openReport")}: ${t("openOperations")}`}>
                <span>{t("opsWarn")}</span>
                <strong>{operations.orangeAlerts || 0}</strong>
              </DashLink>
            </>
          ) : null}
        </div>
      </section>

      <section className="moduleSection">
        <div className="moduleBiDashLaunch">
          <DashLink className="moduleBiDashLaunchCard" view="category-growth" section="bi-category-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCategory")}`}>
            <span>{t("openCategory")}</span>
            <strong>{model.categoryCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--cyan" view="customer-growth" section="bi-customer-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openCustomer")}`}>
            <span>{t("openCustomer")}</span>
            <strong>{model.customerCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--purple" view="item-growth" section="bi-item-growth" onOpen={onOpen} label={`${t("openReport")}: ${t("openItem")}`}>
            <span>{t("openItem")}</span>
            <strong>{model.itemCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--teal" view="category-growth" section="bi-contribution" onOpen={onOpen} label={`${t("openReport")}: ${t("openContribution")}`}>
            <span>{t("openContribution")}</span>
            <strong>{formatSharePercent(model.topCategories[0]?.sharePercent)}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--green" view="salesman-mom" section="bi-salesman-mom" onOpen={onOpen} label={`${t("openReport")}: ${t("openSalesman")}`}>
            <span>{t("openSalesman")}</span>
            <strong>{model.salesmanSummary.salesmanCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--navy" view="salesman-mom" section="bi-teams" onOpen={onOpen} label={`${t("openReport")}: ${t("openTeams")}`}>
            <span>{t("openTeams")}</span>
            <strong>{model.teamSummary.salesmanCount}</strong>
          </DashLink>
          <DashLink className="moduleBiDashLaunchCard moduleBiDashLaunchCard--orange" view="operations" section="bi-operations" onOpen={onOpen} label={`${t("openReport")}: ${t("openOperations")}`}>
            <span>{t("openOperations")}</span>
            <strong>{operations?.redAlerts || 0}</strong>
          </DashLink>
        </div>
      </section>

      {model.topCategories.length ? (
        <section className="moduleSection">
          <div className="moduleBiChartGrid">
            <GrowthChartPanel title={t("shareChart")}>
              <GrowthBarChart items={shareItems} formatValue={formatMoneyAmount} />
            </GrowthChartPanel>
            <GrowthChartPanel title={t("signalChart")}>
              <GrowthSignalChart counts={signalMix} />
            </GrowthChartPanel>
            <GrowthChartPanel title={t("trendChart")}>
              <GrowthTrendChart
                periods={monthChart.periods}
                series={monthChart.series}
                periodLabel={(month) => monthLabel(month, model.currentMonth)}
                formatValue={formatMoneyAmount}
              />
            </GrowthChartPanel>
          </div>
        </section>
      ) : null}

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>
            <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("category-growth", "bi-category-growth")}>
              {t("topCategories")}
            </button>
          </h2>
        </div>
        <div className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("lifetimeCol")}</th>
                <th>{t("share")}</th>
                <th>{t("yoy")}</th>
                <th>{t("mom")}</th>
                <th>{t("signal")}</th>
              </tr>
            </thead>
            <tbody>
              {model.topCategories.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="moduleBiTotalCol">{formatMoneyAmount(row.lifetime)}</td>
                  <td>{formatContributionPercent(row.sharePercent)}</td>
                  <td className={toneClass(overviewKpiTone(row.yoyPercent))}>{formatGrowthPercent(row.yoyPercent)}</td>
                  <td className={toneClass(overviewKpiTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                  <td><span className={statusClass(row.status)}>{row.statusLabel || row.status}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("total")}</td>
                <td className="moduleBiTotalCol">{formatMoneyAmount(model.topCategories.reduce((sum, row) => sum + Number(row.lifetime || 0), 0))}</td>
                <td>{formatContributionPercent(model.topCategories.reduce((sum, row) => sum + Number(row.sharePercent || 0), 0))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {model.topCustomers.length ? (
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>
              <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("customer-growth", "bi-customer-growth")}>
                {t("topCustomers")}
              </button>
            </h2>
          </div>
          <div className="moduleTableWrap moduleBiTableWrap">
            <table className="moduleTable moduleBiTable">
              <thead>
                <tr>
                  <th>{t("name")}</th>
                  <th>{t("lifetimeCol")}</th>
                  <th>{t("share")}</th>
                  <th>{t("yoy")}</th>
                  <th>{t("mom")}</th>
                  <th>{t("signal")}</th>
                </tr>
              </thead>
              <tbody>
                {model.topCustomers.map((row) => (
                  <tr key={row.label} className="moduleBiDashRowLink" onClick={() => onOpen?.("customer-growth", "bi-customer-growth")}>
                    <td>{row.label}</td>
                    <td className="moduleBiTotalCol">{formatMoneyAmount(row.lifetime)}</td>
                    <td>{formatContributionPercent(row.sharePercent)}</td>
                    <td className={toneClass(overviewKpiTone(row.yoyPercent))}>{formatGrowthPercent(row.yoyPercent)}</td>
                    <td className={toneClass(overviewKpiTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                    <td><span className={statusClass(row.status)}>{row.statusLabel || row.status}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t("total")}</td>
                  <td className="moduleBiTotalCol">{formatMoneyAmount(model.topCustomers.reduce((sum, row) => sum + Number(row.lifetime || 0), 0))}</td>
                  <td>{formatContributionPercent(model.topCustomers.reduce((sum, row) => sum + Number(row.sharePercent || 0), 0))}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      {model.topItems.length ? (
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>
              <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("item-growth", "bi-item-growth")}>
                {t("topItems")}
              </button>
            </h2>
          </div>
          <div className="moduleTableWrap moduleBiTableWrap">
            <table className="moduleTable moduleBiTable">
              <thead>
                <tr>
                  <th>{t("name")}</th>
                  <th>{t("lifetimeCol")}</th>
                  <th>{t("share")}</th>
                  <th>{t("yoy")}</th>
                  <th>{t("mom")}</th>
                  <th>{t("signal")}</th>
                </tr>
              </thead>
              <tbody>
                {model.topItems.map((row) => (
                  <tr key={row.label} className="moduleBiDashRowLink" onClick={() => onOpen?.("item-growth", "bi-item-growth")}>
                    <td>{row.label}</td>
                    <td className="moduleBiTotalCol">{formatMoneyAmount(row.lifetime)}</td>
                    <td>{formatContributionPercent(row.sharePercent)}</td>
                    <td className={toneClass(overviewKpiTone(row.yoyPercent))}>{formatGrowthPercent(row.yoyPercent)}</td>
                    <td className={toneClass(overviewKpiTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                    <td><span className={statusClass(row.status)}>{row.statusLabel || row.status}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t("total")}</td>
                  <td className="moduleBiTotalCol">{formatMoneyAmount(model.topItems.reduce((sum, row) => sum + Number(row.lifetime || 0), 0))}</td>
                  <td>{formatContributionPercent(model.topItems.reduce((sum, row) => sum + Number(row.sharePercent || 0), 0))}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      {model.contributionRows.length ? (
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>
              <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("category-growth", "bi-contribution")}>
                {t("contribution")}
              </button>
            </h2>
          </div>
          <GrowthPeriodGrid
            filename="bi-overview-contribution"
            sheetName="Contribution"
            rowHeader={t("name")}
            rows={model.contributionRows}
            periods={model.recentMonths}
            currentPeriod={model.currentMonth}
            periodLabel={monthLabel}
            valuesOf={(row) => row.contributionValues}
            previousKeyOf={(period, index, periods) => (index > 0 ? periods[index - 1] : previousMonthKey(period))}
            totalLabel={t("total")}
            valueKind="percent"
            rowTotalOf={(row) => row.windowShare}
          />
        </section>
      ) : null}

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>
            <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("salesman-mom", "bi-salesman-mom")}>
              {t("salesmanPulse")}
            </button>
          </h2>
        </div>
        <div className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("lastMonth")}</th>
                <th>{t("mom")}</th>
                <th>{t("signal")}</th>
              </tr>
            </thead>
            <tbody>
              {model.topSalesmen.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className={toneClass(monthChangeTone(row.latestCompleteAmount, row.priorMonthAmount, row.priorMonthAmount != null))}>
                    {formatMoneyAmount(row.latestCompleteAmount)}
                  </td>
                  <td className={toneClass(overviewKpiTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                  <td><span className={statusClass(row.trajectory?.status)}>{row.trajectory?.label}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("total")}</td>
                <td className="moduleBiTotalCol">{formatMoneyAmount(model.topSalesmen.reduce((sum, row) => sum + Number(row.latestCompleteAmount || 0), 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="moduleSection">
        <div className="moduleSectionHeader">
          <h2>
            <button type="button" className="moduleBiDashSectionLink" onClick={() => onOpen?.("salesman-mom", "bi-teams")}>
              {t("teamPulse")}
            </button>
          </h2>
        </div>
        <div className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("lastMonth")}</th>
                <th>{t("mom")}</th>
                <th>{t("signal")}</th>
              </tr>
            </thead>
            <tbody>
              {model.teams.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className={toneClass(monthChangeTone(row.latestCompleteAmount, row.priorMonthAmount, row.priorMonthAmount != null))}>
                    {formatMoneyAmount(row.latestCompleteAmount)}
                  </td>
                  <td className={toneClass(overviewKpiTone(row.momPercent))}>{formatGrowthPercent(row.momPercent)}</td>
                  <td><span className={statusClass(row.trajectory?.status)}>{row.trajectory?.label}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("total")}</td>
                <td className="moduleBiTotalCol">{formatMoneyAmount(model.teams.reduce((sum, row) => sum + Number(row.latestCompleteAmount || 0), 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
