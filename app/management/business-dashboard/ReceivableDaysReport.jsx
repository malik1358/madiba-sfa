"use client";

import { useCallback, useMemo } from "react";
import { translate } from "../../lib/appLanguage";
import { formatMoneyAmount } from "../../lib/categoryGrowth";
import ExportableTable from "../../components/ExportableTable";
import BiExcelHead, { useBiExcelFilters } from "./BiExcelHead";
import { GrowthChartPanel, GrowthTrendChart } from "./GrowthCharts";

const TEXT = {
  title: { en: "Net receivable days", ar: "أيام الذمم المدينة الصافية" },
  hint: {
    en: "Each month shows the last Tally outstanding file imported in that month. Receivable days = (that month’s outstanding ÷ credit sales YTD) × days YTD. The total row keeps the latest balance, not a sum of months.",
    ar: "كل شهر يعرض آخر ملف مستحقات تالي تم رفعه في ذلك الشهر. أيام الذمم = (مستحقات ذلك الشهر ÷ مبيعات الآجل منذ بداية السنة) × أيام السنة حتى التاريخ. صف الإجمالي يحتفظ بآخر رصيد وليس مجموع الأشهر.",
  },
  loading: { en: "Loading receivable days...", ar: "جاري تحميل أيام الذمم..." },
  empty: { en: "No credit sales or receivables match this period.", ar: "لا توجد مبيعات آجلة أو ذمم تطابق هذه الفترة." },
  month: { en: "Month", ar: "الشهر" },
  receivables: { en: "Tally outstanding", ar: "مستحقات تالي" },
  creditSales: { en: "Credit sales (month)", ar: "مبيعات الآجل (الشهر)" },
  creditSalesYtd: { en: "Credit sales YTD", ar: "مبيعات الآجل منذ بداية السنة" },
  daysYtd: { en: "Days YTD", ar: "أيام السنة حتى التاريخ" },
  receivableDays: { en: "Receivable days", ar: "أيام الذمم" },
  momChange: { en: "MoM change", ar: "التغير الشهري" },
  trend: { en: "Receivable days trend", ar: "اتجاه أيام الذمم" },
  latest: { en: "Latest complete", ar: "آخر شهر مكتمل" },
  current: { en: "Current MTD", ar: "الشهر الحالي حتى اليوم" },
  total: { en: "Total", ar: "الإجمالي" },
  all: { en: "All", ar: "الكل" },
  improving: { en: "Improving", ar: "يتحسن" },
  worsening: { en: "Worsening", ar: "يتراجع" },
};

function monthLabel(month, currentMonth, language) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} ${language === "ar" ? "حتى اليوم" : "MTD"}` : label;
}

function formatMoneyOrBlank(value) {
  if (value == null) return "—";
  return formatMoneyAmount(value);
}

function formatDays(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-SA", { maximumFractionDigits: 1 });
}

function formatChange(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (!number) return "0.0";
  const sign = number > 0 ? "+" : "−";
  return `${sign}${Math.abs(number).toFixed(1)}`;
}

function toneClass(tone) {
  if (tone === "up") return "moduleBiMonthCell--up";
  if (tone === "down") return "moduleBiMonthCell--down";
  return "";
}

export default function ReceivableDaysReport({
  language = "en",
  loading = false,
  report = null,
}) {
  const t = translate(language, TEXT);
  const rows = report?.rows || [];
  const currentMonth = report?.currentMonth || "";
  const latest = report?.latestComplete || null;
  const lastRow = rows.at(-1) || null;

  const keys = useMemo(
    () => ["month", "receivables", "credit_sales", "credit_sales_ytd", "days", "receivable_days", "change_days"],
    [],
  );
  const valueOf = useCallback((row, key) => {
    if (key === "month") return monthLabel(row.month, currentMonth, language);
    if (key === "receivables") return formatMoneyOrBlank(row.receivables);
    if (key === "credit_sales") return formatMoneyAmount(row.credit_sales);
    if (key === "credit_sales_ytd") return formatMoneyAmount(row.credit_sales_ytd);
    if (key === "days") return String(row.days || 0);
    if (key === "receivable_days") return formatDays(row.receivable_days);
    if (key === "change_days") return formatChange(row.change_days);
    return "";
  }, [currentMonth, language]);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);

  const chartSeries = useMemo(() => ([{
    key: "receivable_days",
    label: t("receivableDays"),
    color: "#0f4c5c",
    values: rows.map((row) => Number(row.receivable_days || 0)),
  }]), [rows, t]);

  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!rows.length) return <div className="moduleHint">{t("empty")}</div>;

  const footerReceivables = report?.totals?.receivables ?? null;
  const footerCreditMonth = visibleRows.reduce((sum, row) => sum + Number(row.credit_sales || 0), 0);
  const footerCreditYtd = visibleRows.length
    ? Number(visibleRows[visibleRows.length - 1]?.credit_sales_ytd || 0)
    : 0;

  return (
    <>
      <section id="bi-receivable-days" className="moduleSection">
        <div className="moduleSectionHeader"><h2>{t("title")}</h2></div>
        <p className="moduleHint">{t("hint")}</p>
        <div className="moduleMetricGrid">
          <section className={`moduleMetricCard ${latest?.tone === "up" ? "moduleBusinessKpi--green" : latest?.tone === "down" ? "moduleBusinessKpi--red" : ""}`}>
            <span>{t("latest")}</span>
            <strong>{formatDays(latest?.receivable_days)}</strong>
            <small>{latest ? monthLabel(latest.month, currentMonth, language) : "—"}</small>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--orange">
            <span>{t("current")}</span>
            <strong>{formatDays(lastRow?.is_current ? lastRow.receivable_days : null)}</strong>
            <small>{lastRow?.is_current ? formatChange(lastRow.change_days) : "—"}</small>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--green">
            <span>{t("improving")}</span>
            <strong>{rows.filter((row) => row.improved === true).length}</strong>
          </section>
          <section className="moduleMetricCard moduleBusinessKpi--red">
            <span>{t("worsening")}</span>
            <strong>{rows.filter((row) => row.improved === false).length}</strong>
          </section>
        </div>
      </section>

      <section className="moduleSection">
        <div className="moduleBiChartGrid">
          <GrowthChartPanel title={t("trend")}>
            <GrowthTrendChart
              periods={rows.map((row) => row.month)}
              series={chartSeries}
              periodLabel={(month) => monthLabel(month, currentMonth, language)}
              formatValue={formatDays}
            />
          </GrowthChartPanel>
        </div>
      </section>

      <section className="moduleSection">
        <ExportableTable filename="net-receivable-days" sheetName="ReceivableDays" className="moduleTableWrap moduleBiTableWrap">
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <BiExcelHead label={t("month")} filterKey="month" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                <BiExcelHead label={t("receivables")} filterKey="receivables" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                <BiExcelHead label={t("creditSales")} filterKey="credit_sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                <BiExcelHead label={t("creditSalesYtd")} filterKey="credit_sales_ytd" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                <BiExcelHead label={t("daysYtd")} filterKey="days" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                <BiExcelHead label={t("receivableDays")} filterKey="receivable_days" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                <BiExcelHead label={t("momChange")} filterKey="change_days" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.month}>
                  <td className={row.is_current ? "moduleBiMonthCell--current" : ""}>
                    {monthLabel(row.month, currentMonth, language)}
                  </td>
                  <td className={row.is_current ? "moduleBiMonthCell--current" : ""}>
                    {formatMoneyOrBlank(row.receivables)}
                  </td>
                  <td className={row.is_current ? "moduleBiMonthCell--current" : ""}>
                    {formatMoneyAmount(row.credit_sales)}
                  </td>
                  <td className={row.is_current ? "moduleBiMonthCell--current" : ""}>
                    {formatMoneyAmount(row.credit_sales_ytd)}
                  </td>
                  <td className={row.is_current ? "moduleBiMonthCell--current" : ""}>
                    {row.days || "—"}
                  </td>
                  <td className={`moduleBiTotalCol ${toneClass(row.tone)} ${row.is_current ? "moduleBiMonthCell--current" : ""}`.trim()}>
                    <strong>{formatDays(row.receivable_days)}</strong>
                  </td>
                  <td className={`${toneClass(row.tone)} ${row.is_current ? "moduleBiMonthCell--current" : ""}`.trim()}>
                    {formatChange(row.change_days)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="moduleBiTotalRow">
                <td>{t("total")}</td>
                <td>{formatMoneyOrBlank(footerReceivables)}</td>
                <td>{formatMoneyAmount(footerCreditMonth)}</td>
                <td>{formatMoneyAmount(footerCreditYtd)}</td>
                <td>—</td>
                <td className="moduleBiTotalCol">{formatDays(lastRow?.receivable_days)}</td>
                <td>{formatChange(lastRow?.change_days)}</td>
              </tr>
            </tfoot>
          </table>
        </ExportableTable>
      </section>
    </>
  );
}
