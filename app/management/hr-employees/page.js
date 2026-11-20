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
import { employeeMonthlyPackage } from "../../lib/hr/hrEmployees";
import { formatHrAmount, hrFetch } from "../../lib/hr/hrClient";

const FILTER_KEYS = ["code", "name", "department", "designation", "status", "linked", "monthlyPackage"];

const TEXT = {
  title: { en: "HR Employees", ar: "موظفو الموارد البشرية" },
  subtitle: {
    en: "All company staff. Link a staff row to a login profile to prefill attendance.",
    ar: "جميع موظفي الشركة. اربط الموظف بحساب دخول لتعبئة الحضور تلقائياً.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading staff...", ar: "جاري تحميل الموظفين..." },
  accessDenied: { en: "Only admin, report-user and manager can open HR.", ar: "الدخول للموارد البشرية للمدير ومستخدم التقارير والمدير التنفيذي فقط." },
  readOnly: { en: "Read-only: only admin or manager can change HR data.", ar: "للعرض فقط: التعديل للمدير أو المدير التنفيذي فقط." },
  all: { en: "All", ar: "الكل" },
  showing: { en: "Showing", ar: "يعرض" },
  totalStaff: { en: "Staff", ar: "الموظفون" },
  activeStaff: { en: "Active", ar: "نشط" },
  linkedStaff: { en: "Linked to login", ar: "مرتبط بحساب" },
  packageTotal: { en: "Monthly package (active)", ar: "إجمالي الباقة الشهرية (النشطين)" },
  addEmployee: { en: "Add employee", ar: "إضافة موظف" },
  editEmployee: { en: "Edit employee", ar: "تعديل موظف" },
  code: { en: "Employee code", ar: "رقم الموظف" },
  name: { en: "Name", ar: "الاسم" },
  nameAr: { en: "Name (Arabic)", ar: "الاسم بالعربية" },
  department: { en: "Department", ar: "القسم" },
  designation: { en: "Designation", ar: "المسمى الوظيفي" },
  nationality: { en: "Nationality", ar: "الجنسية" },
  iqama: { en: "Iqama / ID no.", ar: "رقم الإقامة / الهوية" },
  phone: { en: "Phone", ar: "الهاتف" },
  joinDate: { en: "Join date", ar: "تاريخ الالتحاق" },
  status: { en: "Status", ar: "الحالة" },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Inactive", ar: "غير نشط" },
  linked: { en: "Linked login", ar: "الحساب المرتبط" },
  notLinked: { en: "— Not linked —", ar: "— غير مرتبط —" },
  basic: { en: "Basic salary", ar: "الراتب الأساسي" },
  housing: { en: "Housing", ar: "بدل السكن" },
  transport: { en: "Transport", ar: "بدل النقل" },
  otherAllowance: { en: "Other allowance", ar: "بدلات أخرى" },
  monthlyPackage: { en: "Monthly package", ar: "الباقة الشهرية" },
  notes: { en: "Notes", ar: "ملاحظات" },
  save: { en: "Save", ar: "حفظ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  edit: { en: "Edit", ar: "تعديل" },
  actions: { en: "Actions", ar: "إجراءات" },
  saved: { en: "Employee saved.", ar: "تم حفظ الموظف." },
  yes: { en: "Linked", ar: "مرتبط" },
  no: { en: "No", ar: "لا" },
  totalFooter: { en: "Total", ar: "الإجمالي" },
  empty: { en: "No staff yet.", ar: "لا يوجد موظفون بعد." },
};

const EMPTY_FORM = {
  id: "",
  employeeCode: "",
  fullName: "",
  fullNameAr: "",
  profileId: "",
  designation: "",
  department: "",
  nationality: "",
  iqamaNo: "",
  phone: "",
  joinDate: "",
  status: "ACTIVE",
  basicSalary: "",
  housingAllowance: "",
  transportAllowance: "",
  otherAllowance: "",
  notes: "",
};

export default function HrEmployeesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(null);

  usePopupMessages({ error, message });

  const allowed = Boolean(access?.canAccess?.("hrEmployees"));
  const canWrite = canWriteHr(access?.role);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const payload = await hrFetch(supabase, "/api/hr/employees");
      setEmployees(payload.employees || []);
      setProfiles(payload.profiles || []);
    } catch (err) {
      setError(err.message || "Unable to load staff.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    load();
  }, [accessLoading, allowed, load]);

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  const filterValue = useCallback((employee, key) => {
    if (key === "code") return employee.employeeCode;
    if (key === "name") return employee.fullName;
    if (key === "department") return employee.department || "-";
    if (key === "designation") return employee.designation || "-";
    if (key === "status") return employee.status === "ACTIVE" ? t("active") : t("inactive");
    if (key === "linked") return employee.profileId ? t("yes") : t("no");
    if (key === "monthlyPackage") return formatHrAmount(employeeMonthlyPackage(employee));
    return "";
  }, [t]);

  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(employees, FILTER_KEYS, filterValue);
  const headProps = { options, filters, onChange: setFilter, allLabel: t("all") };

  const totalPackage = useMemo(
    () => visibleRows.reduce((sum, employee) => sum + employeeMonthlyPackage(employee), 0),
    [visibleRows],
  );
  const activeCount = employees.filter((employee) => employee.status === "ACTIVE").length;
  const linkedCount = employees.filter((employee) => employee.profileId).length;
  const activePackage = employees
    .filter((employee) => employee.status === "ACTIVE")
    .reduce((sum, employee) => sum + employeeMonthlyPackage(employee), 0);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openEdit(employee) {
    setForm({
      ...EMPTY_FORM,
      ...employee,
      profileId: employee.profileId || "",
      joinDate: employee.joinDate || "",
    });
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!canWrite || !form) return;
    setSaving(true);
    setError("");
    try {
      await hrFetch(supabaseClient, "/api/hr/employees", {
        method: form.id ? "PUT" : "POST",
        body: { ...form, profileId: form.profileId || null },
      });
      setMessage(t("saved"));
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || "Unable to save employee.");
    } finally {
      setSaving(false);
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
          {allowed && loading ? <p>{t("loading")}</p> : null}

          {allowed && !loading ? (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard"><span>{t("totalStaff")}</span><strong>{employees.length}</strong></section>
                <section className="moduleMetricCard"><span>{t("activeStaff")}</span><strong>{activeCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("linkedStaff")}</span><strong>{linkedCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("packageTotal")}</span><strong>{formatHrAmount(activePackage)}</strong></section>
              </div>

              {canWrite && !form ? (
                <div className="moduleFilterRow">
                  <button type="button" className="moduleInlineButton" onClick={() => setForm({ ...EMPTY_FORM })}>
                    {t("addEmployee")}
                  </button>
                </div>
              ) : null}

              {canWrite && form ? (
                <section className="moduleSection">
                  <h2>{form.id ? t("editEmployee") : t("addEmployee")}</h2>
                  <form className="moduleFormGrid" onSubmit={saveForm}>
                    <label>{t("code")}
                      <input className="moduleInput" value={form.employeeCode} required onChange={(e) => setField("employeeCode", e.target.value)} />
                    </label>
                    <label>{t("name")}
                      <input className="moduleInput" value={form.fullName} required onChange={(e) => setField("fullName", e.target.value)} />
                    </label>
                    <label>{t("nameAr")}
                      <input className="moduleInput" dir="rtl" value={form.fullNameAr} onChange={(e) => setField("fullNameAr", e.target.value)} />
                    </label>
                    <label>{t("department")}
                      <input className="moduleInput" value={form.department} onChange={(e) => setField("department", e.target.value)} />
                    </label>
                    <label>{t("designation")}
                      <input className="moduleInput" value={form.designation} onChange={(e) => setField("designation", e.target.value)} />
                    </label>
                    <label>{t("nationality")}
                      <input className="moduleInput" value={form.nationality} onChange={(e) => setField("nationality", e.target.value)} />
                    </label>
                    <label>{t("iqama")}
                      <input className="moduleInput" value={form.iqamaNo} onChange={(e) => setField("iqamaNo", e.target.value)} />
                    </label>
                    <label>{t("phone")}
                      <input className="moduleInput" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
                    </label>
                    <label>{t("joinDate")}
                      <input className="moduleInput" type="date" value={form.joinDate} onChange={(e) => setField("joinDate", e.target.value)} />
                    </label>
                    <label>{t("status")}
                      <select className="moduleInput" value={form.status} onChange={(e) => setField("status", e.target.value)}>
                        <option value="ACTIVE">{t("active")}</option>
                        <option value="INACTIVE">{t("inactive")}</option>
                      </select>
                    </label>
                    <label>{t("linked")}
                      <select className="moduleInput" value={form.profileId} onChange={(e) => setField("profileId", e.target.value)}>
                        <option value="">{t("notLinked")}</option>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}{profile.salesmanCode ? ` (${profile.salesmanCode})` : ""} — {profile.role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>{t("basic")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.basicSalary} onChange={(e) => setField("basicSalary", e.target.value)} />
                    </label>
                    <label>{t("housing")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.housingAllowance} onChange={(e) => setField("housingAllowance", e.target.value)} />
                    </label>
                    <label>{t("transport")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.transportAllowance} onChange={(e) => setField("transportAllowance", e.target.value)} />
                    </label>
                    <label>{t("otherAllowance")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.otherAllowance} onChange={(e) => setField("otherAllowance", e.target.value)} />
                    </label>
                    <label className="moduleFieldFull">{t("notes")}
                      <input className="moduleInput" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
                    </label>
                    <div className="moduleFieldFull moduleFilterRow">
                      <button type="submit" className="moduleInlineButton" disabled={saving}>{t("save")}</button>
                      <button type="button" className="moduleInlineButton" onClick={() => setForm(null)}>{t("cancel")}</button>
                    </div>
                  </form>
                </section>
              ) : null}

              <section className="moduleSection">
                <p className="moduleHint">{t("showing")} {visibleRows.length} / {employees.length}</p>
                <ExportableTable filename="hr-employees" sheetName="HR Employees" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead {...headProps} label={t("code")} filterKey="code" />
                        <BiExcelHead {...headProps} label={t("name")} filterKey="name" />
                        <BiExcelHead {...headProps} label={t("department")} filterKey="department" />
                        <BiExcelHead {...headProps} label={t("designation")} filterKey="designation" />
                        <BiExcelHead {...headProps} label={t("status")} filterKey="status" />
                        <BiExcelHead {...headProps} label={t("linked")} filterKey="linked" />
                        <BiExcelHead {...headProps} label={t("monthlyPackage")} filterKey="monthlyPackage" className="moduleBiTotalCol" />
                        {canWrite ? <th>{t("actions")}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((employee) => (
                        <tr key={employee.id}>
                          <td>{employee.employeeCode}</td>
                          <td>{language === "ar" && employee.fullNameAr ? employee.fullNameAr : employee.fullName}</td>
                          <td>{employee.department || "-"}</td>
                          <td>{employee.designation || "-"}</td>
                          <td className={employee.status === "ACTIVE" ? "moduleBiMonthCell--up" : "moduleBiMonthCell--down"}>
                            {employee.status === "ACTIVE" ? t("active") : t("inactive")}
                          </td>
                          <td>{employee.profileId ? (profileById.get(employee.profileId)?.name || t("yes")) : "-"}</td>
                          <td className="moduleBiTotalCol">{formatHrAmount(employeeMonthlyPackage(employee))}</td>
                          {canWrite ? (
                            <td>
                              <button type="button" className="moduleInlineButton" onClick={() => openEdit(employee)}>{t("edit")}</button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {!visibleRows.length ? (
                        <tr><td colSpan={canWrite ? 8 : 7}>{t("empty")}</td></tr>
                      ) : null}
                    </tbody>
                    <tfoot>
                      <tr className="moduleBiTotalRow">
                        <td colSpan={6}><strong>{t("totalFooter")}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatHrAmount(totalPackage)}</strong></td>
                        {canWrite ? <td /> : null}
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
