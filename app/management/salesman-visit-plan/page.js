"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { usePopupMessages } from "../../hooks/usePopupMessages";

function planLabel(plan) {
  const name = String(plan?.salesmanName || "").trim();
  const code = String(plan?.salesmanCode || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "Unknown salesman";
}

const TEXT = {
  title: { en: "Salesman Visit Plan", ar: "خطة زيارات المندوب" },
  subtitle: {
    en: "Highest-probability stops for sales and collection, ranked per salesman.",
    ar: "أعلى توقفات احتمالاً للمبيعات والتحصيل، مرتبة لكل مندوب.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading saved visit plan...", ar: "جاري تحميل خطة الزيارة المحفوظة..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  salesman: { en: "Salesman", ar: "المندوب" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  visitsPerSalesman: { en: "Visits per salesman", ar: "زيارات لكل مندوب" },
  previewEmail: { en: "Send email now", ar: "إرسال البريد الآن" },
  rebuildSnapshot: { en: "Rebuild midnight snapshot", ar: "إعادة بناء لقطة منتصف الليل" },
  rebuilding: { en: "Rebuilding...", ar: "جاري إعادة البناء..." },
  rebuilt: { en: "Midnight snapshot rebuilt and saved.", ar: "تم إعادة بناء لقطة منتصف الليل وحفظها." },
  sending: { en: "Sending...", ar: "جاري الإرسال..." },
  accessDenied: {
    en: "You do not have access to salesman visit plans.",
    ar: "ليس لديك صلاحية لخطط زيارات المندوبين.",
  },
  previewBanner: {
    en: "Plans are built once at midnight KSA and saved. This page only shows the ready plan — it does not rebuild live.",
    ar: "تُبنى الخطط مرة عند منتصف الليل بتوقيت السعودية وتُحفظ. هذه الصفحة تعرض الخطة الجاهزة فقط — دون إعادة بناء مباشرة.",
  },
  builtAt: { en: "Built at", ar: "بُنيت في" },
  notReady: {
    en: "Tonight's visit plan is not ready yet. It is built automatically at midnight KSA.",
    ar: "خطة زيارة الليلة غير جاهزة بعد. تُبنى تلقائياً عند منتصف الليل بتوقيت السعودية.",
  },
  flags: { en: "Feature flags", ar: "أعلام الميزة" },
  salesmanAccess: { en: "Salesman page access", ar: "وصول صفحة المندوب" },
  emailEnabled: { en: "Visit-plan email", ar: "بريد خطة الزيارة" },
  sendToUsers: { en: "Send to salesmen", ar: "إرسال للمندوبين" },
  on: { en: "On", ar: "مفعل" },
  off: { en: "Off", ar: "متوقف" },
  noPlans: { en: "No visit plans for the selected salesman.", ar: "لا توجد خطط زيارة للمندوب المحدد." },
  rank: { en: "#", ar: "#" },
  customer: { en: "Customer", ar: "العميل" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  focus: { en: "Focus", ar: "التركيز" },
  combined: { en: "Combined", ar: "المشترك" },
  salesProb: { en: "Sales", ar: "المبيعات" },
  collectionProb: { en: "Collection", ar: "التحصيل" },
  recentSales: { en: "Recent 6M", ar: "آخر 6 أشهر" },
  due: { en: "Due", ar: "المستحق" },
  daysSinceInvoice: { en: "Days since invoice", ar: "أيام منذ الفاتورة" },
  total: { en: "Total", ar: "الإجمالي" },
  salesmen: { en: "Salesmen", ar: "المندوبون" },
  visits: { en: "Visits", ar: "الزيارات" },
  avgCombined: { en: "Avg combined", ar: "متوسط المشترك" },
  emailSent: { en: "Visit plan email sent.", ar: "تم إرسال بريد خطة الزيارة." },
  emailSkipped: {
    en: "Visit-plan email is paused. Set SALESMAN_VISIT_PLAN_EMAIL_ENABLED=true to resume.",
    ar: "بريد خطة الزيارة متوقف. عيّن SALESMAN_VISIT_PLAN_EMAIL_ENABLED=true لاستئنافه.",
  },
};

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatBuiltAt(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreClass(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "high") return "moduleBiMonthCell--up";
  if (normalized === "low") return "moduleBiMonthCell--down";
  if (normalized === "medium") return "moduleBiMonthCell--current";
  return "";
}

function focusClass(focus) {
  const normalized = String(focus || "").trim().toLowerCase();
  if (normalized === "both") return "moduleBiMonthCell--current";
  if (normalized === "collection") return "moduleBiMonthCell--down";
  return "moduleBiMonthCell--up";
}

export default function SalesmanVisitPlanPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const supabaseClient = getSupabaseClient();
  const isAdmin = String(access?.role || "").toLowerCase() === "admin";

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [allPlans, setAllPlans] = useState([]);
  const [accessMeta, setAccessMeta] = useState(null);
  const [salesmanFilter, setSalesmanFilter] = useState("");
  const [visitLimit, setVisitLimit] = useState("12");
  const [summary, setSummary] = useState({
    salesmanCount: 0,
    visitCount: 0,
    reportDate: "",
    builtAt: "",
    missingSnapshot: false,
  });

  usePopupMessages({ error, message });

  const canAccess = access.canAccess("salesmanVisitPlan");

  const loadPlans = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const params = new URLSearchParams({
        limit: String(Math.max(1, Math.min(50, Number(visitLimit) || 12))),
      });

      const { response, payload: data } = await fetchJsonWithTimeout(
        `/api/admin/salesman-visit-plan?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
        30000,
      );

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Unable to load visit plans.");
      }
      setAllPlans(data.plans || []);
      setAccessMeta(data.access || null);
      setSummary({
        salesmanCount: data.salesmanCount || 0,
        visitCount: data.visitCount || 0,
        reportDate: data.reportDate || "",
        builtAt: data.builtAt || "",
        missingSnapshot: Boolean(data.missingSnapshot),
      });
    } catch (err) {
      setAllPlans([]);
      setError(err.message || "Unable to load visit plans.");
    } finally {
      setLoading(false);
    }
  }, [visitLimit]);

  useEffect(() => {
    if (accessLoading) return;
    if (!canAccess) {
      setLoading(false);
      return;
    }
    loadPlans();
  }, [accessLoading, canAccess, loadPlans]);

  const salesmanOptions = useMemo(() => (
    [...allPlans]
      .map((plan) => ({
        code: plan.salesmanCode,
        label: planLabel(plan),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [allPlans]);

  const plans = useMemo(() => {
    if (!salesmanFilter) return allPlans;
    const code = String(salesmanFilter || "").trim().toUpperCase();
    return allPlans.filter((plan) => String(plan.salesmanCode || "").trim().toUpperCase() === code);
  }, [allPlans, salesmanFilter]);

  const totals = useMemo(() => plans.reduce((acc, plan) => {
    acc.dueAmount += Number(plan.totals?.dueAmount || 0);
    acc.recentSales += Number(plan.totals?.recentSales || 0);
    acc.visits += Number(plan.visitCount || 0);
    return acc;
  }, { dueAmount: 0, recentSales: 0, visits: 0 }), [plans]);

  async function sendPreviewEmail() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setSending(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload: data } = await fetchJsonWithTimeout(
        "/api/admin/salesman-visit-plan",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "email",
            salesman: salesmanFilter || undefined,
            limit: Math.max(1, Math.min(50, Number(visitLimit) || 12)),
            forcePreview: false,
          }),
        },
        120000,
      );

      if (data?.skipped && (data?.reason === "email_disabled_until_approved" || data?.reason === "email_disabled")) {
        setMessage(t("emailSkipped"));
        return;
      }
      if (!response.ok || (!data?.success && data?.failedCount)) {
        throw new Error(data?.error || "Preview email failed.");
      }
      if (data?.skipped) {
        setMessage(t("emailSkipped"));
        return;
      }
      setMessage(t("emailSent"));
    } catch (err) {
      setError(err.message || "Unable to send preview email.");
    } finally {
      setSending(false);
    }
  }

  async function rebuildSnapshot() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setRebuilding(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload: data } = await fetchJsonWithTimeout(
        "/api/admin/salesman-visit-plan",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "rebuild",
            limit: Math.max(1, Math.min(50, Number(visitLimit) || 12)),
          }),
        },
        120000,
      );

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Unable to rebuild visit plan snapshot.");
      }
      setMessage(t("rebuilt"));
      await loadPlans();
    } catch (err) {
      setError(err.message || "Unable to rebuild visit plan snapshot.");
    } finally {
      setRebuilding(false);
    }
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Visit plan unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      />
    );
  }

  if (!accessLoading && !canAccess) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleError">{t("accessDenied")}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <header className="moduleHeader">
          <div>
            <p className="moduleEyebrow">
              <Link href="/management">{t("back")}</Link>
            </p>
            <h1>{t("title")}</h1>
            <p className="moduleSubtitle">{t("subtitle")}</p>
          </div>
          <div className="moduleHeaderActions">
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
            <MostVisitedPages />
          </div>
        </header>

        <MorningAttendanceGate />

        <div className="moduleHint" role="status">
          {t("previewBanner")}
          {summary.builtAt ? (
            <>
              {" "}
              <strong>{t("builtAt")}:</strong> {formatBuiltAt(summary.builtAt)}
              {summary.reportDate ? ` (${summary.reportDate})` : ""}
            </>
          ) : null}
        </div>

        <section className="moduleFilterRow" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <label className="moduleField">
            <span>{t("salesman")}</span>
            <select
              className="moduleInput"
              value={salesmanFilter}
              onChange={(event) => setSalesmanFilter(event.target.value)}
            >
              <option value="">{t("allSalesmen")}</option>
              {salesmanOptions.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="moduleField">
            <span>{t("visitsPerSalesman")}</span>
            <input
              className="moduleInput"
              type="number"
              min="1"
              max="50"
              value={visitLimit}
              onChange={(event) => setVisitLimit(event.target.value)}
            />
          </label>
          <button type="button" className="moduleInlineButton" onClick={loadPlans} disabled={loading || rebuilding}>
            {loading ? t("loading") : t("refresh")}
          </button>
          {isAdmin ? (
            <>
              <button type="button" className="moduleInlineButton" onClick={sendPreviewEmail} disabled={sending || loading || rebuilding || summary.missingSnapshot}>
                {sending ? t("sending") : t("previewEmail")}
              </button>
              <button type="button" className="moduleInlineButton" onClick={rebuildSnapshot} disabled={rebuilding || loading}>
                {rebuilding ? t("rebuilding") : t("rebuildSnapshot")}
              </button>
            </>
          ) : null}
        </section>

        <section className="moduleMetricGrid">
          <article className="moduleMetricCard">
            <span>{t("salesmen")}</span>
            <strong>{salesmanFilter ? plans.length : summary.salesmanCount}</strong>
          </article>
          <article className="moduleMetricCard">
            <span>{t("visits")}</span>
            <strong>{totals.visits}</strong>
          </article>
          <article className="moduleMetricCard">
            <span>{t("due")}</span>
            <strong>{formatMoney(totals.dueAmount)}</strong>
          </article>
          <article className="moduleMetricCard">
            <span>{t("recentSales")}</span>
            <strong>{formatMoney(totals.recentSales)}</strong>
          </article>
        </section>

        {accessMeta ? (
          <section className="moduleSection" style={{ marginBottom: 12 }}>
            <h2>{t("flags")}</h2>
            <p className="moduleHint">
              {t("salesmanAccess")}: <strong>{accessMeta.salesmanAccessApproved ? t("on") : t("off")}</strong>
              {" · "}
              {t("emailEnabled")}: <strong>{accessMeta.emailEnabled ? t("on") : t("off")}</strong>
              {" · "}
              {t("sendToUsers")}: <strong>{accessMeta.sendToUsersEnabled ? t("on") : t("off")}</strong>
            </p>
          </section>
        ) : null}

        {loading ? <div className="moduleLoading">{t("loading")}</div> : null}

        {!loading && summary.missingSnapshot ? <div className="moduleHint">{t("notReady")}</div> : null}

        {!loading && !summary.missingSnapshot && plans.length === 0 ? <div className="moduleHint">{t("noPlans")}</div> : null}

        {!loading && plans.map((plan) => (
          <section key={plan.salesmanCode} className="moduleSection" style={{ marginTop: 16 }}>
            <div className="moduleSectionHeader">
              <h2>{planLabel(plan)}</h2>
              <span>
                {plan.visitCount} {t("visits").toLowerCase()}
                {" · "}
                {t("avgCombined")}: {plan.totals?.averageCombinedScore || 0}
                {" · "}
                {t("due")}: {formatMoney(plan.totals?.dueAmount)}
              </span>
            </div>
            <ExportableTable
              className="moduleTableWrap"
              filename={`visit-plan-${plan.salesmanCode || "salesman"}`}
            >
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <th>{t("rank")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("cityArea")}</th>
                    <th>{t("focus")}</th>
                    <th>{t("combined")}</th>
                    <th>{t("salesProb")}</th>
                    <th>{t("collectionProb")}</th>
                    <th>{t("recentSales")}</th>
                    <th>{t("due")}</th>
                    <th>{t("daysSinceInvoice")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan.visits || []).map((visit) => (
                    <tr key={`${plan.salesmanCode}-${visit.customer_code}`}>
                      <td>{visit.rank}</td>
                      <td>
                        <strong>{visit.customer_name || "-"}</strong>
                        <div className="moduleHint">{visit.customer_code}</div>
                      </td>
                      <td>{[visit.city, visit.area].filter(Boolean).join(" / ") || "-"}</td>
                      <td className={focusClass(visit.focus)}>{visit.focus}</td>
                      <td className={scoreClass(visit.combined_label)}>
                        {visit.combined_score} · {visit.combined_label}
                      </td>
                      <td className={scoreClass(visit.sales_label)}>
                        {visit.sales_score} · {visit.sales_label}
                      </td>
                      <td className={scoreClass(visit.collection_label)}>
                        {visit.collection_score} · {visit.collection_label}
                      </td>
                      <td>{formatMoney(visit.recent_sales_value)}</td>
                      <td>{formatMoney(visit.total_due_amount)}</td>
                      <td>{visit.days_since_last_invoice == null ? "-" : visit.days_since_last_invoice}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7} className="moduleBiTotalCol"><strong>{t("total")}</strong></td>
                    <td className="moduleBiTotalCol"><strong>{formatMoney(plan.totals?.recentSales)}</strong></td>
                    <td className="moduleBiTotalCol"><strong>{formatMoney(plan.totals?.dueAmount)}</strong></td>
                    <td className="moduleBiTotalCol" />
                  </tr>
                </tfoot>
              </table>
            </ExportableTable>
          </section>
        ))}
      </div>
    </main>
  );
}
