"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  ACCESS_MATRIX_ROLES,
  MODULES,
  NAV_GROUPS,
  ROLE_ACCESS_LOCKED_ROLES,
  buildDefaultRoleModuleMatrix,
  localizedModuleLabel,
  localizedNavGroupLabel,
  localizedRoleLabel,
  normalizeRoleModuleMatrix,
} from "../../lib/moduleAccess";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Role Access", ar: "صلاحيات الأدوار" },
  subtitle: {
    en: "Tick which role can open each page. Changes apply after users refresh or reopen the app.",
    ar: "حدد الأدوار التي يمكنها فتح كل صفحة. تُطبَّق التغييرات بعد تحديث الصفحة أو إعادة فتح التطبيق.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading role access...", ar: "جاري تحميل صلاحيات الأدوار..." },
  save: { en: "Save access", ar: "حفظ الصلاحيات" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  reset: { en: "Reset to defaults", ar: "إعادة الافتراضي" },
  saved: {
    en: "Role access saved. Users see the new ticks after they refresh.",
    ar: "تم حفظ صلاحيات الأدوار. يظهر التحديد الجديد بعد تحديث الصفحة.",
  },
  defaultHint: {
    en: "Showing built-in defaults. Save to store this matrix in the database.",
    ar: "تُعرض القيم الافتراضية المدمجة. احفظ لتخزين هذه المصفوفة في قاعدة البيانات.",
  },
  denied: { en: "Only admin can configure role access.", ar: "يمكن لمدير النظام فقط ضبط صلاحيات الأدوار." },
  page: { en: "Page", ar: "الصفحة" },
  path: { en: "Path", ar: "المسار" },
  group: { en: "Group", ar: "المجموعة" },
  locked: { en: "Locked for admin", ar: "مقفل للمدير" },
  updated: { en: "Last saved", ar: "آخر حفظ" },
  by: { en: "by", ar: "بواسطة" },
};

function cloneMatrix(matrix) {
  return normalizeRoleModuleMatrix(matrix || buildDefaultRoleModuleMatrix());
}

export default function RoleAccessPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(false);
  const [matrix, setMatrix] = useState(() => cloneMatrix());
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);

  usePopupMessages({ message, error });

  const canConfigure = access.canAccess("roleAccess");

  const moduleRows = useMemo(() => {
    const rows = [];
    const seen = new Set();
    for (const group of NAV_GROUPS) {
      for (const moduleKey of group.modules) {
        if (!MODULES[moduleKey] || seen.has(moduleKey)) continue;
        seen.add(moduleKey);
        rows.push({
          moduleKey,
          groupKey: group.key,
          href: MODULES[moduleKey].href,
        });
      }
    }
    for (const moduleKey of Object.keys(MODULES)) {
      if (seen.has(moduleKey)) continue;
      rows.push({
        moduleKey,
        groupKey: "",
        href: MODULES[moduleKey].href,
      });
    }
    return rows;
  }, []);

  async function loadMatrix() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/role-module-access",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load role access.");
      }
      setMatrix(cloneMatrix(payload.matrix));
      setConfigured(Boolean(payload.configured));
      setUpdatedAt(payload.updatedAt || null);
      setUpdatedBy(payload.updatedBy || null);
    } catch (err) {
      setError(err.message || "Unable to load role access.");
      setMatrix(cloneMatrix());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (accessLoading) return;
    if (!canConfigure) {
      setLoading(false);
      return;
    }
    loadMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, canConfigure]);

  function toggleCell(moduleKey, role) {
    if (ROLE_ACCESS_LOCKED_ROLES.includes(role) && moduleKey === "roleAccess") return;
    setMatrix((current) => {
      const next = cloneMatrix(current);
      next[role][moduleKey] = !next[role][moduleKey];
      return next;
    });
  }

  function resetDefaults() {
    setMatrix(cloneMatrix(buildDefaultRoleModuleMatrix()));
    setMessage("");
    setError("");
  }

  async function saveMatrix() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/role-module-access",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ matrix }),
        },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save role access.");
      }
      setMatrix(cloneMatrix(payload.matrix));
      setConfigured(true);
      setUpdatedAt(payload.updatedAt || null);
      setUpdatedBy(payload.updatedBy || null);
      setMessage(t("saved"));
    } catch (err) {
      setError(err.message || "Unable to save role access.");
    } finally {
      setSaving(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Role Access unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to configure role access."
      />
    );
  }

  if (!accessLoading && !canConfigure) {
    return (
      <MorningAttendanceGate>
        <main className="modulePage" dir={dir}>
          <div className="moduleShell">
            <div className="moduleHeader">
              <div>
                <p className="moduleEyebrow">MADIBA SFA</p>
                <h1>{t("title")}</h1>
                <p className="moduleSubtitle">{t("denied")}</p>
              </div>
              <div className="moduleHeaderMeta">
                <AppLanguageSwitch language={language} setLanguage={setLanguage} />
                <Link href="/management" className="moduleBackLink">{t("back")}</Link>
              </div>
            </div>
          </div>
        </main>
      </MorningAttendanceGate>
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
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {!configured && !loading && (
            <p className="moduleHint">{t("defaultHint")}</p>
          )}

          {updatedAt && (
            <p className="moduleHint">
              {t("updated")}: {new Date(updatedAt).toLocaleString()}
              {updatedBy ? ` ${t("by")} ${updatedBy}` : ""}
            </p>
          )}

          <div className="moduleFilterRow" style={{ marginBottom: 12 }}>
            <button type="button" className="moduleInlineButton" onClick={resetDefaults} disabled={loading || saving}>
              {t("reset")}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={saveMatrix} disabled={loading || saving}>
              {saving ? t("saving") : t("save")}
            </button>
          </div>

          {loading || accessLoading ? (
            <p className="moduleHint">{t("loading")}</p>
          ) : (
            <ExportableTable filename="role-access" sheetName="Role Access" className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>{t("group")}</th>
                    <th>{t("page")}</th>
                    <th>{t("path")}</th>
                    {ACCESS_MATRIX_ROLES.map((role) => (
                      <th key={role}>{localizedRoleLabel(role, language)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {moduleRows.map((row) => (
                    <tr key={row.moduleKey}>
                      <td>{row.groupKey ? localizedNavGroupLabel(row.groupKey, language) : "—"}</td>
                      <td>{localizedModuleLabel(row.moduleKey, language)}</td>
                      <td><code>{row.href}</code></td>
                      {ACCESS_MATRIX_ROLES.map((role) => {
                        const locked = ROLE_ACCESS_LOCKED_ROLES.includes(role) && row.moduleKey === "roleAccess";
                        const checked = Boolean(matrix[role]?.[row.moduleKey]);
                        return (
                          <td key={`${row.moduleKey}-${role}`} style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked}
                              title={locked ? t("locked") : undefined}
                              aria-label={`${localizedModuleLabel(row.moduleKey, language)} — ${localizedRoleLabel(role, language)}`}
                              onChange={() => toggleCell(row.moduleKey, role)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ExportableTable>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
