"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildPerformanceKpi,
  formatAchievementPercent,
  formatPerformanceKpiValue,
  PERFORMANCE_DISPLAY_KPI_KEYS,
} from "../../lib/performanceKpis";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { getKsaDateString } from "../../lib/workdayActivity";
import ExportableTable from "../../components/ExportableTable";

const TEXT = {
  title: { en: "KPI Targets", ar: "أهداف الأداء" },
  subtitle: {
    en: "Ach. % is actual vs the full month target. Expected pace is that salesman's own average share of monthly sales by this date over the last 6 months, or working days if he has no history.",
    ar: "نسبة الإنجاز هي الفعلي مقابل هدف الشهر. المسار المتوقع هو متوسط حصة المندوب نفسه من مبيعات الشهر حتى هذا التاريخ خلال آخر 6 أشهر، أو أيام العمل إن لم يوجد تاريخ.",
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
  totalSales: { en: "Total sales", ar: "إجمالي المبيعات" },
  collection: { en: "Collection", ar: "التحصيل" },
  newCustomers: { en: "New customers", ar: "عملاء جدد" },
  repeatCustomers: { en: "Repeat customers", ar: "عملاء متكررون" },
  actual: { en: "Actual", ar: "الفعلي" },
  achievement: { en: "Ach. %", ar: "الإنجاز" },
  ofTarget: { en: "of target", ar: "من الهدف" },
  expectedByToday: { en: "expected", ar: "المتوقع" },
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
    totalSales: String(snapshot.targets?.totalSales ?? 0),
    collection: String(snapshot.targets?.collection ?? 0),
    newCustomers: String(snapshot.targets?.newCustomers ?? 0),
    repeatCustomers: String(snapshot.targets?.repeatCustomers ?? 0),
    kpis: snapshot.kpis || [],
    paceShares: snapshot.paceShares || null,
    todayIso: snapshot.todayIso || null,
    reportDate: snapshot.reportDate || null,
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

  async function loadRows(nextMonth = month, { quiet = false } = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (!quiet) setLoading(true);
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
              targets: {
                officeSupplies: Number(row.officeSupplies || 0),
                otherSales: Number(row.otherSales || 0),
                totalSales: (Number(row.officeSupplies || 0) || 0) + (Number(row.otherSales || 0) || 0)
                  || Number(row.totalSales || 0),
                collection: Number(row.collection || 0),
                newCustomers: Number(row.newCustomers || 0),
                repeatCustomers: Number(row.repeatCustomers || 0),
              },
            })),
          }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save KPI targets.");
      }
      setMessage(t("saved"));
      await loadRows(month, { quiet: true });
    } catch (err) {
      setError(err.message || "Unable to save KPI targets.");
    } finally {
      setSaving(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  const columns = useMemo(() => PERFORMANCE_DISPLAY_KPI_KEYS, []);

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
            <ExportableTable filename={`kpi-targets-${month}`} sheetName="KPI Targets" className="moduleTableWrap">
              <table className="moduleTable moduleStackedHeaderTable moduleKpiTargetsTable">
                <thead>
                  <tr>
                    <th rowSpan={2}>{t("salesman")}</th>
                    {columns.map((key) => (
                      <th key={key} colSpan={3}>{t(key)}</th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map((key) => (
                      <FragmentHeader
                        key={key}
                        group={t(key)}
                        actual={t("actual")}
                        achievement={t("achievement")}
                      />
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
                        const isTotalSales = key === "totalSales";
                        const targetValue = isTotalSales
                          ? String(
                            (Number(row.officeSupplies || 0) || 0) + (Number(row.otherSales || 0) || 0)
                            || Number(row.totalSales || 0),
                          )
                          : row[key];
                        const liveKpi = buildPerformanceKpi(key, {
                          actual: kpi?.actual || 0,
                          target: Number(targetValue || 0),
                          reportDate: row.reportDate || `${month}-01`,
                          todayIso: row.todayIso || getKsaDateString(),
                          paceShares: row.paceShares,
                        });
                        const statusKey = liveKpi.status?.key || "no_target";
                        const expectedLabel = statusKey === "no_target" || liveKpi.expected == null
                          ? ""
                          : `${t("expectedByToday")} ${formatAchievementPercent(liveKpi.expected)}`;
                        return (
                          <KpiTargetCells
                            key={key}
                            actual={formatPerformanceKpiValue(key, kpi?.actual)}
                            achievement={formatAchievementPercent(liveKpi.achievement)}
                            ofTarget={t("ofTarget")}
                            status={liveKpi.status?.label || "No target"}
                            statusKey={statusKey}
                            expected={expectedLabel}
                            value={targetValue}
                            readOnly={isTotalSales}
                            onChange={(value) => {
                              setRows((current) => current.map((item, itemIndex) => {
                                if (itemIndex !== index) return item;
                                const next = { ...item, [key]: value };
                                next.totalSales = String(
                                  (Number(next.officeSupplies || 0) || 0) + (Number(next.otherSales || 0) || 0),
                                );
                                return next;
                              }));
                            }}
                          />
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

function FragmentHeader({ group, actual, achievement }) {
  return (
    <>
      <th data-column-filter-label={`${group} ${actual}`}>{actual}</th>
      <th data-column-filter-label={`${group} Target`}>Target</th>
      <th data-column-filter-label={`${group} ${achievement}`}>{achievement}</th>
    </>
  );
}

function kpiStatusClass(statusKey) {
  if (statusKey === "achieved") return "moduleKpiStatus--achieved";
  if (statusKey === "on_track" || statusKey === "on_pace" || statusKey === "ahead") {
    return "moduleKpiStatus--onTrack";
  }
  if (statusKey === "behind") return "moduleKpiStatus--behind";
  return "moduleKpiStatus--neutral";
}

function KpiTargetCells({
  actual,
  achievement,
  ofTarget,
  status,
  statusKey,
  expected,
  value,
  onChange,
  readOnly = false,
}) {
  return (
    <>
      <td>{actual}</td>
      <td>
        <input
          className="moduleInput moduleKpiTargetInput"
          type="number"
          min="0"
          step="1"
          size={8}
          inputMode="numeric"
          value={value}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      </td>
      <td className="moduleKpiAchCell">
        {statusKey === "no_target" ? (
          <span className={`moduleKpiStatus ${kpiStatusClass(statusKey)}`}>{status}</span>
        ) : (
          <>
            <strong className="moduleKpiAchDone">{achievement}</strong>
            <span className="moduleKpiAchHint">{ofTarget}</span>
            <span className={`moduleKpiStatus ${kpiStatusClass(statusKey)}`}>{status}</span>
            {expected ? <span className="moduleKpiAchExpected">{expected}</span> : null}
          </>
        )}
      </td>
    </>
  );
}
