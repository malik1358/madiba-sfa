"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MostVisitedPages from "../../components/MostVisitedPages";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  formatAchievementPercent,
  formatPerformanceKpiValue,
  PERFORMANCE_KPI_KEYS,
  performanceUpdatedStatusLabel,
  TEAM_PERFORMANCE_VIEW,
} from "../../lib/performanceKpis";
import { getKsaDateString } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "My Performance", ar: "أدائي" },
  subtitle: { en: "Office supplies, other sales, collection, and customer KPIs", ar: "مستلزمات المكتب والمبيعات الأخرى والتحصيل والعملاء" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading KPI dashboard...", ar: "جاري تحميل مؤشرات الأداء..." },
  actual: { en: "Actual", ar: "الفعلي" },
  target: { en: "Target", ar: "الهدف" },
  achievement: { en: "Achievement", ar: "الإنجاز" },
  updateTargets: { en: "Update KPI targets", ar: "تحديث أهداف الأداء" },
  view: { en: "View", ar: "العرض" },
  team: { en: "Team (consolidated)", ar: "الفريق (مجمع)" },
  teamMembers: { en: "Team members", ar: "أعضاء الفريق" },
  salesman: { en: "Salesman", ar: "المندوب" },
  noSalesman: {
    en: "Your profile needs a salesman code before personal KPIs can be calculated.",
    ar: "يلزم رمز مندوب في ملفك لحساب مؤشرات الأداء الشخصية.",
  },
  login: { en: "Go to login", ar: "تسجيل الدخول" },
};

const STATUS_LABELS = {
  achieved: { en: "Achieved", ar: "محقق" },
  on_track: { en: "On track", ar: "على المسار" },
  behind: { en: "Behind", ar: "متأخر" },
  no_target: { en: "No target", ar: "بدون هدف" },
};

const KPI_LABELS = {
  officeSupplies: { en: "Sales of office supplies", ar: "مبيعات مستلزمات المكتب" },
  otherSales: { en: "Others", ar: "أخرى" },
  collection: { en: "Collection", ar: "التحصيل" },
  newCustomers: { en: "New customers", ar: "عملاء جدد" },
  repeatCustomers: { en: "Repeat customers", ar: "عملاء متكررون" },
};

function statusClass(statusKey) {
  if (statusKey === "achieved") return "moduleKpiStatus--achieved";
  if (statusKey === "on_track") return "moduleKpiStatus--onTrack";
  if (statusKey === "behind") return "moduleKpiStatus--behind";
  return "moduleKpiStatus--neutral";
}

function kpiByKey(snapshot, key) {
  return (snapshot?.kpis || []).find((item) => item.key === key);
}

export default function MyPerformancePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canManageTargets, setCanManageTargets] = useState(false);
  const [canViewTeam, setCanViewTeam] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [members, setMembers] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [memberSnapshots, setMemberSnapshots] = useState([]);

  usePopupMessages({ error });

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const session = await resolveAuthSession(supabase);
        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const params = new URLSearchParams({ date: getKsaDateString() });
        if (selectedCode) params.set("salesmanCode", selectedCode);

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/performance?${params.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          60000,
        );
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load performance metrics.");
        }

        setCanManageTargets(Boolean(payload.canManageTargets));
        setCanViewTeam(Boolean(payload.canViewTeam));
        setMembers(payload.members || []);
        setSnapshot(payload.snapshot || null);
        setMemberSnapshots(payload.memberSnapshots || []);
        if (!selectedCode && payload.selectedCode) setSelectedCode(payload.selectedCode);
      } catch (err) {
        setError(err.message || "Unable to load performance metrics.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedCode]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Performance unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view KPI metrics."
      />
    );
  }

  if (loading && !snapshot) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  const kpis = snapshot?.kpis || [];
  const updatedLabel = snapshot ? performanceUpdatedStatusLabel(snapshot) : "";
  const showTeamTable = canViewTeam && memberSnapshots.length > 0;

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
            {canManageTargets ? (
              <Link href="/management/kpi-targets" className="moduleInlineButton">{t("updateTargets")}</Link>
            ) : null}
            <Link href="/" className="moduleBackLink">{t("dashboard")}</Link>
          </div>
        </div>

        {error && error.includes("login") ? (
          <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
            <Link href="/" className="moduleInlineButton">{t("login")}</Link>
          </div>
        ) : null}

        {canViewTeam ? (
          <label className="moduleField" style={{ maxWidth: 360, marginBottom: 14 }}>
            {t("view")}
            <select
              className="moduleInput"
              value={selectedCode || TEAM_PERFORMANCE_VIEW}
              onChange={(event) => setSelectedCode(event.target.value)}
            >
              <option value={TEAM_PERFORMANCE_VIEW}>{t("team")}</option>
              {members.map((member) => (
                <option key={member.salesmanCode} value={member.salesmanCode}>
                  {member.salesmanName} ({member.salesmanCode})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {updatedLabel ? (
          <p className="moduleKpiUpdatedStatus">{updatedLabel}</p>
        ) : null}

        {!snapshot?.salesmanCode ? (
          <p className="moduleSubtitle">{t("noSalesman")}</p>
        ) : null}

        {loading ? <div className="moduleLoading">{t("loading")}</div> : null}

        <div className="moduleMetricGrid moduleKpiGrid">
          {kpis.map((kpi) => {
            const statusKey = kpi.status?.key || "no_target";
            return (
              <section key={kpi.key} className={`moduleMetricCard moduleKpiCard ${statusClass(statusKey)}`}>
                <span>{KPI_LABELS[kpi.key]?.[language] || kpi.label}</span>
                <strong>{formatAchievementPercent(kpi.achievement)}</strong>
                <p className="moduleKpiMeta">
                  {t("actual")}: {formatPerformanceKpiValue(kpi.key, kpi.actual)}
                  {" · "}
                  {t("target")}: {kpi.target > 0 ? formatPerformanceKpiValue(kpi.key, kpi.target) : "—"}
                </p>
                <em className={`moduleKpiStatus ${statusClass(statusKey)}`}>
                  {STATUS_LABELS[statusKey]?.[language] || kpi.status?.label}
                </em>
              </section>
            );
          })}
        </div>

        {showTeamTable ? (
          <section className="moduleSection" style={{ marginTop: 20 }}>
            <h2 className="moduleSubtitle" style={{ marginBottom: 10 }}>{t("teamMembers")}</h2>
            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>{t("salesman")}</th>
                    {PERFORMANCE_KPI_KEYS.map((key) => (
                      <th key={key}>{KPI_LABELS[key]?.[language] || key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberSnapshots.map((member) => (
                    <tr
                      key={member.salesmanCode}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedCode(member.salesmanCode)}
                    >
                      <td>
                        <strong>{member.salesmanName || member.salesmanCode}</strong>
                        <div className="moduleKpiMeta">{member.salesmanCode}</div>
                      </td>
                      {PERFORMANCE_KPI_KEYS.map((key) => {
                        const kpi = kpiByKey(member, key);
                        return (
                          <td key={key}>
                            <div>{formatAchievementPercent(kpi?.achievement)}</div>
                            <div className="moduleKpiMeta">
                              {formatPerformanceKpiValue(key, kpi?.actual)}
                              {" / "}
                              {kpi?.target > 0 ? formatPerformanceKpiValue(key, kpi.target) : "—"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
    </MorningAttendanceGate>
  );
}
