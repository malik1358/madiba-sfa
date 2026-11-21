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
  HR_LEAVE_STATUSES,
  HR_LEAVE_STATUS_LABELS,
  HR_LEAVE_TYPES,
  HR_LEAVE_TYPE_LABELS,
  countLeaveDays,
  summarizeLeaveByType,
} from "../../lib/hr/hrLeave";
import { isValidHrMonth } from "../../lib/hr/hrMonthlyFeed";
import { currentHrMonth, hrFetch } from "../../lib/hr/hrClient";

const FILTER_KEYS = ["code", "name", "type", "start", "end", "days", "status"];

const TEXT = {
  title: { en: "HR Leave", ar: "إجازات الموظفين" },
  subtitle: {
    en: "Leave entries per employee. Approved leave feeds the monthly attendance prefill. Fridays are holidays and are not counted.",
    ar: "إجازات كل موظف. الإجازات المعتمدة تدخل في تعبئة الحضور الشهري. الجمعة عطلة ولا تُحتسب.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading leave...", ar: "جاري تحميل الإجازات..." },
  accessDenied: { en: "Only admin, report-user and manager can open HR.", ar: "الدخول للموارد البشرية للمدير ومستخدم التقارير والمدير التنفيذي فقط." },
  readOnly: { en: "Read-only: only admin or manager can change HR data.", ar: "للعرض فقط: التعديل للمدير أو المدير التنفيذي فقط." },
  month: { en: "Month", ar: "الشهر" },
  all: { en: "All", ar: "الكل" },
  showing: { en: "Showing", ar: "يعرض" },
  addLeave: { en: "Add leave", ar: "إضافة إجازة" },
  editLeave: { en: "Edit leave", ar: "تعديل إجازة" },
  employee: { en: "Employee", ar: "الموظف" },
  choose: { en: "— Choose —", ar: "— اختر —" },
  code: { en: "Code", ar: "الرقم" },
  type: { en: "Type", ar: "النوع" },
  start: { en: "From", ar: "من" },
  end: { en: "To", ar: "إلى" },
  days: { en: "Days", ar: "الأيام" },
  status: { en: "Status", ar: "الحالة" },
  notes: { en: "Notes", ar: "ملاحظات" },
  save: { en: "Save", ar: "حفظ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  edit: { en: "Edit", ar: "تعديل" },
  remove: { en: "Delete", ar: "حذف" },
  confirmDelete: { en: "Delete this leave entry?", ar: "حذف هذه الإجازة؟" },
  actions: { en: "Actions", ar: "إجراءات" },
  saved: { en: "Leave saved.", ar: "تم حفظ الإجازة." },
  deleted: { en: "Leave deleted.", ar: "تم حذف الإجازة." },
  totalFooter: { en: "Total days", ar: "إجمالي الأيام" },
  empty: { en: "No leave in this month.", ar: "لا توجد إجازات في هذا الشهر." },
  daysPreview: { en: "Working days in range", ar: "أيام العمل في الفترة" },
};

const EMPTY_FORM = {
  id: "",
  employeeId: "",
  leaveType: "ANNUAL",
  startDate: "",
  endDate: "",
  status: "APPROVED",
  notes: "",
};

export default function HrLeavePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const lang = language === "ar" ? "ar" : "en";
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(() => currentHrMonth());
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(null);

  usePopupMessages({ error, message });

  const allowed = Boolean(access?.canAccess?.("hrLeave"));
  const canWrite = canWriteHr(access?.role);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !isValidHrMonth(month)) return;
    setLoading(true);
    setError("");
    try {
      const payload = await hrFetch(supabase, "/api/hr/leave", { params: { month } });
      setEmployees(payload.employees || []);
      setEntries(payload.entries || []);
    } catch (err) {
      setError(err.message || "Unable to load leave.");
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

  const filterValue = useCallback((entry, key) => {
    const employee = employeeById.get(entry.employeeId);
    if (key === "code") return employee?.employeeCode || "-";
    if (key === "name") return employee?.fullName || "-";
    if (key === "type") return HR_LEAVE_TYPE_LABELS[entry.leaveType]?.[lang] || entry.leaveType;
    if (key === "start") return entry.startDate;
    if (key === "end") return entry.endDate;
    if (key === "days") return String(entry.days);
    if (key === "status") return HR_LEAVE_STATUS_LABELS[entry.status]?.[lang] || entry.status;
    return "";
  }, [employeeById, lang]);

  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(entries, FILTER_KEYS, filterValue);
  const headProps = { options, filters, onChange: setFilter, allLabel: t("all") };
  const totalDays = visibleRows.reduce((sum, entry) => sum + Number(entry.days || 0), 0);
  const byType = useMemo(() => summarizeLeaveByType(entries), [entries]);
  const previewDays = form?.startDate && form?.endDate ? countLeaveDays(form.startDate, form.endDate) : 0;

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!canWrite || !form) return;
    setSaving(true);
    setError("");
    try {
      await hrFetch(supabaseClient, "/api/hr/leave", { method: form.id ? "PUT" : "POST", body: form });
      setMessage(t("saved"));
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Unable to save leave.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry) {
    if (!canWrite || !window.confirm(t("confirmDelete"))) return;
    setError("");
    try {
      await hrFetch(supabaseClient, "/api/hr/leave", { method: "DELETE", params: { id: entry.id } });
      setMessage(t("deleted"));
      await load();
    } catch (err) {
      setError(err.message || "Unable to delete leave.");
    }
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
              {canWrite && !form ? (
                <button type="button" className="moduleInlineButton" onClick={() => setForm({ ...EMPTY_FORM })}>{t("addLeave")}</button>
              ) : null}
            </div>
          ) : null}

          {allowed && !loading ? (
            <div className="moduleMetricGrid">
              {HR_LEAVE_TYPES.map((type) => (
                <section key={type} className="moduleMetricCard">
                  <span>{HR_LEAVE_TYPE_LABELS[type][lang]}</span>
                  <strong>{byType[type] || 0}</strong>
                </section>
              ))}
            </div>
          ) : null}

          {allowed && canWrite && form ? (
            <section className="moduleSection">
              <h2>{form.id ? t("editLeave") : t("addLeave")}</h2>
              <form className="moduleFormGrid" onSubmit={saveForm}>
                <label>{t("employee")}
                  <select className="moduleInput" required value={form.employeeId} onChange={(e) => setField("employeeId", e.target.value)}>
                    <option value="">{t("choose")}</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.employeeCode} — {employee.fullName}</option>
                    ))}
                  </select>
                </label>
                <label>{t("type")}
                  <select className="moduleInput" value={form.leaveType} onChange={(e) => setField("leaveType", e.target.value)}>
                    {HR_LEAVE_TYPES.map((type) => <option key={type} value={type}>{HR_LEAVE_TYPE_LABELS[type][lang]}</option>)}
                  </select>
                </label>
                <label>{t("start")}
                  <input className="moduleInput" type="date" required value={form.startDate} onChange={(e) => setField("startDate", e.target.value)} />
                </label>
                <label>{t("end")}
                  <input className="moduleInput" type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setField("endDate", e.target.value)} />
                </label>
                <label>{t("status")}
                  <select className="moduleInput" value={form.status} onChange={(e) => setField("status", e.target.value)}>
                    {HR_LEAVE_STATUSES.map((status) => <option key={status} value={status}>{HR_LEAVE_STATUS_LABELS[status][lang]}</option>)}
                  </select>
                </label>
                <label className="moduleFieldFull">{t("notes")}
                  <input className="moduleInput" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
                </label>
                <p className="moduleFieldFull moduleHint">{t("daysPreview")}: <strong>{previewDays}</strong></p>
                <div className="moduleFieldFull moduleFilterRow">
                  <button type="submit" className="moduleInlineButton" disabled={saving}>{t("save")}</button>
                  <button type="button" className="moduleInlineButton" onClick={() => setForm(null)}>{t("cancel")}</button>
                </div>
              </form>
            </section>
          ) : null}

          {allowed && loading ? <p>{t("loading")}</p> : null}

          {allowed && !loading ? (
            <section className="moduleSection">
              <p className="moduleHint">{t("showing")} {visibleRows.length} / {entries.length}</p>
              <ExportableTable filename={`hr-leave-${month}`} sheetName="HR Leave" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead {...headProps} label={t("code")} filterKey="code" />
                      <BiExcelHead {...headProps} label={t("employee")} filterKey="name" />
                      <BiExcelHead {...headProps} label={t("type")} filterKey="type" />
                      <BiExcelHead {...headProps} label={t("start")} filterKey="start" />
                      <BiExcelHead {...headProps} label={t("end")} filterKey="end" />
                      <BiExcelHead {...headProps} label={t("days")} filterKey="days" className="moduleBiTotalCol" />
                      <BiExcelHead {...headProps} label={t("status")} filterKey="status" />
                      <th>{t("notes")}</th>
                      {canWrite ? <th>{t("actions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((entry) => {
                      const employee = employeeById.get(entry.employeeId);
                      const statusClass = entry.status === "APPROVED"
                        ? "moduleBiMonthCell--up"
                        : entry.status === "REJECTED" ? "moduleBiMonthCell--down" : "moduleBiMonthCell--current";
                      return (
                        <tr key={entry.id}>
                          <td>{employee?.employeeCode || "-"}</td>
                          <td>{employee?.fullName || "-"}</td>
                          <td>{HR_LEAVE_TYPE_LABELS[entry.leaveType]?.[lang] || entry.leaveType}</td>
                          <td>{entry.startDate}</td>
                          <td>{entry.endDate}</td>
                          <td className="moduleBiTotalCol">{entry.days}</td>
                          <td className={statusClass}>{HR_LEAVE_STATUS_LABELS[entry.status]?.[lang] || entry.status}</td>
                          <td>{entry.notes || "-"}</td>
                          {canWrite ? (
                            <td>
                              <button type="button" className="moduleInlineButton" onClick={() => setForm({ ...EMPTY_FORM, ...entry })}>{t("edit")}</button>
                              <button type="button" className="moduleInlineButton" onClick={() => removeEntry(entry)}>{t("remove")}</button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {!visibleRows.length ? <tr><td colSpan={canWrite ? 9 : 8}>{t("empty")}</td></tr> : null}
                  </tbody>
                  <tfoot>
                    <tr className="moduleBiTotalRow">
                      <td colSpan={5}><strong>{t("totalFooter")}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{totalDays}</strong></td>
                      <td colSpan={canWrite ? 3 : 2} />
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
