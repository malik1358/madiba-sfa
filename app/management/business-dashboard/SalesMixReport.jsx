"use client";

import { useMemo } from "react";
import { translate } from "../../lib/appLanguage";
import { formatMoneyAmount } from "../../lib/categoryGrowth";
import { GrowthChartPanel, GrowthTrendChart } from "./GrowthCharts";
import GrowthPeriodGrid from "./GrowthPeriodGrid";

const TEXT = {
  title: { en: "Cash, credit, local and import sales", ar: "مبيعات النقدي والآجل والمحلي والمستورد" },
  hint: {
    en: "Monthly invoice sales for the selected period. Credit notes and sales returns are excluded. Origin values other than Local or Import appear as Other / unspecified.",
    ar: "مبيعات الفواتير الشهرية للفترة المحددة. تُستثنى الإشعارات الدائنة والمرتجعات. تظهر قيم المصدر غير المحلي أو المستورد ضمن أخرى / غير محدد.",
  },
  loading: { en: "Loading sales mix...", ar: "جاري تحميل مزيج المبيعات..." },
  empty: { en: "No sales match this period.", ar: "لا توجد مبيعات تطابق هذه الفترة." },
  cashCredit: { en: "Cash vs credit", ar: "نقدي مقابل آجل" },
  localImport: { en: "Local vs import", ar: "محلي مقابل مستورد" },
  cash: { en: "Cash sales", ar: "مبيعات نقدية" },
  credit: { en: "Credit sales", ar: "مبيعات آجلة" },
  local: { en: "Local sales", ar: "مبيعات محلية" },
  import: { en: "Import sales", ar: "مبيعات مستوردة" },
  other: { en: "Other / unspecified origin", ar: "مصدر آخر / غير محدد" },
  monthly: { en: "Monthly sales", ar: "المبيعات الشهرية" },
  total: { en: "Total", ar: "الإجمالي" },
  share: { en: "of classified sales", ar: "من المبيعات المصنفة" },
};

const SERIES = [
  { key: "cash_sales_amount", color: "#0f766e" },
  { key: "credit_sales_amount", color: "#2563eb" },
  { key: "local_sales_amount", color: "#65a30d" },
  { key: "import_sales_amount", color: "#ea580c" },
  { key: "unclassified_origin_sales_amount", color: "#64748b" },
];

function monthLabel(month, currentMonth, language) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} ${language === "ar" ? "حتى اليوم" : "MTD"}` : label;
}

function amountRows(months, monthly, entries) {
  return entries.map(([label, field]) => ({
    label,
    monthValues: Object.fromEntries(months.map((month) => [month, Number(monthly?.[month]?.[field] || 0)])),
  }));
}

function shareLabel(amount, total, language) {
  if (!total) return "0%";
  const percent = Math.round((amount / total) * 100);
  return `${percent}% ${translate(language, TEXT)("share")}`;
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
  ];

  return (
    <div className="moduleMetricGrid">
      {metrics.map(([field, label, total, tone]) => (
        <section key={field} className={`moduleMetricCard ${tone}`}>
          <span>{label}</span>
          <strong>{formatMoneyAmount(mix?.totals?.[field] || 0)}</strong>
          <small>{shareLabel(Number(mix?.totals?.[field] || 0), total, language)}</small>
        </section>
      ))}
    </div>
  );
}

function MixSection({ language, title, entries, monthly, periods, currentMonth, filename, sheetName }) {
  const t = translate(language, TEXT);
  const series = useMemo(() => entries.map(([field, label, color]) => ({
    key: field,
    label: t(label),
    color,
    values: periods.map((month) => Number(monthly?.[month]?.[field] || 0)),
  })), [entries, language, monthly, periods]);
  const gridRows = useMemo(
    () => amountRows(periods, monthly, entries.map(([field, label]) => [t(label), field])),
    [entries, language, monthly, periods],
  );

  return (
    <section className="moduleSection">
      <div className="moduleSectionHeader"><h2>{title}</h2></div>
      <div className="moduleBiChartGrid">
        <GrowthChartPanel title={t("monthly")}>
          <GrowthTrendChart
            periods={periods}
            series={series}
            periodLabel={(month) => monthLabel(month, currentMonth, language)}
            formatValue={formatMoneyAmount}
          />
        </GrowthChartPanel>
      </div>
      <GrowthPeriodGrid
        filename={filename}
        sheetName={sheetName}
        rowHeader={t("monthly")}
        rows={gridRows}
        periods={periods}
        currentPeriod={currentMonth}
        periodLabel={(month) => monthLabel(month, currentMonth, language)}
        totalLabel={t("total")}
        rowKeyOf={(row) => row.label}
      />
    </section>
  );
}

export default function SalesMixReport({ language = "en", loading = false, report = null, currentMonth = "" }) {
  const t = translate(language, TEXT);
  const mix = report || {};
  const periods = (mix.months || []).slice(-12);
  const cashCreditEntries = [
    ["cash_sales_amount", "cash", SERIES[0].color],
    ["credit_sales_amount", "credit", SERIES[1].color],
  ];
  const originEntries = [
    ["local_sales_amount", "local", SERIES[2].color],
    ["import_sales_amount", "import", SERIES[3].color],
    ["unclassified_origin_sales_amount", "other", SERIES[4].color],
  ];

  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!mix.months?.length) return <div className="moduleHint">{t("empty")}</div>;

  return (
    <>
      <section id="bi-sales-mix" className="moduleSection">
        <div className="moduleSectionHeader"><h2>{t("title")}</h2></div>
        <p className="moduleHint">{t("hint")}</p>
        <MixCards language={language} mix={mix} />
      </section>
      <MixSection
        language={language}
        title={t("cashCredit")}
        entries={cashCreditEntries}
        monthly={mix.monthly}
        periods={periods}
        currentMonth={currentMonth}
        filename="cash-vs-credit-sales"
        sheetName="Cash vs Credit"
      />
      <MixSection
        language={language}
        title={t("localImport")}
        entries={originEntries}
        monthly={mix.monthly}
        periods={periods}
        currentMonth={currentMonth}
        filename="local-vs-import-sales"
        sheetName="Local vs Import"
      />
    </>
  );
}
