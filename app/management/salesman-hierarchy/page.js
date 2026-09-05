"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MostVisitedPages from "../../components/MostVisitedPages";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import ExportableTable from "../../components/ExportableTable";

const TEXT = {
  title: { en: "Salesman Hierarchy", ar: "هيكل مندوبي المبيعات" },
  subtitle: { en: "Assign salesmen under a head salesman, set pricing region, and manage default testing passwords", ar: "تعيين المندوبين تحت رئيس مندوبين وتحديد منطقة التسعير وإدارة كلمات المرور الافتراضية" },
  management: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading salesman hierarchy...", ar: "جاري تحميل هيكل المندوبين..." },
  statusActive: { en: "Active", ar: "نشط" },
  statusInactive: { en: "Inactive", ar: "غير نشط" },
  deactivate: { en: "Deactivate", ar: "إيقاف" },
  activate: { en: "Activate", ar: "تفعيل" },
  activeUsers: { en: "Active users", ar: "المستخدمون النشطون" },
  inactiveUsers: { en: "Inactive users", ar: "المستخدمون غير النشطين" },
  inactiveHint: {
    en: "Inactive users are hidden from User Activity but remain in the hierarchy for reference.",
    ar: "المستخدمون غير النشطين لا يظهرون في نشاط المستخدمين لكنهم يبقون في الهيكل للرجوع إليهم.",
  },
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCredentialToken(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function displayLoginName(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("@") ? text.split("@")[0] : text;
}

function isRandomPassword(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "invoice-maker" || normalized === "invoice_maker";
}

function autoCodeHintForRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "invoice-maker" || normalized === "invoice_maker") return "IV###";
  if (normalized === "product-promoter" || normalized === "product_promoter") return "PP###";
  return "SM###";
}

const ROLE_OPTIONS = [
  { value: "salesman", label: "Salesman" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "invoice-maker", label: "Invoice Maker" },
  { value: "product-promoter", label: "Product Promoter" },
  { value: "collector", label: "Collector" },
];

function normalizeRoleValue(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  return ROLE_OPTIONS.some((option) => option.value === normalized) ? normalized : "salesman";
}

export default function SalesmanHierarchyPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [resettingId, setResettingId] = useState("");
  const [togglingActiveId, setTogglingActiveId] = useState("");
  const [bulkResetting, setBulkResetting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  usePopupMessages({ message, error });
  const [salesmen, setSalesmen] = useState([]);
  const [headOptions, setHeadOptions] = useState([]);
  const [headSelections, setHeadSelections] = useState({});
  const [roleSelections, setRoleSelections] = useState({});
  const [newSalesman, setNewSalesman] = useState({
    salesmanName: "",
    salesmanCode: "",
    email: "",
    role: "salesman",
    headSalesmanCode: "",
    pricingRegion: "riyadh",
  });
  const [regionSelections, setRegionSelections] = useState({});

  async function loadHierarchy(showLoader = false) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (showLoader) {
      setLoading(true);
    }

    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const response = await fetch("/api/admin/salesmen-hierarchy", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load salesman hierarchy.");
      }

      setSalesmen(data.salesmen || []);
      setHeadOptions(data.headOptions || []);
      setHeadSelections(
        Object.fromEntries((data.salesmen || []).map((salesman) => [salesman.id, salesman.head_salesman_code || ""]))
      );
      setRoleSelections(
        Object.fromEntries((data.salesmen || []).map((salesman) => [salesman.id, normalizeRoleValue(salesman.role)]))
      );
      setRegionSelections(
        Object.fromEntries((data.salesmen || []).map((salesman) => [salesman.id, salesman.pricing_region || "riyadh"]))
      );
    } catch (err) {
      setError(err.message || "Unable to load salesman hierarchy.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHierarchy(true);
  }, []);

  const summary = useMemo(() => {
    const assigned = salesmen.filter((salesman) => Boolean(salesman.head_salesman_code)).length;
    const heads = new Set(salesmen.map((salesman) => salesman.head_salesman_code).filter(Boolean));
    const active = salesmen.filter((salesman) => salesman.is_active !== false).length;

    return {
      total: salesmen.length,
      active,
      inactive: salesmen.length - active,
      assigned,
      heads: heads.size,
    };
  }, [salesmen]);

  async function postAction(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return false;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setError("Please login again.");
      return false;
    }

    const response = await fetch("/api/admin/salesmen-hierarchy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Unable to complete request.");
    }

    return data;
  }

  async function saveHeadAssignment(salesman) {
    setSavingId(salesman.id);
    setError("");
    setMessage("");

    try {
      const nextRole = normalizeRoleValue(roleSelections[salesman.id]);
      const messages = [];

      if (nextRole !== normalizeRoleValue(salesman.role)) {
        const roleResult = await postAction({
          mode: "update-role",
          salesmanId: salesman.id,
          role: nextRole,
        });
        messages.push(roleResult.message || "Role updated.");
      }

      const result = await postAction({
        mode: "assign-head",
        salesmanId: salesman.id,
        headSalesmanCode: headSelections[salesman.id] || "",
        pricingRegion: regionSelections[salesman.id] || "riyadh",
      });
      messages.push(result.message || "Head salesman saved.");

      setMessage(messages.join(" "));
      await loadHierarchy(false);
    } catch (err) {
      setError(err.message || "Unable to save assignment.");
    } finally {
      setSavingId("");
    }
  }

  async function resetPassword(salesman) {
    setResettingId(salesman.id);
    setError("");
    setMessage("");

    try {
      const result = await postAction({
        mode: "reset-password",
        salesmanId: salesman.id,
      });

      setMessage(`${result.message || "Password reset."} New password: ${result.password || "-"}`);
    } catch (err) {
      setError(err.message || "Unable to reset password.");
    } finally {
      setResettingId("");
    }
  }

  async function createSalesman(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setMessage("");

    try {
      const result = await postAction({
        mode: "create-salesman",
        salesmanName: newSalesman.salesmanName,
        salesmanCode: normalizeCode(newSalesman.salesmanCode),
        email: String(newSalesman.email || "").trim().toLowerCase(),
        role: String(newSalesman.role || "salesman"),
        headSalesmanCode: normalizeCode(newSalesman.headSalesmanCode || ""),
        pricingRegion: newSalesman.pricingRegion || "riyadh",
      });

      const created = result.created || {};
      const createdRole = String(created.role || "salesman").replace("_", " ");
      setMessage(
        `${result.message || "User created."} Role: ${createdRole.toUpperCase()} | Username: ${created.login_name || displayLoginName(created.email) || "-"} | Password: ${created.password || "-"}`
      );
      setNewSalesman({ salesmanName: "", salesmanCode: "", email: "", role: "salesman", headSalesmanCode: "", pricingRegion: "riyadh" });
      await loadHierarchy(false);
    } catch (err) {
      setError(err.message || "Unable to create salesman.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActiveStatus(salesman) {
    setTogglingActiveId(salesman.id);
    setError("");
    setMessage("");

    try {
      const result = await postAction({
        mode: "set-active",
        salesmanId: salesman.id,
        isActive: salesman.is_active === false,
      });
      setMessage(result.message || "User status updated.");
      await loadHierarchy(false);
    } catch (err) {
      setError(err.message || "Unable to update user status.");
    } finally {
      setTogglingActiveId("");
    }
  }

  async function resetAllPasswords() {
    setBulkResetting(true);
    setError("");
    setMessage("");

    try {
      const result = await postAction({ mode: "reset-all-passwords" });
      setMessage(result.message || "Default passwords reset for all salesmen.");
    } catch (err) {
      setError(err.message || "Unable to reset all passwords.");
    } finally {
      setBulkResetting(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Salesman hierarchy unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to manage salesman hierarchy and default credentials."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate>
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <div className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>{t("title")}</h1>
            <p className="moduleSubtitle">{t("subtitle")}</p>
          </div>
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><Link href="/management" className="moduleBackLink">{t("management")}</Link></div>
        </div>

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>Total salesmen</span><strong>{summary.total}</strong></section>
          <section className="moduleMetricCard"><span>{t("activeUsers")}</span><strong>{summary.active}</strong></section>
          <section className="moduleMetricCard"><span>{t("inactiveUsers")}</span><strong>{summary.inactive}</strong></section>
          <section className="moduleMetricCard"><span>Assigned under head</span><strong>{summary.assigned}</strong></section>
          <section className="moduleMetricCard"><span>Head salesmen in use</span><strong>{summary.heads}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Create User</h2>
            <span>Creates login and profile in one step</span>
          </div>

          <form className="moduleFormGrid" onSubmit={createSalesman}>
            <label>
              Salesman Name
              <input
                className="moduleInput"
                required
                value={newSalesman.salesmanName}
                onChange={(event) => setNewSalesman((current) => ({ ...current, salesmanName: event.target.value }))}
                placeholder="Ali Khan"
              />
            </label>

            <label>
              Salesman Code
              <input
                className="moduleInput"
                value={autoCodeHintForRole(newSalesman.role)}
                disabled
                readOnly
                placeholder="Auto generated"
              />
            </label>

            <label>
              Username/Login
              <input
                className="moduleInput"
                required
                type="text"
                value={newSalesman.email}
                onChange={(event) => setNewSalesman((current) => ({ ...current, email: event.target.value }))}
                placeholder="ahmed.nabil"
              />
            </label>

            <label>
              User Role
              <select
                className="moduleInput"
                value={newSalesman.role}
                onChange={(event) => setNewSalesman((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="salesman">Salesman</option>
                <option value="collector">Collector</option>
                <option value="product-promoter">Product Promoter</option>
                <option value="invoice-maker">Invoice Maker</option>
              </select>
            </label>

            <label>
              Pricing Region
              <select
                className="moduleInput"
                value={newSalesman.pricingRegion}
                onChange={(event) => setNewSalesman((current) => ({ ...current, pricingRegion: event.target.value }))}
              >
                <option value="riyadh">Riyadh</option>
                <option value="dammam">Dammam</option>
                <option value="jeddah">Jeddah</option>
              </select>
            </label>

            <label>
              Assign Head Salesman
              <select
                className="moduleInput"
                value={newSalesman.headSalesmanCode}
                disabled={isInvoiceMakerRole(newSalesman.role)}
                onChange={(event) => setNewSalesman((current) => ({ ...current, headSalesmanCode: event.target.value }))}
              >
                <option value="">No head</option>
                {headOptions.map((option) => (
                  <option key={`new-${option.id}`} value={option.salesman_code || ""}>
                    {option.salesman_name || option.salesman_code} {option.salesman_code ? `(${option.salesman_code})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="moduleFieldFull">
              <button className="modulePrimaryButton" type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create User"}
              </button>
            </div>
          </form>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Hierarchy Assignment</h2>
            <button type="button" className="moduleInlineButton" onClick={resetAllPasswords} disabled={bulkResetting}>
              {bulkResetting ? "Resetting..." : "Reset All Passwords"}
            </button>
          </div>
          <div className="moduleHint" style={{ marginBottom: "10px" }}>{t("inactiveHint")}</div>

          <ExportableTable filename="salesman-hierarchy" sheetName="Hierarchy" className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Salesman</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Region</th>
                  <th>Username</th>
                  <th>Current Head</th>
                  <th>Assign Head</th>
                  <th>Default Password</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {salesmen.map((salesman) => {
                  const currentHead = headOptions.find((option) => option.salesman_code === salesman.head_salesman_code);
                  const loginName = salesman.login_name || displayLoginName(salesman.email);
                  const password = isRandomPassword(salesman.default_password) ? salesman.default_password : "Pending reset";

                  return (
                    <tr key={salesman.id} style={salesman.is_active === false ? { opacity: 0.72 } : undefined}>
                      <td>
                        <strong>{salesman.salesman_name || salesman.salesman_code || salesman.id}</strong>
                        <div className="moduleCode">{salesman.salesman_code || salesman.id}</div>
                      </td>
                      <td>
                        <span className={salesman.is_active === false ? "moduleHint" : undefined}>
                          {salesman.is_active === false ? t("statusInactive") : t("statusActive")}
                        </span>
                      </td>
                      <td>
                        <select
                          className="moduleInput"
                          value={roleSelections[salesman.id] || normalizeRoleValue(salesman.role)}
                          onChange={(event) => setRoleSelections((current) => ({ ...current, [salesman.id]: event.target.value }))}
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={`${salesman.id}-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="moduleInput"
                          value={regionSelections[salesman.id] || salesman.pricing_region || "riyadh"}
                          onChange={(event) => setRegionSelections((current) => ({ ...current, [salesman.id]: event.target.value }))}
                        >
                          <option value="riyadh">Riyadh</option>
                          <option value="dammam">Dammam</option>
                          <option value="jeddah">Jeddah</option>
                        </select>
                      </td>
                      <td>{loginName || "No username"}</td>
                      <td>{currentHead ? `${currentHead.salesman_name || currentHead.salesman_code} (${currentHead.salesman_code})` : "-"}</td>
                      <td>
                        <select
                          className="moduleInput"
                          value={headSelections[salesman.id] || ""}
                          disabled={isInvoiceMakerRole(salesman.role)}
                          onChange={(event) => setHeadSelections((current) => ({ ...current, [salesman.id]: event.target.value }))}
                        >
                          <option value="">No head</option>
                          {headOptions
                            .filter((option) => option.id !== salesman.id)
                            .map((option) => (
                              <option key={`${salesman.id}-${option.id}`} value={option.salesman_code || ""}>
                                {option.salesman_name || option.salesman_code} {option.salesman_code ? `(${option.salesman_code})` : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>{password}</td>
                      <td>
                        <div className="moduleActionRow">
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => saveHeadAssignment(salesman)}
                            disabled={savingId === salesman.id}
                          >
                            {savingId === salesman.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => resetPassword(salesman)}
                            disabled={resettingId === salesman.id}
                          >
                            {resettingId === salesman.id ? "Resetting..." : "Reset Password"}
                          </button>
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => toggleActiveStatus(salesman)}
                            disabled={togglingActiveId === salesman.id}
                          >
                            {togglingActiveId === salesman.id
                              ? "Saving..."
                              : (salesman.is_active === false ? t("activate") : t("deactivate"))}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {salesmen.length === 0 && (
                  <tr>
                    <td colSpan={9}>No users found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </ExportableTable>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Testing Notes</h2>
          </div>
          <div className="moduleHint">
            Login uses the username shown in the table. Passwords are now random 6-digit numbers and are shown in the table after creation or reset.
          </div>
        </section>
      </div>
    </main>
    </MorningAttendanceGate>
  );
}