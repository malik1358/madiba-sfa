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
  employeeMonthlyPackage,
  filterActiveFieldStaff,
  isHrHierarchySyncRole,
} from "../../lib/hr/hrEmployees";
import { formatHrAmount, hrFetch } from "../../lib/hr/hrClient";

const FILTER_KEYS = ["code", "name", "department", "designation", "iqamaExpiry", "linked", "monthlyPackage"];

const TEXT = {
  title: { en: "HR Employees", ar: "موظفو الموارد البشرية" },
  subtitle: {
    en: "Active Salesmen, Collectors and Promoters. Pull from Salesman Hierarchy imports those roles (already linked). Iqama expiry emails Soyeb, Sohail and Malik 30 days before expiry.",
    ar: "المندوبون والمحصّلون والمروّجون النشطون. السحب من هيكل المندوبين يستورد هذه الأدوار مرتبطة. تنبيه الإقامة يُرسل لسويب وسهيل ومالك قبل 30 يوماً من الانتهاء.",
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
  pullHierarchy: { en: "Pull from Salesman Hierarchy", ar: "سحب من هيكل المندوبين" },
  pulling: { en: "Pulling...", ar: "جاري السحب..." },
  pullHint: {
    en: "Creates or updates Salesman / Collector / Promoter rows from hierarchy (active only) and links logins for Prefill. Salaries stay blank for you to fill.",
    ar: "ينشئ أو يحدّث صفوف المندوب/المحصّل/المروّج من الهيكل (النشطين فقط) ويربط الحسابات للتعبئة. الرواتب تبقى فارغة لتدخلها أنت.",
  },
  editEmployee: { en: "Edit employee", ar: "تعديل موظف" },
  code: { en: "Employee code", ar: "رقم الموظف" },
  name: { en: "Name", ar: "الاسم" },
  nameAr: { en: "Name (Arabic)", ar: "الاسم بالعربية" },
  department: { en: "Department", ar: "القسم" },
  designation: { en: "Designation", ar: "المسمى الوظيفي" },
  nationality: { en: "Nationality", ar: "الجنسية" },
  iqama: { en: "Iqama / ID no.", ar: "رقم الإقامة / الهوية" },
  iqamaExpiry: { en: "Iqama expiry", ar: "انتهاء الإقامة" },
  phone: { en: "Phone", ar: "الهاتف" },
  joinDate: { en: "Joining date", ar: "تاريخ الالتحاق" },
  holidaysPerYear: { en: "Holidays per year", ar: "الإجازات السنوية" },
  status: { en: "Status", ar: "الحالة" },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Inactive", ar: "غير نشط" },
  linked: { en: "Linked login", ar: "الحساب المرتبط" },
  notLinked: { en: "— Not linked —", ar: "— غير مرتبط —" },
  basic: { en: "Basic salary", ar: "الراتب الأساسي" },
  transport: { en: "Transport", ar: "بدل النقل" },
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
  empty: { en: "No active field staff yet.", ar: "لا يوجد موظفون ميدانيون نشطون بعد." },
};

const EMPTY_FORM = {
  id: "",
  employeeCode: "",
  fullName: "",
  fullNameAr: "",
  profileId: "",
  designation: "Salesman",
  department: "Sales",
  nationality: "",
  iqamaNo: "",
  iqamaExpiry: "",
  phone: "",
  joinDate: "",
  holidaysPerYear: "",
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
  const [pulling, setPulling] = useState(false);
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

  const listEmployees = useMemo(() => filterActiveFieldStaff(employees), [employees]);
  const linkableProfiles = useMemo(
    () => profiles.filter((profile) => isHrHierarchySyncRole(profile.role) && profile.isActive !== false),
    [profiles],
  );
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  const filterValue = useCallback((employee, key) => {
    if (key === "code") return employee.employeeCode;
    if (key === "name") return employee.fullName;
    if (key === "department") return employee.department || "-";
    if (key === "designation") return employee.designation || "-";
    if (key === "iqamaExpiry") return employee.iqamaExpiry || "-";
    if (key === "linked") return employee.profileId ? t("yes") : t("no");
    if (key === "monthlyPackage") return formatHrAmount(employeeMonthlyPackage(employee));
    return "";
  }, [t]);

  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(listEmployees, FILTER_KEYS, filterValue);
  const headProps = { options, filters, onChange: setFilter, allLabel: t("all") };

  const totalPackage = useMemo(
    () => visibleRows.reduce((sum, employee) => sum + employeeMonthlyPackage(employee), 0),
    [visibleRows],
  );
  const linkedCount = listEmployees.filter((employee) => employee.profileId).length;
  const activePackage = listEmployees.reduce((sum, employee) => sum + employeeMonthlyPackage(employee), 0);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openEdit(employee) {
    setForm({
      ...EMPTY_FORM,
      ...employee,
      profileId: employee.profileId || "",
      joinDate: employee.joinDate || "",
      iqamaExpiry: employee.iqamaExpiry || "",
      holidaysPerYear: employee.holidaysPerYear ?? "",
      housingAllowance: employee.housingAllowance || 0,
      otherAllowance: employee.otherAllowance || 0,
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
        body: {
          ...form,
          profileId: form.profileId || null,
          housingAllowance: form.housingAllowance || 0,
          otherAllowance: form.otherAllowance || 0,
        },
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

  async function pullFromHierarchy() {
    if (!canWrite || pulling) return;
    setPulling(true);
    setError("");
    setMessage("");
    try {
      const payload = await hrFetch(supabaseClient, "/api/hr/employees", {
        method: "POST",
        body: { action: "sync-from-hierarchy" },
      });
      setEmployees(payload.employees || []);
      setProfiles(payload.profiles || []);
      const parts = [
        language === "ar"
          ? `أُنشئ ${payload.created || 0}، حُدّث ${payload.updated || 0}، تُخطي ${payload.skipped || 0}`
          : `Created ${payload.created || 0}, updated ${payload.updated || 0}, skipped ${payload.skipped || 0}`,
      ];
      if (payload.errors?.length) {
        parts.push(
          language === "ar"
            ? `${payload.errors.length} أخطاء`
            : `${payload.errors.length} errors`,
        );
        setError(payload.errors.slice(0, 5).map((item) => `${item.employeeCode}: ${item.error}`).join(" | "));
      }
      setMessage(parts.join(". "));
    } catch (err) {
      setError(err.message || "Unable to pull from Salesman Hierarchy.");
    } finally {
      setPulling(false);
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
                <section className="moduleMetricCard"><span>{t("totalStaff")}</span><strong>{listEmployees.length}</strong></section>
                <section className="moduleMetricCard"><span>{t("activeStaff")}</span><strong>{listEmployees.length}</strong></section>
                <section className="moduleMetricCard"><span>{t("linkedStaff")}</span><strong>{linkedCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("packageTotal")}</span><strong>{formatHrAmount(activePackage)}</strong></section>
              </div>

              {canWrite && !form ? (
                <div className="moduleFilterRow">
                  <button type="button" className="moduleInlineButton" onClick={() => setForm({ ...EMPTY_FORM })}>
                    {t("addEmployee")}
                  </button>
                  <button type="button" className="moduleInlineButton" disabled={pulling} onClick={pullFromHierarchy}>
                    {pulling ? t("pulling") : t("pullHierarchy")}
                  </button>
                  <p className="moduleHint">{t("pullHint")}</p>
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
                      <select className="moduleInput" value={form.designation} onChange={(e) => setField("designation", e.target.value)}>
                        <option value="Salesman">Salesman</option>
                        <option value="Collector">Collector</option>
                        <option value="Product promoter">Product promoter</option>
                        <option value="Promoter">Promoter</option>
                      </select>
                    </label>
                    <label>{t("nationality")}
                      <input className="moduleInput" value={form.nationality} onChange={(e) => setField("nationality", e.target.value)} />
                    </label>
                    <label>{t("iqama")}
                      <input className="moduleInput" value={form.iqamaNo} onChange={(e) => setField("iqamaNo", e.target.value)} />
                    </label>
                    <label>{t("iqamaExpiry")}
                      <input className="moduleInput" type="date" value={form.iqamaExpiry} onChange={(e) => setField("iqamaExpiry", e.target.value)} />
                    </label>
                    <label>{t("phone")}
                      <input className="moduleInput" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
                    </label>
                    <label>{t("joinDate")}
                      <input className="moduleInput" type="date" value={form.joinDate} onChange={(e) => setField("joinDate", e.target.value)} />
                    </label>
                    <label>{t("holidaysPerYear")}
                      <input className="moduleInput" type="number" min="0" step="0.5" value={form.holidaysPerYear} onChange={(e) => setField("holidaysPerYear", e.target.value)} />
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
                        {linkableProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}{profile.salesmanCode ? ` (${profile.salesmanCode})` : ""} — {profile.role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>{t("basic")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.basicSalary} onChange={(e) => setField("basicSalary", e.target.value)} />
                    </label>
                    <label>{t("transport")}
                      <input className="moduleInput" type="number" min="0" step="0.01" value={form.transportAllowance} onChange={(e) => setField("transportAllowance", e.target.value)} />
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
                <p className="moduleHint">{t("showing")} {visibleRows.length} / {listEmployees.length}</p>
                <ExportableTable filename="hr-employees" sheetName="HR Employees" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead {...headProps} label={t("code")} filterKey="code" />
                        <BiExcelHead {...headProps} label={t("name")} filterKey="name" />
                        <BiExcelHead {...headProps} label={t("department")} filterKey="department" />
                        <BiExcelHead {...headProps} label={t("designation")} filterKey="designation" />
                        <BiExcelHead {...headProps} label={t("iqamaExpiry")} filterKey="iqamaExpiry" />
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
                          <td>{employee.iqamaExpiry || "-"}</td>
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
