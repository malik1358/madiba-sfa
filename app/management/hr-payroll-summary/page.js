"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { isValidHrMonth } from "../../lib/hr/hrMonthlyFeed";
import { compareTone, currentHrMonth, formatHrAmount, hrFetch } from "../../lib/hr/hrClient";

const MONTH_KEYS = ["month", "employees", "gross", "deductions", "net", "final", "draft"];
const DEPT_KEYS = ["department", "employees", "gross", "deductions", "net"];

const TEXT = {
  title: { en: "Payroll Summary", ar: "ملخص الرواتب" },
  subtitle: {
    en: "Monthly payroll totals (earnings, deductions, net pay). Totals only, no individual salaries.",
    ar: "إجماليات الرواتب الشهرية (الاستحقاقات والخصومات وصافي الراتب). إجماليات فقط بدون رواتب فردية.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading payroll summary...", ar: "جاري تحميل ملخص الرواتب..." },
  accessDenied: { en: "You do not have access to the payroll summary.", ar: "ليس لديك صلاحية لملخص الرواتب." },
  endMonth: { en: "Up to month", ar: "حتى شهر" },
  finalOnly: { en: "FINAL records only", ar: "السجلات النهائية فقط" },
  all: { en: "All", ar: "الكل" },
  showing: { en: "Showing", ar: "يعرض" },
  month: { en: "Month", ar: "الشهر" },
  employees: { en: "Employees", ar: "الموظفون" },
  gross: { en: "Earnings", ar: "الاستحقاقات" },
  deductions: { en: "Deductions", ar: "الخصومات" },
  net: { en: "Net pay", ar: "صافي الراتب" },
  final: { en: "Final", ar: "نهائي" },
  draft: { en: "Draft", ar: "مسودة" },
  department: { en: "Department", ar: "القسم" },
  byDepartment: { en: "By department", ar: "حسب القسم" },
  totalFooter: { en: "Total", ar: "الإجمالي" },
  note: {
    en: "Net pay = earnings − deductions as entered in the HR monthly feed (no statutory GOSI calculation). Green = up on the previous month, red = down, highlighted = current month.",
    ar: "صافي الراتب = الاستحقاقات − الخصومات كما أُدخلت في بيانات الرواتب الشهرية (بدون حساب التأمينات). أخضر = أعلى من الشهر السابق، أحمر = أقل، مميز = الشهر الحالي.",
  },
  empty: { en: "No payroll data for these months.", ar: "لا توجد بيانات رواتب لهذه الأشهر." },
};

export default function HrPayrollSummaryPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [endMonth, setEndMonth] = useState(() => currentHrMonth());
  const [finalOnly, setFinalOnly] = useState(false);
  const [months, setMonths] = useState([]);
  const [departments, setDepartments] = useState([]);

  usePopupMessages({ error });

  const allowed = Boolean(access?.canAccess?.("hrPayrollSummary"));
  const thisMonth = currentHrMonth();

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !isValidHrMonth(endMonth)) return;
    setLoading(true);
    setError("");
    try {
      const payload = await hrFetch(supabase, "/api/hr/payroll-summary", {
        params: { endMonth, months: "6", ...(finalOnly ? { finalOnly: "1" } : {}) },
      });
      setMonths(payload.months || []);
      setDepartments(payload.departments || []);
    } catch (err) {
      setError(err.message || "Unable to load payroll summary.");
    } finally {
      setLoading(false);
    }
  }, [endMonth, finalOnly]);

  useEffect(() => {
    if (accessLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    load();
  }, [accessLoading, allowed, load]);

  const previousByMonth = useMemo(() => {
    const map = new Map();
    months.forEach((row, index) => map.set(row.month, index > 0 ? months[index - 1] : null));
    return map;
  }, [months]);

  const monthValue = useCallback((row, key) => {
    if (key === "month") return row.month;
    if (key === "employees") return String(row.employeeCount);
    if (key === "gross") return formatHrAmount(row.grossEarnings);
    if (key === "deductions") return formatHrAmount(row.totalDeductions);
    if (key === "net") return formatHrAmount(row.netPay);
    if (key === "final") return String(row.finalCount);
    if (key === "draft") return String(row.draftCount);
    return "";
  }, []);
  const deptValue = useCallback((row, key) => {
    if (key === "department") return row.department;
    if (key === "employees") return String(row.employeeCount);
    if (key === "gross") return formatHrAmount(row.grossEarnings);
    if (key === "deductions") return formatHrAmount(row.totalDeductions);
    if (key === "net") return formatHrAmount(row.netPay);
    return "";
  }, []);

  const monthFilters = useBiExcelFilters(months, MONTH_KEYS, monthValue);
  const deptFilters = useBiExcelFilters(departments, DEPT_KEYS, deptValue);
  const monthHead = { options: monthFilters.options, filters: monthFilters.filters, onChange: monthFilters.setFilter, allLabel: t("all") };
  const deptHead = { options: deptFilters.options, filters: deptFilters.filters, onChange: deptFilters.setFilter, allLabel: t("all") };

  const monthTotals = monthFilters.visibleRows.reduce((sum, row) => ({
    gross: sum.gross + row.grossEarnings,
    deductions: sum.deductions + row.totalDeductions,
    net: sum.net + row.netPay,
    final: sum.final + row.finalCount,
    draft: sum.draft + row.draftCount,
  }), { gross: 0, deductions: 0, net: 0, final: 0, draft: 0 });
  const deptTotals = deptFilters.visibleRows.reduce((sum, row) => ({
    employees: sum.employees + row.employeeCount,
    gross: sum.gross + row.grossEarnings,
    deductions: sum.deductions + row.totalDeductions,
    net: sum.net + row.netPay,
  }), { employees: 0, gross: 0, deductions: 0, net: 0 });

  if (!supabaseClient) return <SupabaseUnavailable />;

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <header className="moduleHeader">
            <div>
              <AccessibleHeaderLink href="/management">{t("back")}</AccessibleHeaderLink>
              <h1>{t("title")}</h1>
              <p>{t("subtitle")}</p>
            </div>
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
          </header>

          {!accessLoading && !allowed ? <p>{t("accessDenied")}</p> : null}

          {allowed ? (
            <div className="moduleToolbar moduleFilterRow">
              <label>{t("endMonth")}
                <input type="month" className="moduleInput" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />
              </label>
              <label>
                <input type="checkbox" checked={finalOnly} onChange={(event) => setFinalOnly(event.target.checked)} /> {t("finalOnly")}
              </label>
            </div>
          ) : null}

          {allowed ? <p className="moduleHint">{t("note")}</p> : null}
          {allowed && loading ? <p>{t("loading")}</p> : null}

          {allowed && !loading ? (
            <>
              <section className="moduleSection">
                <p className="moduleHint">{t("showing")} {monthFilters.visibleRows.length} / {months.length}</p>
                <ExportableTable filename={`hr-payroll-summary-${endMonth}`} sheetName="Payroll Summary" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead {...monthHead} label={t("month")} filterKey="month" />
                        <BiExcelHead {...monthHead} label={t("employees")} filterKey="employees" />
                        <BiExcelHead {...monthHead} label={t("gross")} filterKey="gross" />
                        <BiExcelHead {...monthHead} label={t("deductions")} filterKey="deductions" />
                        <BiExcelHead {...monthHead} label={t("net")} filterKey="net" className="moduleBiTotalCol" />
                        <BiExcelHead {...monthHead} label={t("final")} filterKey="final" />
                        <BiExcelHead {...monthHead} label={t("draft")} filterKey="draft" />
                      </tr>
                    </thead>
                    <tbody>
                      {monthFilters.visibleRows.map((row) => {
                        const previous = previousByMonth.get(row.month);
                        const currentClass = row.month === thisMonth ? "moduleBiMonthCell--current" : "";
                        return (
                          <tr key={row.month}>
                            <td className={currentClass}>{row.month}</td>
                            <td>{row.employeeCount}</td>
                            <td className={compareTone(row.grossEarnings, previous?.grossEarnings)}>{formatHrAmount(row.grossEarnings)}</td>
                            <td className={compareTone(previous?.totalDeductions, row.totalDeductions)}>{formatHrAmount(row.totalDeductions)}</td>
                            <td className={`moduleBiTotalCol ${compareTone(row.netPay, previous?.netPay)}`.trim()}>{formatHrAmount(row.netPay)}</td>
                            <td>{row.finalCount}</td>
                            <td className={row.draftCount > 0 ? "moduleBiMonthCell--current" : ""}>{row.draftCount}</td>
                          </tr>
                        );
                      })}
                      {!monthFilters.visibleRows.length ? <tr><td colSpan={7}>{t("empty")}</td></tr> : null}
                    </tbody>
                    <tfoot>
                      <tr className="moduleBiTotalRow">
                        <td colSpan={2}><strong>{t("totalFooter")}</strong></td>
                        <td><strong>{formatHrAmount(monthTotals.gross)}</strong></td>
                        <td><strong>{formatHrAmount(monthTotals.deductions)}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatHrAmount(monthTotals.net)}</strong></td>
                        <td><strong>{monthTotals.final}</strong></td>
                        <td><strong>{monthTotals.draft}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <h2>{t("byDepartment")} — {endMonth}</h2>
                <p className="moduleHint">{t("showing")} {deptFilters.visibleRows.length} / {departments.length}</p>
                <ExportableTable filename={`hr-payroll-departments-${endMonth}`} sheetName="Payroll Departments" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead {...deptHead} label={t("department")} filterKey="department" />
                        <BiExcelHead {...deptHead} label={t("employees")} filterKey="employees" />
                        <BiExcelHead {...deptHead} label={t("gross")} filterKey="gross" />
                        <BiExcelHead {...deptHead} label={t("deductions")} filterKey="deductions" />
                        <BiExcelHead {...deptHead} label={t("net")} filterKey="net" className="moduleBiTotalCol" />
                      </tr>
                    </thead>
                    <tbody>
                      {deptFilters.visibleRows.map((row) => (
                        <tr key={row.department}>
                          <td>{row.department}</td>
                          <td>{row.employeeCount}</td>
                          <td>{formatHrAmount(row.grossEarnings)}</td>
                          <td>{formatHrAmount(row.totalDeductions)}</td>
                          <td className="moduleBiTotalCol">{formatHrAmount(row.netPay)}</td>
                        </tr>
                      ))}
                      {!deptFilters.visibleRows.length ? <tr><td colSpan={5}>{t("empty")}</td></tr> : null}
                    </tbody>
                    <tfoot>
                      <tr className="moduleBiTotalRow">
                        <td><strong>{t("totalFooter")}</strong></td>
                        <td><strong>{deptTotals.employees}</strong></td>
                        <td><strong>{formatHrAmount(deptTotals.gross)}</strong></td>
                        <td><strong>{formatHrAmount(deptTotals.deductions)}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatHrAmount(deptTotals.net)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
