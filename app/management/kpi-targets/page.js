"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { formatAchievementPercent, formatPerformanceKpiValue } from "../../lib/performanceKpis";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { getKsaDateString } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "KPI Targets", ar: "أهداف الأداء" },
  subtitle: {
    en: "Set monthly Office supplies, Others, Collection, New customers, and Repeat customers targets. Users see achievement % and status immediately.",
    ar: "حدد أهداف مستلزمات المكتب وغيرها والتحصيل والعملاء الجدد والمتكررين. يرى المستخدم نسبة الإنجاز والحالة فوراً.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  performance: { en: "My Performance", ar: "أدائي" },
  loading: { en: "Loading KPI targets...", ar: "جاري تحميل أهداف الأداء..." },
  month: { en: "Month", ar: "الشهر" },
  save: { en: "Save targets", ar: "حفظ الأهداف" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  salesman: { en: "Salesman", ar: "المندوب" },
  officeSupplies: { en: "Sales of office supplies", ar: "مبيعات مستلزمات المكتب" },
  otherSales: { en: "Others", ar: "أخرى" },
  collection: { en: "Collection", ar: "التحصيل" },
  newCustomers: { en: "New customers", ar: "عملاء جدد" },
  repeatCustomers: { en: "Repeat customers", ar: "عملاء متكررون" },
  actual: { en: "Actual", ar: "الفعلي" },
  achievement: { en: "Ach. %", ar: "الإنجاز" },
  status: { en: "Status", ar: "الحالة" },
  saved: { en: "KPI targets updated. Users and the daily mail will show the new status.", ar: "تم تحديث الأهداف. سيظهر للمستخدمين وفي البريد اليومي الحالة الجديدة." },
};

function monthInputValue(date) {
  return String(date || getKsaDateString()).slice(0, 7);
}

function emptyDraft(snapshot) {
  return {
    salesmanCode: snapshot.salesmanCode,
    salesmanName: snapshot.salesmanName,
    officeSupplies: String(snapshot.targets?.officeSupplies ?? 0),
    otherSales: String(snapshot.targets?.otherSales ?? 0),
    collection: String(snapshot.targets?.collection ?? 0),
    newCustomers: String(snapshot.targets?.newCustomers ?? 0),
    repeatCustomers: String(snapshot.targets?.repeatCustomers ?? 0),
    kpis: snapshot.kpis || [],
  };
}

export default function KpiTargetsPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [month, setMonth] = useState(() => monthInputValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);

  usePopupMessages({ message, error });

  async function loadRows(nextMonth = month) {
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
        `/api/admin/kpi-targets?month=${encodeURIComponent(nextMonth)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load KPI targets.");
      }
      setRows((payload.rows || []).map(emptyDraft));
    } catch (err) {
      setError(err.message || "Unable to load KPI targets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function saveTargets() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/kpi-targets",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            month,
            rows: rows.map((row) => ({
              salesmanCode: row.salesmanCode,
              office_supplies_sales_target: Number(row.officeSupplies || 0),
              other_sales_target: Number(row.otherSales || 0),
              collection_target: Number(row.collection || 0),
              new_customers_target: Number(row.newCustomers || 0),
              repeat_customers_target: Number(row.repeatCustomers || 0),
            })),
          }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save KPI targets.");
      }
      setMessage(t("saved"));
      await loadRows(month);
    } catch (err) {
      setError(err.message || "Unable to save KPI targets.");
    } finally {
      setSaving(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  const columns = useMemo(
    () => ["officeSupplies", "otherSales", "collection", "newCustomers", "repeatCustomers"],
    [],
  );

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="KPI targets unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to manage KPI targets."
      />
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
              <MostVisitedPages />
              <Link href="/management/my-performance" className="moduleInlineButton">{t("performance")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleFilterRow" style={{ gridTemplateColumns: "200px auto", alignItems: "end", marginBottom: "16px" }}>
            <label className="moduleField">
              {t("month")}
              <input
                className="moduleInput"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <button type="button" className="moduleInlineButton moduleActionButton" onClick={saveTargets} disabled={saving || loading}>
              {saving ? t("saving") : t("save")}
            </button>
          </div>

          {loading ? (
            <div className="moduleLoading">{t("loading")}</div>
          ) : (
            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>{t("salesman")}</th>
                    {columns.map((key) => (
                      <th key={key} colSpan={3}>{t(key)}</th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {columns.map((key) => (
                      <FragmentHeader key={key} actual={t("actual")} achievement={t("achievement")} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.salesmanCode}>
                      <td>
                        <strong>{row.salesmanName || row.salesmanCode}</strong>
                        <div className="moduleKpiMeta">{row.salesmanCode}</div>
                      </td>
                      {columns.map((key) => {
                        const kpi = (row.kpis || []).find((item) => item.key === key);
                        return (
                          <KpiTargetCells
                            key={key}
                            actual={formatPerformanceKpiValue(key, kpi?.actual)}
                            achievement={formatAchievementPercent(kpi?.achievement)}
                            status={kpi?.status?.label || "No target"}
                            value={row[key]}
                            onChange={(value) => {
                              setRows((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, [key]: value } : item
                              )));
                            }}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}

function FragmentHeader({ actual, achievement }) {
  return (
    <>
      <th>{actual}</th>
      <th>Target</th>
      <th>{achievement}</th>
    </>
  );
}

function KpiTargetCells({ actual, achievement, status, value, onChange }) {
  return (
    <>
      <td>{actual}</td>
      <td>
        <input
          className="moduleInput"
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </td>
      <td>
        <div>{achievement}</div>
        <div className="moduleKpiMeta">{status}</div>
      </td>
    </>
  );
}
