"use client";

import { useState } from "react";
import ExportableTable from "../../components/ExportableTable";
import { translate } from "../../lib/appLanguage";
import { customerCohortRetentionTotal, formatCustomerCohortCell } from "../../lib/customerCohorts";
import styles from "./CustomerCohortReport.module.css";

const TEXT = {
  title: { en: "Quarterly customer retention", ar: "احتفاظ العملاء حسب الربع" },
  monthlyTitle: { en: "Monthly customer retention", ar: "احتفاظ العملاء حسب الشهر" },
  bimonthlyTitle: { en: "Bimonthly customer retention", ar: "احتفاظ العملاء كل شهرين" },
  quarter: { en: "Quarter", ar: "الربع" },
  month: { en: "Month", ar: "الشهر" },
  bimonth: { en: "Bimonthly", ar: "كل شهرين" },
  period: { en: "Cohort period", ar: "فترة اكتساب العملاء" },
  firstInvoiceMonth: { en: "First invoice month", ar: "شهر أول فاتورة" },
  firstInvoiceBimonth: { en: "First invoice bimonth", ar: "فترة أول فاتورة لشهرين" },
  twoMonthPeriod: { en: "2-month period", ar: "فترة شهرين" },
  firstInvoice: { en: "First invoice quarter", ar: "ربع أول فاتورة" },
  cohortSize: { en: "Customers acquired", ar: "العملاء المكتسبون" },
  total: { en: "Total customers", ar: "إجمالي العملاء" },
  count: { en: "Customer count", ar: "عدد العملاء" },
  retention: { en: "Count + retention %", ar: "العدد + نسبة الاحتفاظ" },
  values: { en: "Count + sales value", ar: "العدد + قيمة المبيعات" },
  retainedCustomers: { en: "Retained customers", ar: "العملاء المستمرون" },
  totalCustomersAndSales: { en: "Total customers / sales", ar: "إجمالي العملاء / المبيعات" },
  new: { en: "New", ar: "جديد" },
  acquiredInPeriod: { en: "Customers acquired in this period", ar: "العملاء المكتسبون في هذه الفترة" },
  toDate: { en: "to date", ar: "حتى تاريخه" },
  loading: { en: "Loading customer retention...", ar: "جاري تحميل احتفاظ العملاء..." },
  empty: { en: "No customer purchases match these filters.", ar: "لا توجد مشتريات للعملاء تطابق هذه التصفية." },
  unavailable: { en: "Customer retention is unavailable.", ar: "تقرير احتفاظ العملاء غير متاح." },
};

function quarterLabel(quarter, currentQuarter = "") {
  const [year, number] = quarter.split("-");
  return `${number} ${year}${quarter === currentQuarter ? " QTD" : ""}`;
}

export default function CustomerCohortReport({ report, loading, language }) {
  const [mode, setMode] = useState("count");
  const [period, setPeriod] = useState("quarter");
  const t = translate(language, TEXT);
  const monthly = period === "month";
  const bimonthly = period === "bimonth";
  const model = monthly ? report?.customerMonthlyCohorts : bimonthly ? report?.customerBimonthlyCohorts : report?.customerCohorts;
  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!model) return <div className="moduleHint">{t("unavailable")}</div>;
  if (!model.rows.length || !model.quarters.length) return <div className="moduleHint">{t("empty")}</div>;

  function display(count, size) {
    return formatCustomerCohortCell(count, size, mode);
  }

  function valueDisplay(count, value) {
    const customers = Number(count || 0).toLocaleString("en-SA");
    const amount = Number(value || 0).toLocaleString(language === "ar" ? "ar-SA" : "en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${customers} · ${amount} ﷼`;
  }

  function periodLabel(value, current = "") {
    if (bimonthly) {
      const match = value.match(/^(\d{4})-B([1-6])$/);
      if (!match) return value;
      const startMonth = (Number(match[2]) - 1) * 2 + 1;
      const formatMonth = (month) => new Date(Date.UTC(Number(match[1]), month - 1, 1)).toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", calendar: "gregory", timeZone: "Asia/Riyadh" });
      return `${formatMonth(startMonth)}-${formatMonth(startMonth + 1)} ${match[1]} (${t("twoMonthPeriod")}${value === current ? `, ${t("toDate")}` : ""})`;
    }
    if (!monthly) return quarterLabel(value, current);
    const label = new Date(`${value}-01T00:00:00Z`).toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", year: "numeric", calendar: "gregory", timeZone: "Asia/Riyadh" });
    return `${label}${value === current ? " MTD" : ""}`;
  }

  return (
    <section id="bi-customer-cohorts" className="moduleSection">
      <div className={`moduleSectionHeader ${styles.header}`}>
        <h2>{t(monthly ? "monthlyTitle" : bimonthly ? "bimonthlyTitle" : "title")}</h2>
        <div className="moduleBiTabs" role="group" aria-label={t("period")}>
          {["quarter", "bimonth", "month"].map((value) => (
            <button key={value} type="button" className={`moduleBiTab${period === value ? " isActive" : ""}`} aria-pressed={period === value} onClick={() => setPeriod(value)}>{t(value)}</button>
          ))}
        </div>
        <div className="moduleBiTabs" role="group" aria-label={t("title")}>
          {["count", "retention", "values"].map((value) => (
            <button key={value} type="button" className={`moduleBiTab${mode === value ? " isActive" : ""}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{t(value)}</button>
          ))}
        </div>
      </div>
      <ExportableTable filename={`customer-${period}-${mode}`} sheetName={monthly ? "Monthly retention" : bimonthly ? "Bimonthly retention" : "Quarterly retention"} className="moduleTableWrap moduleBiTableWrap" enableColumnFilters={false}>
        <table className={`moduleTable moduleBiTable ${styles.table}`} style={{ minWidth: 260 + model.quarters.length * 104 }}>
          <colgroup>
            <col style={{ width: 140 }} />
            {model.quarters.map((quarter) => <col key={quarter} style={{ width: 104 }} />)}
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t(monthly ? "firstInvoiceMonth" : bimonthly ? "firstInvoiceBimonth" : "firstInvoice")}</th>
              {model.quarters.map((quarter) => <th scope="col" key={quarter} className={quarter === model.currentQuarter ? "moduleBiMonthHead--current" : ""}>{periodLabel(quarter, model.currentQuarter)}</th>)}
              <th scope="col" className="moduleBiTotalCol">{t("cohortSize")}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.quarter}>
                <th scope="row">{periodLabel(row.quarter)}</th>
                {model.quarters.map((quarter, index) => {
                  const count = row.counts[quarter];
                  const previous = index > 0 ? row.counts[model.quarters[index - 1]] : null;
                  const tone = count == null ? "" : count === 0 ? "moduleBiMonthCell--down" : previous == null || count >= previous ? "moduleBiMonthCell--up" : "moduleBiMonthCell--down";
                  const isNew = quarter === row.quarter;
                  const cellValue = mode === "values"
                    ? count == null ? "-" : `${Number(count || 0).toLocaleString("en-SA")} · ${Number(row.salesValues[quarter] || 0).toLocaleString(language === "ar" ? "ar-SA" : "en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ﷼`
                    : formatCustomerCohortCell(count, row.customerCount, mode, { isNew, newLabel: t("new") });
                  const cellTitle = count == null ? undefined : isNew ? t("acquiredInPeriod") : `${count} / ${row.customerCount} (${(count / row.customerCount * 100).toFixed(1)}%)`;
                  return <td key={quarter} className={`${tone}${quarter === model.currentQuarter ? " moduleBiMonthCell--current" : ""}`} title={cellTitle}>{cellValue}</td>;
                })}
                <td className="moduleBiTotalCol">{row.customerCount.toLocaleString("en-SA")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="moduleBiTotalRow">
              <th scope="row">{t(mode === "values" ? "totalCustomersAndSales" : "retainedCustomers")}</th>
              {model.quarters.map((quarter) => {
                const retained = customerCohortRetentionTotal(model.rows, quarter);
                const cellValue = mode === "values"
                  ? valueDisplay(model.totals[quarter], model.valueTotals[quarter])
                  : display(retained.count, retained.eligible);
                return <td key={quarter} className={quarter === model.currentQuarter ? "moduleBiMonthCell--current" : ""}>{cellValue}</td>;
              })}
              <td className="moduleBiTotalCol">{model.customerCount.toLocaleString("en-SA")}</td>
            </tr>
          </tfoot>
        </table>
      </ExportableTable>
    </section>
  );
}