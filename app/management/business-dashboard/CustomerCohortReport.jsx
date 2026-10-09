"use client";

import { useState } from "react";
import ExportableTable from "../../components/ExportableTable";
import { translate } from "../../lib/appLanguage";
import { formatCustomerCohortCell } from "../../lib/customerCohorts";
import styles from "./CustomerCohortReport.module.css";

const TEXT = {
  title: { en: "Quarterly customer retention", ar: "احتفاظ العملاء حسب الربع" },
  monthlyTitle: { en: "Monthly customer retention", ar: "احتفاظ العملاء حسب الشهر" },
  quarter: { en: "Quarter", ar: "الربع" },
  month: { en: "Month", ar: "الشهر" },
  period: { en: "Cohort period", ar: "فترة اكتساب العملاء" },
  firstInvoiceMonth: { en: "First invoice month", ar: "شهر أول فاتورة" },
  firstInvoice: { en: "First invoice quarter", ar: "ربع أول فاتورة" },
  cohortSize: { en: "Customers acquired", ar: "العملاء المكتسبون" },
  total: { en: "Total customers", ar: "إجمالي العملاء" },
  count: { en: "Customer count", ar: "عدد العملاء" },
  retention: { en: "Count + retention %", ar: "العدد + نسبة الاحتفاظ" },
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
  const model = monthly ? report?.customerMonthlyCohorts : report?.customerCohorts;
  if (loading) return <div className="moduleLoading">{t("loading")}</div>;
  if (!model) return <div className="moduleHint">{t("unavailable")}</div>;
  if (!model.rows.length || !model.quarters.length) return <div className="moduleHint">{t("empty")}</div>;

  function display(count, size) {
    return formatCustomerCohortCell(count, size, mode);
  }

  function periodLabel(value, current = "") {
    if (!monthly) return quarterLabel(value, current);
    const label = new Date(`${value}-01T00:00:00Z`).toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", { month: "short", year: "numeric", calendar: "gregory", timeZone: "Asia/Riyadh" });
    return `${label}${value === current ? " MTD" : ""}`;
  }

  return (
    <section id="bi-customer-cohorts" className="moduleSection">
      <div className={`moduleSectionHeader ${styles.header}`}>
        <h2>{t(monthly ? "monthlyTitle" : "title")}</h2>
        <div className="moduleBiTabs" role="group" aria-label={t("period")}>
          {["quarter", "month"].map((value) => (
            <button key={value} type="button" className={`moduleBiTab${period === value ? " isActive" : ""}`} aria-pressed={period === value} onClick={() => setPeriod(value)}>{t(value)}</button>
          ))}
        </div>
        <div className="moduleBiTabs" role="group" aria-label={t("title")}>
          {["count", "retention"].map((value) => (
            <button key={value} type="button" className={`moduleBiTab${mode === value ? " isActive" : ""}`} aria-pressed={mode === value} onClick={() => setMode(value)}>{t(value)}</button>
          ))}
        </div>
      </div>
      <ExportableTable filename={`customer-${period}-${mode}`} sheetName={monthly ? "Monthly retention" : "Quarterly retention"} className="moduleTableWrap moduleBiTableWrap" enableColumnFilters={false}>
        <table className={`moduleTable moduleBiTable ${styles.table}`} style={{ minWidth: 260 + model.quarters.length * 104 }}>
          <colgroup>
            <col style={{ width: 140 }} />
            {model.quarters.map((quarter) => <col key={quarter} style={{ width: 104 }} />)}
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t(monthly ? "firstInvoiceMonth" : "firstInvoice")}</th>
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
                  return <td key={quarter} className={`${tone}${quarter === model.currentQuarter ? " moduleBiMonthCell--current" : ""}`} title={count == null ? undefined : `${count} / ${row.customerCount} (${(count / row.customerCount * 100).toFixed(1)}%)`}>{display(count, row.customerCount)}</td>;
                })}
                <td className="moduleBiTotalCol">{row.customerCount.toLocaleString("en-SA")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="moduleBiTotalRow">
              <th scope="row">{t("total")}</th>
              {model.quarters.map((quarter) => {
                const eligible = model.rows.filter((row) => row.quarter <= quarter).reduce((sum, row) => sum + row.customerCount, 0);
                return <td key={quarter} className={quarter === model.currentQuarter ? "moduleBiMonthCell--current" : ""}>{display(model.totals[quarter], eligible)}</td>;
              })}
              <td className="moduleBiTotalCol">{model.customerCount.toLocaleString("en-SA")}</td>
            </tr>
          </tfoot>
        </table>
      </ExportableTable>
    </section>
  );
}