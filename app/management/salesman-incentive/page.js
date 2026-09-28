"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Salesman Incentive", ar: "حوافز المندوبين" },
  subtitle: {
    en: "Collection-speed incentive plus 0.5% on the sales increase over last month.",
    ar: "حافز سرعة التحصيل بالإضافة إلى 0.5% على الزيادة في المبيعات مقارنة بالشهر الماضي.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  reports: { en: "Business Intelligence", ar: "ذكاء الأعمال" },
  kpiTargets: { en: "KPI Targets", ar: "أهداف الأداء" },
  month: { en: "Month", ar: "الشهر" },
  salesman: { en: "Salesman", ar: "المندوب" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  loading: { en: "Calculating incentive...", ar: "جاري احتساب الحوافز..." },
  accessDenied: {
    en: "Only admin, manager, or a salesman viewing their own figures can open this screen.",
    ar: "هذه الشاشة متاحة فقط للأدمن أو المدير أو المندوب لعرض أرقامه.",
  },
  rules: {
    en: "Scheme: office supplies 0.25% when the invoice is collected within 35 days. Electronics 0.40% within 35 days and 0.20% within 60 days. Other categories 1% within 35 days and 0.5% within 60 days. Nothing after 60 days. Cash deals (RC / DC / JC invoice numbers) are excluded from the category rates and earn only 0.20%, and only when the cash is received within 3 days. Plus 0.5% on the amount this month's net sales exceed the salesman's best month ever. Every receipt dated in the selected month counts, no matter how old the invoice it settles: collections are matched to invoices by cash FIFO per customer over the full ledger, then split by category using the invoice's own item mix. The incentive base is the net (ex-VAT) value collected. TRENDYOL and NOON are ecom channels and are not shown.",
    ar: "النظام: القرطاسية 0.25% عند التحصيل خلال 35 يوماً. الإلكترونيات 0.40% خلال 35 يوماً و0.20% خلال 60 يوماً. الفئات الأخرى 1% خلال 35 يوماً و0.5% خلال 60 يوماً. لا يوجد حافز بعد 60 يوماً. الصفقات النقدية (RC / DC / JC) تستحق 0.20% فقط وإذا تم استلام النقد خلال 3 أيام. بالإضافة إلى 0.5% على ما تتجاوزه مبيعات هذا الشهر عن أفضل شهر للمندوب على الإطلاق. تُحتسب كل الإيصالات المؤرخة في الشهر المحدد مهما كان تاريخ الفاتورة. أساس الحافز هو الصافي بدون ضريبة. TRENDYOL وNOON قنوات إلكترونية ولا تُعرض.",
  },
  totalIncentive: { en: "Total incentive", ar: "إجمالي الحوافز" },
  collectionIncentive: { en: "Collection incentive", ar: "حافز التحصيل" },
  growthIncentive: { en: "Growth incentive", ar: "حافز النمو" },
  collected: { en: "Cash collected", ar: "المبلغ المحصل" },
  eligibleBase: { en: "Eligible base", ar: "الأساس المستحق" },
  lateBase: { en: "Late (no incentive)", ar: "متأخر (بدون حافز)" },
  salesmenCount: { en: "Salesmen", ar: "عدد المندوبين" },
  summary: { en: "Incentive by salesman", ar: "الحوافز حسب المندوب" },
  detail: { en: "Settled collections in this month", ar: "التحصيلات المسواة في هذا الشهر" },
  code: { en: "Code", ar: "الكود" },
  name: { en: "Name", ar: "الاسم" },
  tier: { en: "Tier", ar: "الشريحة" },
  cashDeal: { en: "Cash deal", ar: "صفقة نقدية" },
  yes: { en: "Yes", ar: "نعم" },
  thisMonthSales: { en: "This month sales", ar: "مبيعات هذا الشهر" },
  bestMonthSales: { en: "Best month ever", ar: "أفضل شهر على الإطلاق" },
  delta: { en: "Delta", ar: "الفرق" },
  customer: { en: "Customer", ar: "العميل" },
  invoice: { en: "Invoice", ar: "الفاتورة" },
  invoiceDate: { en: "Invoice date", ar: "تاريخ الفاتورة" },
  receiptDate: { en: "Receipt date", ar: "تاريخ الإيصال" },
  receiptNo: { en: "Receipt no.", ar: "رقم الإيصال" },
  days: { en: "Days", ar: "الأيام" },
  cashBase: { en: "Cash base", ar: "أساس النقدي" },
  officeBase: { en: "Office base", ar: "أساس القرطاسية" },
  electronicsBase: { en: "Electronics base", ar: "أساس الإلكترونيات" },
  otherBase: { en: "Other base", ar: "أساس الأخرى" },
  incentive: { en: "Incentive", ar: "الحافز" },
  total: { en: "Total", ar: "الإجمالي" },
  noRows: {
    en: "No settled collections for this month yet. Upload the Tally receipt register and the sales batch first.",
    ar: "لا توجد تحصيلات مسواة لهذا الشهر. قم برفع سجل إيصالات تالي ودفعة المبيعات أولاً.",
  },
  noSalesmen: { en: "No salesman qualified in this month.", ar: "لا يوجد مندوب مستحق في هذا الشهر." },
  detailLimit: { en: "Showing the largest 500 settled rows.", ar: "يتم عرض أكبر 500 صف مسوى." },
};

const DETAIL_ROW_LIMIT = 500;

// Kept in sync with INCENTIVE_TIER_LABELS in app/lib/salesmanIncentive.js.
const TIER_LABELS = {
  cashFast: { en: "Cash ≤3d", ar: "نقدي ≤3 أيام" },
  officeSuppliesFast: { en: "Office ≤35d", ar: "قرطاسية ≤35 يوم" },
  electronicsFast: { en: "Electronics ≤35d", ar: "إلكترونيات ≤35 يوم" },
  electronicsSlow: { en: "Electronics 36-60d", ar: "إلكترونيات 36-60 يوم" },
  otherFast: { en: "Other ≤35d", ar: "أخرى ≤35 يوم" },
  otherSlow: { en: "Other 36-60d", ar: "أخرى 36-60 يوم" },
  late: { en: "Late (no incentive)", ar: "متأخر (بدون حافز)" },
};

const FALLBACK_TIER_KEYS = Object.keys(TIER_LABELS);

function formatRate(rate) {
  const value = Number(rate || 0) * 100;
  if (!value) return "";
  return `${Number(value.toFixed(2))}%`;
}

function currentMonthKey() {
  return getKsaDateString().slice(0, 7);
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateDisplay(iso) {
  const text = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function deltaCellClass(value) {
  if (Number(value || 0) > 0) return "moduleBiMonthCell--up";
  if (Number(value || 0) < 0) return "moduleBiMonthCell--down";
  return "";
}

export default function SalesmanIncentivePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: loadingAccess } = useModuleAccess();
  const supabaseClient = getSupabaseClient();

  const [month, setMonth] = useState(() => currentMonthKey());
  const [salesman, setSalesman] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  usePopupMessages({ error });

  const canAccess = access.canAccess("salesmanIncentive");

  const salesmen = useMemo(
    () => (Array.isArray(report?.salesmen) ? report.salesmen : []),
    [report],
  );

  const detailRows = useMemo(() => {
    const rows = Array.isArray(report?.rows) ? report.rows : [];
    return [...rows]
      .sort((left, right) => Number(right.incentive || 0) - Number(left.incentive || 0))
      .slice(0, DETAIL_ROW_LIMIT);
  }, [report]);

  const loadReport = useCallback(async ({ cancelledRef } = {}) => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 12000);
      if (cancelledRef?.current) return;
      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const params = new URLSearchParams({ month });
      if (salesman) params.set("salesman", salesman);

      const { response, payload } = await fetchJsonWithTimeout(
        `/api/salesman-incentive?${params.toString()}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        120000,
      );

      if (cancelledRef?.current) return;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load the incentive report.");
      }
      setReport(payload);
    } catch (err) {
      if (cancelledRef?.current) return;
      const message = String(err.message || "");
      if (message === "SESSION_TIMEOUT") {
        setError("Session check timed out. Please refresh the page or login again.");
      } else {
        setError(message || "Unable to load the incentive report.");
      }
      setReport(null);
    } finally {
      if (!cancelledRef?.current) setLoading(false);
    }
  }, [month, salesman]);

  useEffect(() => {
    if (loadingAccess) return undefined;
    if (!canAccess) {
      setLoading(false);
      setReport(null);
      return undefined;
    }

    const cancelledRef = { current: false };
    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelledRef.current) return;
      setLoading(false);
      setError((current) => current || "Report load timed out. Please login and refresh the page.");
    });

    loadReport({ cancelledRef }).finally(() => {
      stopSafetyTimer();
    });

    return () => {
      cancelledRef.current = true;
      stopSafetyTimer();
    };
  }, [canAccess, loadingAccess, loadReport]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Salesman incentive unavailable"
        message="This report needs Supabase credentials."
      />
    );
  }

  if (!loadingAccess && !canAccess) {
    return (
      <MorningAttendanceGate requireMorningAttendance={false}>
        <main className="modulePage" dir={dir}>
          <div className="moduleShell">
            <div className="moduleHeader">
              <div>
                <p className="moduleEyebrow">MADIBA SFA</p>
                <h1>{t("title")}</h1>
              </div>
              <div className="moduleHeaderMeta">
                <AppLanguageSwitch language={language} setLanguage={setLanguage} />
                <Link href="/management" className="moduleBackLink">{t("back")}</Link>
              </div>
            </div>
            <div className="moduleHint">{t("accessDenied")}</div>
          </div>
        </main>
      </MorningAttendanceGate>
    );
  }

  const totals = report?.totals || {};
  const tierKeys = Array.isArray(report?.tierKeys) && report.tierKeys.length
    ? report.tierKeys
    : FALLBACK_TIER_KEYS;
  const tierLabel = (key) => (TIER_LABELS[key] ? TIER_LABELS[key][language] || TIER_LABELS[key].en : key);
  const summaryColumnCount = tierKeys.length + 7;

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
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
              <AccessibleHeaderLink moduleKey="businessDashboard" href="/management/business-dashboard" className="moduleBackLink">
                {t("reports")}
              </AccessibleHeaderLink>
              <AccessibleHeaderLink moduleKey="kpiTargets" href="/management/kpi-targets" className="moduleBackLink">
                {t("kpiTargets")}
              </AccessibleHeaderLink>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleHint">{t("rules")}</div>

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("month")}
                <input
                  className="moduleInput"
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value || currentMonthKey())}
                />
              </label>
              {report?.canViewAll ? (
                <label className="moduleField">
                  {t("salesman")}
                  <select
                    className="moduleInput"
                    value={salesman}
                    onChange={(event) => setSalesman(event.target.value)}
                  >
                    <option value="">{t("allSalesmen")}</option>
                    {(report?.salesmanOptions || []).map((option) => (
                      <option key={option.salesman_code} value={option.salesman_code}>
                        {option.salesman_code}
                        {option.salesman_name ? ` — ${option.salesman_name}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </section>

          {error && error.includes("login") ? (
            <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
              <Link href="/" className="moduleInlineButton">Go to login</Link>
            </div>
          ) : null}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              <div className="moduleMetricGrid moduleMetricGridCols6">
                <section className="moduleMetricCard">
                  <span>{t("totalIncentive")}</span>
                  <strong>{formatAmount(totals.total_incentive)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("collectionIncentive")}</span>
                  <strong>{formatAmount(totals.collection_incentive)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("growthIncentive")}</span>
                  <strong>{formatAmount(totals.growth_incentive)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("collected")}</span>
                  <strong>{formatAmount(totals.collected_amount)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("eligibleBase")}</span>
                  <strong>{formatAmount(totals.eligible_base)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("lateBase")}</span>
                  <strong>{formatAmount(totals.late_base)}</strong>
                </section>
              </div>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("summary")}</h2>
                  <span>{salesmen.length} {t("salesmenCount")}</span>
                </div>

                <ExportableTable
                  filename={`salesman-incentive-${report.month}`}
                  sheetName="Incentive by salesman"
                  className="moduleTableWrap"
                >
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th>{t("code")}</th>
                        <th>{t("name")}</th>
                        {tierKeys.map((key) => (
                          <th key={key}>
                            {tierLabel(key)}
                            {formatRate(report.rates?.[key]) ? (
                              <div className="moduleCode">{formatRate(report.rates?.[key])}</div>
                            ) : null}
                          </th>
                        ))}
                        <th>{t("collectionIncentive")}</th>
                        <th>{t("thisMonthSales")}</th>
                        <th>{t("bestMonthSales")}</th>
                        <th>{t("delta")}</th>
                        <th>{t("growthIncentive")}</th>
                        <th className="moduleBiTotalCol">{t("totalIncentive")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesmen.map((row) => (
                        <tr key={row.salesman_code}>
                          <td>{row.salesman_code}</td>
                          <td>{row.salesman_name || "-"}</td>
                          {tierKeys.map((key) => (
                            <td key={key}>
                              {formatAmount(row.tier_base?.[key])}
                              {key !== "late" ? (
                                <div className="moduleCode">
                                  {t("incentive")}: {formatAmount(row.tier_incentive?.[key])}
                                </div>
                              ) : null}
                            </td>
                          ))}
                          <td>{formatAmount(row.collection_incentive)}</td>
                          <td>{formatAmount(row.current_month_sales)}</td>
                          <td>
                            {formatAmount(row.peak_month_sales)}
                            {row.peak_month ? <div className="moduleCode">{row.peak_month}</div> : null}
                          </td>
                          <td className={deltaCellClass(row.sales_delta)}>{formatAmount(row.sales_delta)}</td>
                          <td>{formatAmount(row.growth_incentive)}</td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(row.total_incentive)}</strong></td>
                        </tr>
                      ))}
                      {salesmen.length === 0 && (
                        <tr>
                          <td colSpan={summaryColumnCount}>{t("noSalesmen")}</td>
                        </tr>
                      )}
                    </tbody>
                    {salesmen.length > 0 ? (
                      <tfoot>
                        <tr>
                          <td colSpan={2}><strong>{t("total")}</strong></td>
                          {tierKeys.map((key) => (
                            <td key={key}>
                              <strong>{formatAmount(totals.tier_base?.[key])}</strong>
                              {key !== "late" ? (
                                <div className="moduleCode">
                                  {t("incentive")}: {formatAmount(totals.tier_incentive?.[key])}
                                </div>
                              ) : null}
                            </td>
                          ))}
                          <td><strong>{formatAmount(totals.collection_incentive)}</strong></td>
                          <td><strong>{formatAmount(totals.current_month_sales)}</strong></td>
                          <td><strong>{formatAmount(totals.peak_month_sales)}</strong></td>
                          <td className={deltaCellClass(totals.sales_delta)}><strong>{formatAmount(totals.sales_delta)}</strong></td>
                          <td><strong>{formatAmount(totals.growth_incentive)}</strong></td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(totals.total_incentive)}</strong></td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("detail")}</h2>
                  <span>
                    {detailRows.length} / {report.rows?.length || 0}
                    {(report.rows?.length || 0) > DETAIL_ROW_LIMIT ? ` · ${t("detailLimit")}` : ""}
                  </span>
                </div>

                <ExportableTable
                  filename={`salesman-incentive-detail-${report.month}`}
                  sheetName="Settled collections"
                  className="moduleTableWrap"
                >
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th>{t("salesman")}</th>
                        <th>{t("customer")}</th>
                        <th>{t("invoice")}</th>
                        <th>{t("cashDeal")}</th>
                        <th>{t("invoiceDate")}</th>
                        <th>{t("receiptDate")}</th>
                        <th>{t("receiptNo")}</th>
                        <th>{t("days")}</th>
                        <th>{t("collected")}</th>
                        <th>{t("cashBase")}</th>
                        <th>{t("officeBase")}</th>
                        <th>{t("electronicsBase")}</th>
                        <th>{t("otherBase")}</th>
                        <th>{t("tier")}</th>
                        <th className="moduleBiTotalCol">{t("incentive")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, index) => (
                        <tr key={`${row.customer_code}-${row.voucher_number}-${row.receipt_date}-${index}`}>
                          <td>{row.salesman_code || "-"}</td>
                          <td>
                            {row.customer_name || row.customer_code}
                            <div className="moduleCode">{row.customer_code}</div>
                          </td>
                          <td>{row.voucher_number || "-"}</td>
                          <td>{row.is_cash ? t("yes") : "-"}</td>
                          <td>{formatDateDisplay(row.invoice_date)}</td>
                          <td>{formatDateDisplay(row.receipt_date)}</td>
                          <td>{row.vch_no || "-"}</td>
                          <td className={row.incentive > 0 ? "moduleBiMonthCell--up" : "moduleBiMonthCell--down"}>
                            {row.days}
                          </td>
                          <td>{formatAmount(row.collected_amount)}</td>
                          <td>{formatAmount(row.cash_base)}</td>
                          <td>{formatAmount(row.office_base)}</td>
                          <td>{formatAmount(row.electronics_base)}</td>
                          <td>{formatAmount(row.other_base)}</td>
                          <td>{tierLabel(row.primary_tier)}</td>
                          <td className="moduleBiTotalCol">{formatAmount(row.incentive)}</td>
                        </tr>
                      ))}
                      {detailRows.length === 0 && (
                        <tr>
                          <td colSpan={15}>{t("noRows")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ExportableTable>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
