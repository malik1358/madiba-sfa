"use client";

import { translate } from "../../lib/appLanguage";
import {
  formatMoneyAmount,
  previousMonthKey,
  previousQuarterKey,
  quarterKeyFromMonthKey,
  quarterLabel,
} from "../../lib/categoryGrowth";
import ExportableTable from "../../components/ExportableTable";
import { GrowthChartPanel, GrowthTrendChart } from "./GrowthCharts";
import GrowthPeriodGrid from "./GrowthPeriodGrid";

const TEXT = {
  title: { en: "Cash, credit, local and import sales", ar: "مبيعات النقدي والآجل والمحلي والمستورد" },
  hint: {
    en: "Cash/credit and origin amounts are gross invoice sales. Credit notes and returns are shown separately and deducted to calculate net sales. Origin percentages include Other / unspecified.",
    ar: "مبالغ النقدي والآجل والمصدر هي إجمالي مبيعات الفواتير. تظهر الإشعارات الدائنة والمرتجعات منفصلة وتُخصم لحساب صافي المبيعات. تشمل نسب المصدر أخرى / غير محدد.",
  },
  loading: { en: "Loading sales mix...", ar: "جاري تحميل مزيج المبيعات..." },
  empty: { en: "No sales match this period.", ar: "لا توجد مبيعات تطابق هذه الفترة." },
  cashCredit: { en: "Cash vs credit", ar: "نقدي مقابل آجل" },
  localImport: { en: "Local vs import", ar: "محلي مقابل مستورد" },
  cash: { en: "Cash sales", ar: "مبيعات نقدية" },
  credit: { en: "Credit sales", ar: "مبيعات آجلة" },
  adjustmentsDeducted: { en: "Credit notes / returns (deducted)", ar: "إشعارات دائنة / مرتجعات (مخصومة)" },
  local: { en: "Local sales", ar: "مبيعات محلية" },
  import: { en: "Import sales", ar: "مبيعات مستوردة" },
  other: { en: "Other / unspecified origin", ar: "مصدر آخر / غير محدد" },
  monthly: { en: "Monthly sales", ar: "المبيعات الشهرية" },
  quarterly: { en: "Quarterly sales", ar: "المبيعات ربع السنوية" },
  monthlyReconciliation: { en: "Monthly gross-to-net sales", ar: "تسوية إجمالي وصافي المبيعات شهرياً" },
  quarterlyReconciliation: { en: "Quarterly gross-to-net sales", ar: "تسوية إجمالي وصافي المبيعات ربع سنوياً" },
  grossSales: { en: "Gross invoice sales", ar: "إجمالي مبيعات الفواتير" },
  adjustments: { en: "Credit notes / returns", ar: "إشعارات دائنة / مرتجعات" },
  netSales: { en: "Net sales", ar: "صافي المبيعات" },
  monthlyRatio: { en: "Monthly share movement", ar: "حركة الحصة الشهرية" },
  quarterlyRatio: { en: "Quarterly share movement", ar: "حركة الحصة ربع السنوية" },
  grossInvoiceSales: { en: "Gross invoice sales", ar: "إجمالي مبيعات الفواتير" },
  netSales: { en: "Net sales", ar: "صافي المبيعات" },
  adjustments: { en: "Credit notes / returns", ar: "إشعارات دائنة / مرتجعات" },
  movementHint: { en: "Shares are calculated from summed amounts in each period. Change is shown in percentage points (pp).", ar: "تُحسب الحصص من مجموع مبالغ كل فترة. ويظهر التغير بالنقاط المئوية (pp)." },
  shareOfSales: { en: "of sales", ar: "من المبيعات" },
  movement: { en: "Share movement", ar: "حركة الحصة" },
  total: { en: "Total", ar: "الإجمالي" },
  share: { en: "of sales", ar: "من المبيعات" },
};

const PAYMENT_SERIES = [
  ["cash_sales_amount", "cash", "#0f766e"],
  ["credit_sales_amount", "credit", "#2563eb"],
];
const ORIGIN_SERIES = [
  ["local_sales_amount", "local", "#65a30d"],
  ["import_sales_amount", "import", "#ea580c"],
  ["unclassified_origin_sales_amount", "other", "#64748b"],
];

function monthLabel(month, currentMonth, language) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} ${language === "ar" ? "حتى اليوم" : "MTD"}` : label;
}

function shareLabel(amount, total, language) {
  if (!total) return "0%";
  const t = translate(language, TEXT);
  return `${Math.round((amount / total) * 100)}% ${t("share")}`;
}

function MixSection({ language, title, entries, adjustmentEntry, valuesByPeriod, periods, currentPeriod, periodLabel, previousKeyOf, filename, sheetName }) {
  const t = translate(language, TEXT);
  const chartSeries = entries.map(([field, label, color]) => ({
    key: field,
    label: t(label),
    color,
    values: periods.map((period) => Number(valuesByPeriod?.[period]?.[field] || 0)),
  }));
  const tableEntries = adjustmentEntry ? [...entries, adjustmentEntry] : entries;
  const rows = tableEntries.map(([field, label]) => ({
    label: t(label),
    monthValues: Object.fromEntries(
      [...(periods.length ? [previousKeyOf(periods[0], 0, periods)] : []), ...periods]
        .filter(Boolean)
        .map((period) => [period, Number(valuesByPeriod?.[period]?.[field] || 0)]),
    ),
  }));

  return (
    <section className="moduleSection">
      <div className="moduleSectionHeader"><h2>{title}</h2></div>
      <div className="moduleBiChartGrid">
        <GrowthChartPanel title={t("monthly")}>
          <GrowthTrendChart
            periods={periods}
            series={chartSeries}
            periodLabel={periodLabel}
            formatValue={formatMoneyAmount}
          />
        </GrowthChartPanel>
      </div>
      <GrowthPeriodGrid
        filename={filename}
        sheetName={sheetName}
        rowHeader={t("monthly")}
        rows={rows}
        periods={periods}
        currentPeriod={currentPeriod}
        periodLabel={periodLabel}
        previousKeyOf={previousKeyOf}
        totalLabel={t("total")}
        rowKeyOf={(row) => row.label}
      />
    </section>
  );
}

function formatShare(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}%`;
}

function formatPointMovement(current, previous) {
  if (current == null || previous == null || !Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return "";
  const change = Number(current) - Number(previous);
  if (!change) return "0.0 pp";
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} pp`;
}

function RatioMovementSection({ language, title, entries, periods, currentPeriod, valuesByPeriod, filename, sheetName, periodLabel, previousKeyOf }) {
  const t = translate(language, TEXT);
  const series = entries.map(([field, label, color]) => ({
    key: field,
    label: t(label),
    color,
    values: periods.map((period) => Number(valuesByPeriod?.[period]?.[field] ?? 0)),
  }));

  return (
    <section className="moduleSection">
      <div className="moduleSectionHeader"><h2>{title}</h2></div>
      <p className="moduleHint">{t("movementHint")}</p>
      <div className="moduleBiChartGrid">
        <GrowthChartPanel title={t("movement")}>
          <GrowthTrendChart periods={periods} series={series} periodLabel={periodLabel} formatValue={formatShare} />
        </GrowthChartPanel>
      </div>
      <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <th>{t("movement")}</th>
              {periods.map((period) => <th key={period} className={period === currentPeriod ? "moduleBiMonthHead--current" : ""}>{periodLabel(period)}</th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map(([field, label]) => (
              <tr key={field}>
                <td>{t(label)}</td>
                {periods.map((period, index) => {
                  const value = valuesByPeriod?.[period]?.[field];
                  const previousKey = previousKeyOf(period, index, periods);
                  const previous = previousKey ? valuesByPeriod?.[previousKey]?.[field] : null;
                  const change = value == null || previous == null ? null : Number(value) - Number(previous);
                  const tone = change > 0 ? "up" : change < 0 ? "down" : "";
                  return (
                    <td key={period} className={[tone ? `moduleBiMonthCell--${tone}` : "", period === currentPeriod ? "moduleBiMonthCell--current" : ""].filter(Boolean).join(" ")}>
                      <span className="moduleBiAmountDelta">
                        <strong>{formatShare(value)}</strong>
                        {index > 0 || previousKey ? <em>{formatPointMovement(value, previous)}</em> : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ExportableTable>
    </section>
  );
}

function SalesReconciliationSection({ language, title, periodHeading, periods, valuesByPeriod, periodLabel, filename, sheetName }) {
  const t = translate(language, TEXT);
  const fields = [
    ["gross_invoice_sales", t("grossSales")],
    ["sales_adjustments_amount", t("adjustments")],
    ["net_sales", t("netSales")],
  ];
  const valuesForPeriod = (period) => {
    const row = valuesByPeriod?.[period] || {};
    const gross = Number(row.cash_sales_amount || 0) + Number(row.credit_sales_amount || 0);
    const adjustments = Number(row.sales_adjustments_amount || 0);
    return { gross_invoice_sales: gross, sales_adjustments_amount: adjustments, net_sales: gross + adjustments };
  };

  return (
    <section className="moduleSection">
      <div className="moduleSectionHeader"><h2>{title}</h2></div>
      <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <th>{periodHeading}</th>
              {periods.map((period) => <th key={period}>{periodLabel(period)}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map(([field, label]) => (
              <tr key={field}>
                <td>{label}</td>
                {periods.map((period) => <td key={period}>{formatMoneyAmount(valuesForPeriod(period)[field])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ExportableTable>
    </section>
  );
}
function MixCards({ language, mix }) {
  const t = translate(language, TEXT);
  const paymentTotal = Number(mix?.totals?.cash_sales_amount || 0) + Number(mix?.totals?.credit_sales_amount || 0);
  const originTotal = Number(mix?.totals?.local_sales_amount || 0)
    + Number(mix?.totals?.import_sales_amount || 0)
    + Number(mix?.totals?.unclassified_origin_sales_amount || 0);
  const metrics = [
    ["cash_sales_amount", t("cash"), paymentTotal, "moduleBusinessKpi--green"],
    ["credit_sales_amount", t("credit"), paymentTotal, "moduleBusinessKpi--orange"],
    ["local_sales_amount", t("local"), originTotal, "moduleBusinessKpi--green"],
    ["import_sales_amount", t("import"), originTotal, "moduleBusinessKpi--orange"],
    ["unclassified_origin_sales_amount", t("other"), originTotal, ""],
    ["sales_adjustments_amount", t("adjustments"), null, "moduleBusinessKpi--red"],
    ["net_sales", t("netSales"), null, "moduleBusinessKpi--green"],
  ];

  return (
    <div className="moduleMetricGrid">
      {metrics.map(([field, label, total, tone]) => (
        <section key={field} className={`moduleMetricCard ${tone}`}>
          <span>{label}</span>
          <strong>{formatMoneyAmount(mix?.totals?.[field] || 0)}</strong>
          {total ? <small>{shareLabel(Number(mix?.totals?.[field] || 0), total, language)}</small> : null}
        </section>
      ))}
    </div>
  );
}

export default function SalesMixReport({ language = "en", loading = false, report = null, currentMonth = "" }) {
  const t = translate(language, TEXT);
  const mix = report || {};
  const periods = (mix.months || []).slice(-12);
  const quarters = (mix.quarters || []).slice(-8);
  const currentQuarter = quarterKeyFromMonthKey(currentMonth);
  const monthPeriodLabel = (month) => monthLabel(month, currentMonth, language);
  const quarterPeriodLabel = (quarter) => quarterLabel(quarter, currentQuarter);
  const previousMonth = (month, index, allPeriods) => (index > 0 ? allPeriods[index - 1] : previousMonthKey(month));
  const previousQuarter = (quarter, index, allPeriods) => (index > 0 ? allPeriods[index - 1] : previousQuarterKey(quarter));

  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!periods.length) return <div className="moduleHint">{t("empty")}</div>;

  return (
    <>
      <section id="bi-sales-mix" className="moduleSection">
        <div className="moduleSectionHeader"><h2>{t("title")}</h2></div>
        <p className="moduleHint">{t("hint")}</p>
        <MixCards language={language} mix={mix} />
      </section>
      <SalesReconciliationSection
        language={language}
        title={t("monthlyReconciliation")}
        periodHeading={t("monthly")}
        periods={periods}
        valuesByPeriod={mix.monthly}
        periodLabel={monthPeriodLabel}
        filename="monthly-gross-to-net-sales"
        sheetName="Monthly Net Sales"
      />
      <SalesReconciliationSection
        language={language}
        title={t("quarterlyReconciliation")}
        periodHeading={t("quarterly")}
        periods={quarters}
        valuesByPeriod={mix.quarterly}
        periodLabel={quarterPeriodLabel}
        filename="quarterly-gross-to-net-sales"
        sheetName="Quarterly Net Sales"
      />
      <MixSection
        language={language}
        title={t("cashCredit")}
        entries={PAYMENT_SERIES}
        adjustmentEntry={["sales_adjustments_amount", "adjustmentsDeducted"]}
        valuesByPeriod={mix.monthly}
        periods={periods}
        currentPeriod={currentMonth}
        periodLabel={monthPeriodLabel}
        previousKeyOf={previousMonth}
        filename="cash-vs-credit-sales"
        sheetName="Cash vs Credit"
      />
      <MixSection
        language={language}
        title={t("localImport")}
        entries={ORIGIN_SERIES}
        adjustmentEntry={["sales_adjustments_amount", "adjustmentsDeducted"]}
        valuesByPeriod={mix.monthly}
        periods={periods}
        currentPeriod={currentMonth}
        periodLabel={monthPeriodLabel}
        previousKeyOf={previousMonth}
        filename="local-vs-import-sales"
        sheetName="Local vs Import"
      />
      <MixSection
        language={language}
        title={`${t("quarterly")} · ${t("cashCredit")}`}
        entries={PAYMENT_SERIES}
        adjustmentEntry={["sales_adjustments_amount", "adjustmentsDeducted"]}
        valuesByPeriod={mix.quarterly}
        periods={quarters}
        currentPeriod={currentQuarter}
        periodLabel={quarterPeriodLabel}
        previousKeyOf={previousQuarter}
        filename="quarterly-cash-vs-credit-sales"
        sheetName="Quarterly Cash Credit"
      />
      <MixSection
        language={language}
        title={`${t("quarterly")} · ${t("localImport")}`}
        entries={ORIGIN_SERIES}
        adjustmentEntry={["sales_adjustments_amount", "adjustmentsDeducted"]}
        valuesByPeriod={mix.quarterly}
        periods={quarters}
        currentPeriod={currentQuarter}
        periodLabel={quarterPeriodLabel}
        previousKeyOf={previousQuarter}
        filename="quarterly-local-vs-import-sales"
        sheetName="Quarterly Local Import"
      />
      <RatioMovementSection
        language={language}
        title={`${t("monthlyRatio")} · ${t("cashCredit")}`}
        entries={PAYMENT_SERIES}
        periods={periods}
        currentPeriod={currentMonth}
        valuesByPeriod={mix.monthlyShares?.payment}
        filename="monthly-cash-credit-share-movement"
        sheetName="Monthly Payment Ratios"
        periodLabel={monthPeriodLabel}
        previousKeyOf={previousMonth}
      />
      <RatioMovementSection
        language={language}
        title={`${t("monthlyRatio")} · ${t("localImport")}`}
        entries={ORIGIN_SERIES}
        periods={periods}
        currentPeriod={currentMonth}
        valuesByPeriod={mix.monthlyShares?.origin}
        filename="monthly-local-import-share-movement"
        sheetName="Monthly Origin Ratios"
        periodLabel={monthPeriodLabel}
        previousKeyOf={previousMonth}
      />
      <RatioMovementSection
        language={language}
        title={`${t("quarterlyRatio")} · ${t("cashCredit")}`}
        entries={PAYMENT_SERIES}
        periods={quarters}
        currentPeriod={currentQuarter}
        valuesByPeriod={mix.quarterlyShares?.payment}
        filename="quarterly-cash-credit-share-movement"
        sheetName="Quarterly Payment Ratios"
        periodLabel={quarterPeriodLabel}
        previousKeyOf={previousQuarter}
      />
      <RatioMovementSection
        language={language}
        title={`${t("quarterlyRatio")} · ${t("localImport")}`}
        entries={ORIGIN_SERIES}
        periods={quarters}
        currentPeriod={currentQuarter}
        valuesByPeriod={mix.quarterlyShares?.origin}
        filename="quarterly-local-import-share-movement"
        sheetName="Quarterly Origin Ratios"
        periodLabel={quarterPeriodLabel}
        previousKeyOf={previousQuarter}
      />
    </>
  );
}
