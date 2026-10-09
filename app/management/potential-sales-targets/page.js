"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "Potential Sales Targets", ar: "أهداف المبيعات المحتملة" },
  subtitle: {
    en: "Active customers with recent-age outstanding and no recent invoice, with customer-level sales and visit follow-up.",
    ar: "العملاء النشطون ذوو المستحقات الحديثة دون فاتورة حديثة، مع المبيعات وزيارات المتابعة لكل عميل.",
  },
  hint: {
    en: "Targets have positive outstanding below SAR 15,000, all open invoices under 60 days, and no invoice in the last 15 days. Sales are net of credit notes and returns. The current month is month-to-date.",
    ar: "المستحقات أقل من 15,000 ريال وجميع الفواتير المفتوحة أقل من 60 يوماً، ولم تصدر فاتورة خلال آخر 15 يوماً. المبيعات صافية بعد خصم الإشعارات الدائنة والمرتجعات. الشهر الحالي حتى تاريخه.",
  },
  back: { en: "← Reports", ar: "← التقارير" },
  loading: { en: "Loading potential sales targets...", ar: "جاري تحميل أهداف المبيعات المحتملة..." },
  salesman: { en: "Salesman", ar: "مندوب المبيعات" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  customerCode: { en: "Customer Code", ar: "رمز العميل" },
  customer: { en: "Customer", ar: "العميل" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  lastVisitBySalesman: { en: "Last Visit by Salesman", ar: "آخر زيارة بواسطة المندوب" },
  lastOrderInvoice: { en: "Last Order / Invoice", ar: "آخر طلب / فاتورة" },
  outstanding: { en: "Outstanding", ar: "المستحق" },
  targets: { en: "Target customers", ar: "العملاء المستهدفون" },
  totalOutstanding: { en: "Total outstanding", ar: "إجمالي المستحقات" },
  noRows: { en: "No qualifying customers for this salesman.", ar: "لا يوجد عملاء مطابقون لهذا المندوب." },
  noSalesmen: { en: "No salesman targets are available.", ar: "لا توجد أهداف لمندوبي المبيعات." },
  unavailable: { en: "Unable to load potential sales targets.", ar: "تعذر تحميل أهداف المبيعات المحتملة." },
  loginAgain: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  monthToDate: { en: "MTD", ar: "من بداية الشهر" },
  refresh: { en: "Refresh", ar: "تحديث" },
};

function formatAmount(value, language) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString(language === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : "-";
}

function formatDate(value, language) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function monthLabel(monthKey, language, current) {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  const label = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return current ? `${label} (${language === "ar" ? TEXT.monthToDate.ar : TEXT.monthToDate.en})` : label;
}

export default function PotentialSalesTargetsPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const supabaseClient = getSupabaseClient();
  const [report, setReport] = useState(null);
  const [salesmanCode, setSalesmanCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const canAccess = access.canAccess("potentialSalesTargets");

  usePopupMessages({ error });

  useEffect(() => {
    if (accessLoading) return undefined;
    if (!canAccess) {
      setLoading(false);
      setReport(null);
      return undefined;
    }

    let cancelled = false;
    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (!cancelled) {
        setLoading(false);
        setError("Report load timed out. Please refresh the page.");
      }
    });

    async function loadReport() {
      setLoading(true);
      setError("");
      try {
        if (!supabaseClient) throw new Error("Supabase is unavailable.");
        const session = await resolveAuthSession(supabaseClient, 12000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error(t("loginAgain"));
        const params = new URLSearchParams();
        if (salesmanCode) params.set("salesmanCode", salesmanCode);
        const query = params.toString();
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/potential-sales-targets${query ? `?${query}` : ""}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          90000,
        );
        if (cancelled) return;
        if (!response.ok || !payload.success) throw new Error(payload.error || t("unavailable"));
        setReport(payload);
        if (payload.selectedSalesmanCode !== salesmanCode) setSalesmanCode(payload.selectedSalesmanCode || "");
      } catch (caught) {
        if (!cancelled) {
          setError(caught.message || t("unavailable"));
          setReport(null);
        }
      } finally {
        stopSafetyTimer();
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [accessLoading, canAccess, language, refreshKey, salesmanCode, supabaseClient]);

  const rows = report?.rows || [];
  const monthKeys = report?.monthKeys || [];
  const monthTotals = report?.summary?.monthlySales || {};
  const currentMonth = String(report?.asOfDate || "").slice(0, 7);

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
              <AccessibleHeaderLink moduleKey="dailyVisitReport" href="/management/daily-visit-report" className="moduleBackLink">
                {language === "ar" ? "تقرير الزيارات اليومية" : "Daily Visit Report"}
              </AccessibleHeaderLink>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <p className="moduleHint">{t("hint")}</p>

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("salesman")}
                <select
                  className="moduleInput"
                  value={salesmanCode}
                  onChange={(event) => setSalesmanCode(event.target.value)}
                  disabled={!report || loading}
                >
                  {report?.canViewAllSalesmen ? <option value="">{t("allSalesmen")}</option> : null}
                  {!report?.salesmanOptions?.length ? <option value="">{t("noSalesmen")}</option> : null}
                  {(report?.salesmanOptions || []).map((salesman) => (
                    <option key={salesman.code} value={salesman.code}>{salesman.name} ({salesman.code})</option>
                  ))}
                </select>
              </label>
              <div className="moduleActionRow" style={{ alignItems: "end" }}>
                <button type="button" className="moduleInlineButton" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>
                  {t("refresh")}
                </button>
              </div>
            </div>
          </section>

          {!canAccess && !accessLoading ? <div className="moduleError" role="status">{t("unavailable")}</div> : null}
          {error && error.includes("login") ? <div className="moduleActionRow"><Link href="/" className="moduleInlineButton">{t("loginAgain")}</Link></div> : null}
          {loading || accessLoading ? <div className="moduleLoading">{t("loading")}</div> : null}
          {!loading && !error && report ? (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard"><span>{t("targets")}</span><strong>{report.summary.customerCount}</strong></section>
                <section className="moduleMetricCard"><span>{t("totalOutstanding")}</span><strong>{formatAmount(report.summary.totalOutstanding, language)} SAR</strong></section>
              </div>
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("title")}</h2>
                  <span>{report.asOfDate} · {report.summary.customerCount}</span>
                </div>
                {!rows.length ? <p className="moduleHint">{t("noRows")}</p> : (
                  <ExportableTable
                    filename={`potential-sales-targets-${salesmanCode || "all"}`}
                    sheetName="Potential Targets"
                    className="moduleTableWrap"
                  >
                    <table className="moduleTable">
                      <thead>
                        <tr>
                          {report.showSalesmanColumn ? <th>{t("salesman")}</th> : null}
                          <th>{t("customerCode")}</th>
                          <th>{t("customer")}</th>
                          <th>{t("cityArea")}</th>
                          <th>{t("lastVisitBySalesman")}</th>
                          <th>{t("lastOrderInvoice")}</th>
                          <th>{t("outstanding")}</th>
                          {monthKeys.map((month) => (
                            <th key={month}>{monthLabel(month, language, month === currentMonth)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.customer_code}>
                            {report.showSalesmanColumn ? <td>{row.salesman_name || row.salesman_code || "-"}</td> : null}
                            <td>{row.customer_code}</td>
                            <td>{row.customer_name}</td>
                            <td>{[row.city, row.area].filter(Boolean).join(" / ") || "-"}</td>
                            <td>{formatDate(row.last_visit_date_by_salesman, language)}</td>
                            <td>{formatDate(row.last_order_invoice_date, language)}</td>
                            <td style={{ textAlign: "right", background: "#dcfce7", fontWeight: 700 }}>{formatAmount(row.total_outstanding, language)}</td>
                            {monthKeys.map((month, index) => (
                              <td key={month} className={month === currentMonth ? "moduleBiMonthCell--current" : ""} style={{ textAlign: "right" }}>
                                {formatAmount(row.sales_by_month?.[month], language)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={report.showSalesmanColumn ? 6 : 5} style={{ background: "#0f4c5c", color: "#ffffff", fontWeight: 700 }}>
                            {t("totalOutstanding")} · {rows.length}
                          </td>
                          <td style={{ background: "#0f4c5c", color: "#ffffff", fontWeight: 700, textAlign: "right" }}>
                            {formatAmount(report.summary.totalOutstanding, language)}
                          </td>
                          {monthKeys.map((month) => (
                            <td key={month} style={{ background: "#0f4c5c", color: "#ffffff", fontWeight: 700, textAlign: "right" }}>
                              {formatAmount(monthTotals[month], language)}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </ExportableTable>
                )}
              </section>
            </>
          ) : null}
          {!supabaseClient ? <SupabaseUnavailable /> : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
