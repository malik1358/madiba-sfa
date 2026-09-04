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
  performanceUpdatedStatusLabel,
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

export default function MyPerformancePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canManageTargets, setCanManageTargets] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

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

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/performance?date=${encodeURIComponent(getKsaDateString())}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load performance metrics.");
        }

        setCanManageTargets(Boolean(payload.canManageTargets));
        setSnapshot(payload.snapshot || null);
      } catch (err) {
        setError(err.message || "Unable to load performance metrics.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Performance unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view KPI metrics."
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

  const kpis = snapshot?.kpis || [];
  const updatedLabel = snapshot ? performanceUpdatedStatusLabel(snapshot) : "";

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

        {updatedLabel ? (
          <p className="moduleKpiUpdatedStatus">{updatedLabel}</p>
        ) : null}

        {!snapshot?.salesmanCode ? (
          <p className="moduleSubtitle">{t("noSalesman")}</p>
        ) : null}

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
      </div>
    </main>
    </MorningAttendanceGate>
  );
}
