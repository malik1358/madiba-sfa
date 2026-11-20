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
import { canWriteHr } from "../../lib/hr/hrAccess";
import {
  HR_ATTENDANCE_FIELDS,
  HR_DEDUCTION_FIELDS,
  HR_EARNING_FIELDS,
  HR_FIELD_LABELS,
  computeMonthlyTotals,
  defaultMonthlyRecordForEmployee,
  isValidHrMonth,
  listHrMonthsBack,
  mergeMonthlyRecord,
} from "../../lib/hr/hrMonthlyFeed";
import {
  compareTone,
  currentHrMonth,
  downloadHrMonthlyTemplate,
  formatHrAmount,
  hrFetch,
  readHrExcelFile,
} from "../../lib/hr/hrClient";

const FILTER_KEYS = ["code", "name", "status", "workingDays", "presentDays", "absentDays", "leaveDays", "gross", "deductions", "net"];

const TEXT = {
  title: { en: "HR Monthly Feed", ar: "بيانات الرواتب الشهرية" },
  subtitle: {
    en: "Monthly earnings, deductions and attendance per employee. Net pay = earnings − deductions.",
    ar: "الاستحقاقات والخصومات والحضور الشهري لكل موظف. صافي الراتب = الاستحقاقات − الخصومات.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading month...", ar: "جاري تحميل الشهر..." },
  accessDenied: { en: "Only admin, report-user and manager can open HR.", ar: "الدخول للموارد البشرية للمدير ومستخدم التقارير والمدير التنفيذي فقط." },
  readOnly: { en: "Read-only: only admin or manager can change HR data.", ar: "للعرض فقط: التعديل للمدير أو المدير التنفيذي فقط." },
  month: { en: "Month", ar: "الشهر" },
  all: { en: "All", ar: "الكل" },
  showing: { en: "Showing", ar: "يعرض" },
  prefill: { en: "Prefill attendance from My Day", ar: "تعبئة الحضور من يومي" },
  template: { en: "Download Excel template", ar: "تنزيل قالب Excel" },
  importExcel: { en: "Import Excel", ar: "استيراد Excel" },
  finalizeAll: { en: "Finalize all drafts", ar: "اعتماد كل المسودات" },
  confirmFinalize: { en: "Finalize every DRAFT for this month? FINAL rows are locked until reopened.", ar: "اعتماد كل المسودات لهذا الشهر؟ الصفوف النهائية مقفلة حتى إعادة فتحها." },
  hint: {
    en: "Fridays are holidays. Prefill works for staff linked to a salesman/collector login; others are entered manually. FINAL rows are protected from import and prefill until reopened.",
    ar: "أيام الجمعة عطلة. التعبئة التلقائية للموظفين المرتبطين بحساب مندوب/محصل، والبقية يدوياً. الصفوف النهائية محمية من الاستيراد والتعبئة حتى إعادة فتحها.",
  },
  code: { en: "Code", ar: "الرقم" },
  name: { en: "Employee", ar: "الموظف" },
  status: { en: "Status", ar: "الحالة" },
  notEntered: { en: "Not entered", ar: "غير مدخل" },
  draft: { en: "Draft", ar: "مسودة" },
  final: { en: "Final", ar: "نهائي" },
  gross: { en: "Earnings", ar: "الاستحقاقات" },
  deductions: { en: "Deductions", ar: "الخصومات" },
  net: { en: "Net pay", ar: "صافي الراتب" },
  actions: { en: "Actions", ar: "إجراءات" },
  edit: { en: "Edit", ar: "تعديل" },
  view: { en: "View", ar: "عرض" },
  reopen: { en: "Reopen", ar: "إعادة فتح" },
  finalize: { en: "Finalize", ar: "اعتماد" },
  save: { en: "Save", ar: "حفظ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  close: { en: "Close", ar: "إغلاق" },
  earningsGroup: { en: "Earnings", ar: "الاستحقاقات" },
  deductionsGroup: { en: "Deductions", ar: "الخصومات" },
  attendanceGroup: { en: "Attendance", ar: "الحضور" },
  notes: { en: "Notes", ar: "ملاحظات" },
  saved: { en: "Record saved.", ar: "تم حفظ السجل." },
  totalFooter: { en: "Total", ar: "الإجمالي" },
  empty: { en: "No employees yet. Add staff first.", ar: "لا يوجد موظفون. أضف الموظفين أولاً." },
  importedSummary: { en: "Import finished", ar: "انتهى الاستيراد" },
  saved_n: { en: "saved", ar: "تم حفظ" },
  skipped_n: { en: "skipped", ar: "تم تخطي" },
  errors_n: { en: "rows with errors", ar: "صفوف بها أخطاء" },
  prefilledSummary: { en: "Prefill finished", ar: "انتهت التعبئة" },
  finalizedSummary: { en: "Records changed", ar: "سجلات تم تغييرها" },
  details: { en: "Details", ar: "التفاصيل" },
};

export default function HrMonthlyPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(() => currentHrMonth());
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [previousRecords, setPreviousRecords] = useState([]);
  const [editor, setEditor] = useState(null);
  const [report, setReport] = useState([]);

  usePopupMessages({ error, message });

  const allowed = Boolean(access?.canAccess?.("hrMonthly"));
  const canWrite = canWriteHr(access?.role);
  const today = currentHrMonth();

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !isValidHrMonth(month)) return;
    setLoading(true);
    setError("");
    try {
      const payload = await hrFetch(supabase, "/api/hr/monthly", { params: { month } });
      setEmployees(payload.employees || []);
      setRecords(payload.records || []);
      try {
        const previous = await hrFetch(supabase, "/api/hr/monthly", {
          params: { month: listHrMonthsBack(month, 2)[0] },
        });
        setPreviousRecords(previous.records || []);
      } catch {
        setPreviousRecords([]);
      }
    } catch (err) {
      setError(err.message || "Unable to load the month.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (accessLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    load();
  }, [accessLoading, allowed, load]);

  const rows = useMemo(() => {
    const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));
    const previousByEmployee = new Map(previousRecords.map((record) => [record.employeeId, record]));
    return employees
      .filter((employee) => employee.status === "ACTIVE" || recordByEmployee.has(employee.id))
      .map((employee) => ({
        employee,
        record: recordByEmployee.get(employee.id) || null,
        previous: previousByEmployee.get(employee.id) || null,
      }));
  }, [employees, records, previousRecords]);

  const filterValue = useCallback((row, key) => {
    const record = row.record;
    if (key === "code") return row.employee.employeeCode;
    if (key === "name") return row.employee.fullName;
    if (key === "status") return !record ? t("notEntered") : record.status === "FINAL" ? t("final") : t("draft");
    if (key === "workingDays") return String(record?.workingDays ?? 0);
    if (key === "presentDays") return String(record?.presentDays ?? 0);
    if (key === "absentDays") return String(record?.absentDays ?? 0);
    if (key === "leaveDays") return String(record?.leaveDays ?? 0);
    if (key === "gross") return formatHrAmount(record?.grossEarnings);
    if (key === "deductions") return formatHrAmount(record?.totalDeductions);
    if (key === "net") return formatHrAmount(record?.netPay);
    return "";
  }, [t]);

  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, filterValue);
  const headProps = { options, filters, onChange: setFilter, allLabel: t("all") };

  const totals = useMemo(() => visibleRows.reduce((sum, row) => ({
    gross: sum.gross + Number(row.record?.grossEarnings || 0),
    deductions: sum.deductions + Number(row.record?.totalDeductions || 0),
    net: sum.net + Number(row.record?.netPay || 0),
  }), { gross: 0, deductions: 0, net: 0 }), [visibleRows]);

  async function runAction(body, onDone) {
    setBusy(true);
    setError("");
    try {
      const payload = await hrFetch(supabaseClient, "/api/hr/monthly", { method: "POST", body: { month, ...body } });
      onDone?.(payload);
      await load();
    } catch (err) {
      setError(err.message || "HR request failed.");
    } finally {
      setBusy(false);
    }
  }

  function describeSkips(skipped = [], errors = []) {
    return [
      ...skipped.map((item) => `${item.employeeCode}: ${item.reason}`),
      ...errors.map((item) => `#${item.rowNumber} ${item.message}`),
    ];
  }

  function handlePrefill() {
    runAction({ action: "prefill" }, (payload) => {
      setMessage(`${t("prefilledSummary")}: ${payload.saved} ${t("saved_n")}, ${payload.skipped?.length || 0} ${t("skipped_n")}.`);
      setReport(describeSkips(payload.skipped));
    });
  }

  function handleFinalizeAll() {
    if (!window.confirm(t("confirmFinalize"))) return;
    runAction({ action: "finalize" }, (payload) => {
      setMessage(`${t("finalizedSummary")}: ${payload.changed}`);
    });
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const rowsFromFile = await readHrExcelFile(file);
      const payload = await hrFetch(supabaseClient, "/api/hr/monthly", {
        method: "POST",
        body: { action: "import", month, rows: rowsFromFile },
      });
      setMessage(
        `${t("importedSummary")}: ${payload.saved} ${t("saved_n")}, ${payload.skipped?.length || 0} ${t("skipped_n")}, ${payload.errors?.length || 0} ${t("errors_n")}.`,
      );
      setReport(describeSkips(payload.skipped, payload.errors));
      await load();
    } catch (err) {
      setError(err.message || "Unable to import the file.");
    } finally {
      setBusy(false);
    }
  }

  function openEditor(row) {
    const base = row.record || defaultMonthlyRecordForEmployee(row.employee);
    setEditor({
      employee: row.employee,
      locked: row.record?.status === "FINAL",
      draft: { ...base },
    });
  }

  function setEditorField(key, value) {
    setEditor((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  }

  const editorTotals = useMemo(() => {
    if (!editor) return null;
    const numeric = {};
    for (const key of [...HR_EARNING_FIELDS, ...HR_DEDUCTION_FIELDS]) {
      numeric[key] = Number(editor.draft[key] || 0);
    }
    return computeMonthlyTotals(numeric);
  }, [editor]);

  function saveEditor(event) {
    event.preventDefault();
    if (!editor || editor.locked) return;
    const record = mergeMonthlyRecord({}, editor.draft);
    runAction({ action: "save", employeeId: editor.employee.id, record }, () => {
      setMessage(t("saved"));
      setEditor(null);
    });
  }

  function renderNumberField(key) {
    return (
      <label key={key}>{HR_FIELD_LABELS[key][language === "ar" ? "ar" : "en"]}
        <input
          className="moduleInput"
          type="number"
          min="0"
          step="0.01"
          value={editor.draft[key] ?? 0}
          disabled={editor.locked || !canWrite}
          onChange={(event) => setEditorField(key, event.target.value)}
        />
      </label>
    );
  }

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
          {allowed && !canWrite ? <p className="moduleHint">{t("readOnly")}</p> : null}

          {allowed ? (
            <div className="moduleToolbar moduleFilterRow">
              <label>{t("month")}
                <input type="month" className="moduleInput" value={month} onChange={(event) => setMonth(event.target.value)} />
              </label>
              {canWrite ? (
                <>
                  <button type="button" className="moduleInlineButton" disabled={busy || loading} onClick={handlePrefill}>{t("prefill")}</button>
                  <button type="button" className="moduleInlineButton" disabled={busy || loading} onClick={() => downloadHrMonthlyTemplate(employees.filter((e) => e.status === "ACTIVE"), month)}>{t("template")}</button>
                  <label className="moduleInlineButton">
                    {t("importExcel")}
                    <input type="file" accept=".xlsx,.xls,.csv" hidden disabled={busy || loading} onChange={handleImportFile} />
                  </label>
                  <button type="button" className="moduleInlineButton" disabled={busy || loading} onClick={handleFinalizeAll}>{t("finalizeAll")}</button>
                </>
              ) : null}
            </div>
          ) : null}

          {allowed ? <p className="moduleHint">{t("hint")}</p> : null}

          {report.length ? (
            <details className="moduleSection" open>
              <summary>{t("details")} ({report.length})</summary>
              <ul>{report.slice(0, 50).map((line, index) => <li key={index}>{line}</li>)}</ul>
            </details>
          ) : null}

          {allowed && loading ? <p>{t("loading")}</p> : null}

          {allowed && !loading && editor ? (
            <section className="moduleSection">
              <h2>{editor.employee.employeeCode} — {editor.employee.fullName} ({month})</h2>
              <form onSubmit={saveEditor}>
                <h3>{t("earningsGroup")}</h3>
                <div className="moduleFormGrid">{HR_EARNING_FIELDS.map(renderNumberField)}</div>
                <h3>{t("deductionsGroup")}</h3>
                <div className="moduleFormGrid">{HR_DEDUCTION_FIELDS.map(renderNumberField)}</div>
                <h3>{t("attendanceGroup")}</h3>
                <div className="moduleFormGrid">{HR_ATTENDANCE_FIELDS.map(renderNumberField)}</div>
                <div className="moduleFormGrid">
                  <label className="moduleFieldFull">{t("notes")}
                    <input className="moduleInput" value={editor.draft.notes || ""} disabled={editor.locked || !canWrite} onChange={(event) => setEditorField("notes", event.target.value)} />
                  </label>
                </div>
                <p className="moduleHint">
                  {t("gross")}: <strong>{formatHrAmount(editorTotals.grossEarnings)}</strong>
                  {" · "}{t("deductions")}: <strong>{formatHrAmount(editorTotals.totalDeductions)}</strong>
                  {" · "}{t("net")}: <strong>{formatHrAmount(editorTotals.netPay)}</strong>
                </p>
                <div className="moduleFilterRow">
                  {canWrite && !editor.locked ? (
                    <button type="submit" className="moduleInlineButton" disabled={busy}>{t("save")}</button>
                  ) : null}
                  <button type="button" className="moduleInlineButton" onClick={() => setEditor(null)}>
                    {canWrite && !editor.locked ? t("cancel") : t("close")}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {allowed && !loading ? (
            <section className="moduleSection">
              <p className="moduleHint">{t("showing")} {visibleRows.length} / {rows.length}</p>
              <ExportableTable filename={`hr-monthly-${month}`} sheetName="HR Monthly" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead {...headProps} label={t("code")} filterKey="code" />
                      <BiExcelHead {...headProps} label={t("name")} filterKey="name" />
                      <BiExcelHead {...headProps} label={t("status")} filterKey="status" />
                      <BiExcelHead {...headProps} label={HR_FIELD_LABELS.workingDays[language === "ar" ? "ar" : "en"]} filterKey="workingDays" />
                      <BiExcelHead {...headProps} label={HR_FIELD_LABELS.presentDays[language === "ar" ? "ar" : "en"]} filterKey="presentDays" />
                      <BiExcelHead {...headProps} label={HR_FIELD_LABELS.absentDays[language === "ar" ? "ar" : "en"]} filterKey="absentDays" />
                      <BiExcelHead {...headProps} label={HR_FIELD_LABELS.leaveDays[language === "ar" ? "ar" : "en"]} filterKey="leaveDays" />
                      <BiExcelHead {...headProps} label={t("gross")} filterKey="gross" />
                      <BiExcelHead {...headProps} label={t("deductions")} filterKey="deductions" />
                      <BiExcelHead {...headProps} label={t("net")} filterKey="net" className="moduleBiTotalCol" />
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const { employee, record, previous } = row;
                      const currentClass = month === today ? "moduleBiMonthCell--current" : "";
                      return (
                        <tr key={employee.id}>
                          <td>{employee.employeeCode}</td>
                          <td>{language === "ar" && employee.fullNameAr ? employee.fullNameAr : employee.fullName}</td>
                          <td className={record?.status === "FINAL" ? "moduleBiMonthCell--up" : currentClass}>
                            {!record ? t("notEntered") : record.status === "FINAL" ? t("final") : t("draft")}
                          </td>
                          <td>{record?.workingDays ?? 0}</td>
                          <td>{record?.presentDays ?? 0}</td>
                          <td className={Number(record?.absentDays || 0) > 0 ? "moduleBiMonthCell--down" : ""}>{record?.absentDays ?? 0}</td>
                          <td>{record?.leaveDays ?? 0}</td>
                          <td className={compareTone(record?.grossEarnings, previous?.grossEarnings)}>{formatHrAmount(record?.grossEarnings)}</td>
                          <td className={compareTone(previous?.totalDeductions, record?.totalDeductions)}>{formatHrAmount(record?.totalDeductions)}</td>
                          <td className={`moduleBiTotalCol ${compareTone(record?.netPay, previous?.netPay)}`.trim()}>{formatHrAmount(record?.netPay)}</td>
                          <td>
                            <button type="button" className="moduleInlineButton" onClick={() => openEditor(row)}>
                              {canWrite && record?.status !== "FINAL" ? t("edit") : t("view")}
                            </button>
                            {canWrite && record?.status === "FINAL" ? (
                              <button type="button" className="moduleInlineButton" disabled={busy} onClick={() => runAction({ action: "reopen", employeeIds: [employee.id] })}>{t("reopen")}</button>
                            ) : null}
                            {canWrite && record?.status === "DRAFT" ? (
                              <button type="button" className="moduleInlineButton" disabled={busy} onClick={() => runAction({ action: "finalize", employeeIds: [employee.id] })}>{t("finalize")}</button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {!visibleRows.length ? <tr><td colSpan={11}>{t("empty")}</td></tr> : null}
                  </tbody>
                  <tfoot>
                    <tr className="moduleBiTotalRow">
                      <td colSpan={7}><strong>{t("totalFooter")}</strong></td>
                      <td><strong>{formatHrAmount(totals.gross)}</strong></td>
                      <td><strong>{formatHrAmount(totals.deductions)}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{formatHrAmount(totals.net)}</strong></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </ExportableTable>
            </section>
          ) : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
