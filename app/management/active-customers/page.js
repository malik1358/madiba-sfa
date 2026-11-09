"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { formatGrowthPercent, previousMonthKey } from "../../lib/categoryGrowth";
import { formatMoneyAmount } from "../../lib/regionalPricing";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Active Customers", ar: "العملاء النشطون" },
  subtitle: {
    en: "Customers who bought at least once in the last 120 days ending at each month-end, with matching active counts and net sales by company, salesman, and team.",
    ar: "العملاء الذين اشتروا مرة واحدة على الأقل خلال آخر 120 يوماً تنتهي بنهاية كل شهر، مع عدد النشطين وصافي المبيعات المتطابقين للشركة والمندوب والفريق.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  companyTrend: { en: "Company monthly trend", ar: "الاتجاه الشهري للشركة" },
  salesman: { en: "Salesman", ar: "المندوب" },
  team: { en: "Team", ar: "الفريق" },
  salesmen: { en: "Salesmen", ar: "المندوبون" },
  teams: { en: "Teams", ar: "الفرق" },
  current: { en: "Active now (120d)", ar: "نشط الآن (120 يوماً)" },
  days: { en: "days", ar: "يوماً" },
  lastComplete: { en: "Last complete month", ar: "آخر شهر مكتمل" },
  monthBefore: { en: "Month before", ar: "الشهر السابق" },
  mom: { en: "MoM", ar: "مقابل الشهر السابق" },
  change: { en: "Change", ar: "التغيّر" },
  sales: { en: "Sales", ar: "المبيعات" },
  total: { en: "Total", ar: "الإجمالي" },
  increasing: { en: "Increasing", ar: "في ارتفاع" },
  decreasing: { en: "Decreasing", ar: "في انخفاض" },
  flat: { en: "Flat", ar: "ثابت" },
  noRows: {
    en: "No purchases found in the active sales batch.",
    ar: "لا توجد مشتريات في دفعة المبيعات النشطة.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "For each month column, the as-of date is that month’s last day (today for the open month). Active customers and net sales both use the inclusive 120 days ending on that date, so the count and sales match. Credit notes do not count as activity but reduce sales. Green/red on month cells follows sales vs the previous month. Salesman figures use the invoice salesman; team figures are distinct customers and net sales across the team.",
    ar: "لكل عمود شهر، تاريخ القطع هو آخر يوم في ذلك الشهر (اليوم للشهر المفتوح). عدد العملاء النشطين وصافي المبيعات يستخدمان معاً آخر 120 يوماً شاملة حتى ذلك التاريخ، فيتطابق العدّ والمبيعات. إشعارات الدائن لا تُحتسب نشاطاً لكنها تخفّض المبيعات. الأخضر/الأحمر في خلايا الشهر يتبع المبيعات مقابل الشهر السابق. أرقام المندوب من مندوب الفاتورة؛ أرقام الفريق عملاء مميزون وصافي مبيعات عبر الفريق.",
  },
  window: { en: "Active window", ar: "نافذة النشاط" },
  asOf: { en: "As of", ar: "حتى" },
};

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-SA");
}

function formatSigned(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount === 0) return "0";
  const formatted = Math.abs(amount).toLocaleString("en-SA");
  return amount > 0 ? `+${formatted}` : `−${formatted}`;
}

function monthLabel(month, currentMonth) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  return month === currentMonth ? `${label} MTD` : label;
}

function periodCellClass(tone) {
  if (tone === "up") return "moduleBiMonthCell--up";
  if (tone === "down") return "moduleBiMonthCell--down";
  if (tone === "current") return "moduleBiMonthCell--current";
  return "";
}

function trendLabel(change, t) {
  if (change > 0) return t("increasing");
  if (change < 0) return t("decreasing");
  return t("flat");
}

function CountSalesCell({ count, sales }) {
  return (
    <div className="activeCustomersMetricCell">
      <strong>{formatCount(count)}</strong>
      <span>{formatMoneyAmount(sales)}</span>
    </div>
  );
}

function SeriesTable({
  filename,
  sheetName,
  labelHeader,
  rows,
  months,
  currentMonth,
  t,
  showTotal = false,
}) {
  const filterKeys = useMemo(
    () => [
      "label",
      "latestCompleteCount",
      "latestCompleteSales",
      "priorCompleteCount",
      "priorCompleteSales",
      "change",
      "momPercent",
      "currentCount",
      "currentSales",
      ...months.flatMap((month) => [month, `${month}:sales`]),
    ],
    [months],
  );

  const filterValueOf = useCallback((row, key) => {
    if (key === "label") return row.label || "";
    if (key === "latestCompleteCount") return formatCount(row.latestCompleteCount);
    if (key === "latestCompleteSales") return formatMoneyAmount(row.latestCompleteSales);
    if (key === "priorCompleteCount") return formatCount(row.priorCompleteCount);
    if (key === "priorCompleteSales") return formatMoneyAmount(row.priorCompleteSales);
    if (key === "change") return formatSigned(row.change);
    if (key === "momPercent") return formatGrowthPercent(row.momPercent);
    if (key === "currentCount") return formatCount(row.currentCount);
    if (key === "currentSales") return formatMoneyAmount(row.currentSales);
    if (key.endsWith(":sales")) {
      const month = key.slice(0, -":sales".length);
      return formatMoneyAmount(row.monthSales?.[month]);
    }
    if (months.includes(key)) return formatCount(row.monthValues?.[key]);
    return "";
  }, [months]);

  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, filterKeys, filterValueOf);

  const footerTotals = useMemo(() => {
    if (!showTotal) return null;
    const monthValues = Object.fromEntries(months.map((month) => [month, 0]));
    const monthSales = Object.fromEntries(months.map((month) => [month, 0]));
    let latestCompleteCount = 0;
    let priorCompleteCount = 0;
    let currentCount = 0;
    let latestCompleteSales = 0;
    let priorCompleteSales = 0;
    let currentSales = 0;
    visibleRows.forEach((row) => {
      latestCompleteCount += Number(row.latestCompleteCount || 0);
      priorCompleteCount += Number(row.priorCompleteCount || 0);
      currentCount += Number(row.currentCount || 0);
      latestCompleteSales += Number(row.latestCompleteSales || 0);
      priorCompleteSales += Number(row.priorCompleteSales || 0);
      currentSales += Number(row.currentSales || 0);
      months.forEach((month) => {
        monthValues[month] += Number(row.monthValues?.[month] || 0);
        monthSales[month] += Number(row.monthSales?.[month] || 0);
      });
    });
    return {
      latestCompleteCount,
      priorCompleteCount,
      currentCount,
      latestCompleteSales,
      priorCompleteSales,
      currentSales,
      change: latestCompleteCount - priorCompleteCount,
      monthValues,
      monthSales,
    };
  }, [months, showTotal, visibleRows]);

  if (!rows.length) {
    return <div className="moduleHint">{t("noRows")}</div>;
  }

  return (
    <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <BiExcelHead label={labelHeader} filterKey="label" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={`${t("lastComplete")} / ${t("sales")}`} filterKey="latestCompleteCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={`${t("monthBefore")} / ${t("sales")}`} filterKey="priorCompleteCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("change")} filterKey="change" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("mom")} filterKey="momPercent" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={`${t("current")} / ${t("sales")}`} filterKey="currentCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            {months.map((month) => (
              <BiExcelHead
                key={month}
                label={`${monthLabel(month, currentMonth)} / ${t("sales")}`}
                filterKey={month}
                options={options}
                filters={filters}
                onChange={setFilter}
                allLabel={t("all")}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.key || row.label}>
              <td>{row.label}</td>
              <td>
                <CountSalesCell count={row.latestCompleteCount} sales={row.latestCompleteSales} />
              </td>
              <td>
                <CountSalesCell count={row.priorCompleteCount} sales={row.priorCompleteSales} />
              </td>
              <td className={periodCellClass(row.change > 0 ? "up" : row.change < 0 ? "down" : "")}>
                {formatSigned(row.change)}
              </td>
              <td className={periodCellClass(row.momPercent > 0 ? "up" : row.momPercent < 0 ? "down" : "")}>
                {formatGrowthPercent(row.momPercent)}
              </td>
              <td className="moduleBiTotalCol moduleBiMonthCell--current">
                <CountSalesCell count={row.currentCount} sales={row.currentSales} />
              </td>
              {months.map((month, index) => {
                const previous = index > 0 ? months[index - 1] : previousMonthKey(month);
                const tone = row.monthSalesTones?.[month]
                  || (month === currentMonth
                    ? "current"
                    : (Number(row.monthSales?.[month] || 0) > Number(row.monthSales?.[previous] || 0)
                      ? "up"
                      : Number(row.monthSales?.[month] || 0) < Number(row.monthSales?.[previous] || 0)
                        ? "down"
                        : ""));
                return (
                  <td key={month} className={periodCellClass(tone)}>
                    <CountSalesCell
                      count={row.monthValues?.[month]}
                      sales={row.monthSales?.[month]}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {footerTotals ? (
          <tfoot>
            <tr>
              <td>{t("total")}</td>
              <td>
                <CountSalesCell count={footerTotals.latestCompleteCount} sales={footerTotals.latestCompleteSales} />
              </td>
              <td>
                <CountSalesCell count={footerTotals.priorCompleteCount} sales={footerTotals.priorCompleteSales} />
              </td>
              <td className={periodCellClass(footerTotals.change > 0 ? "up" : footerTotals.change < 0 ? "down" : "")}>
                {formatSigned(footerTotals.change)}
              </td>
              <td />
              <td className="moduleBiTotalCol moduleBiMonthCell--current">
                <CountSalesCell count={footerTotals.currentCount} sales={footerTotals.currentSales} />
              </td>
              {months.map((month) => (
                <td key={month}>
                  <CountSalesCell
                    count={footerTotals.monthValues[month]}
                    sales={footerTotals.monthSales[month]}
                  />
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </ExportableTable>
  );
}

export default function ActiveCustomersPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [report, setReport] = useState(null);
  const [view, setView] = useState("salesman");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase);
      const token = session?.access_token || "";
      if (!token) {
        setSignedOut(true);
        return;
      }
      setSignedOut(false);
      const response = await fetch("/api/active-customers", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load the report.");
      }
      setReport(payload);
    } catch (err) {
      setError(err.message || "Unable to load the report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const months = useMemo(() => (Array.isArray(report?.months) ? report.months : []), [report]);
  const companyRows = useMemo(
    () => (report?.company ? [report.company] : []),
    [report],
  );
  const salesmanRows = useMemo(
    () => (Array.isArray(report?.salesmanRows) ? report.salesmanRows : []),
    [report],
  );
  const teamRows = useMemo(
    () => (Array.isArray(report?.teamRows) ? report.teamRows : []),
    [report],
  );

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Active customers unavailable"
        message="Supabase credentials are required for this report."
      />
    );
  }

  if (signedOut || accessDenied) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <p className="moduleHint">{signedOut ? t("signIn") : t("accessDenied")}</p>
        </div>
      </main>
    );
  }

  const summary = report?.summary || {};
  const change = Number(summary.change || 0);

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
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("title")}</h2>
              <span>{formatCount(summary.currentActive)}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            <p className="moduleHint">
              {t("window")}: {report?.windowDays || 120} {t("days")}
              {" · "}
              {t("asOf")}: {report?.asOfDate || "—"}
              {" · "}
              {trendLabel(change, t)}: {formatSigned(change)} ({formatGrowthPercent(summary.momPercent)})
            </p>
            <p className="moduleHint">{t("hint")}</p>
            {error ? <p className="moduleHint">{error}</p> : null}

            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : !report?.months?.length ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <>
                <div className="moduleKpiGrid" style={{ marginBottom: "1rem" }}>
                  <div className="moduleKpiCard">
                    <div className="moduleKpiLabel">{t("current")}</div>
                    <div className="moduleKpiValue">{formatCount(summary.currentActive)}</div>
                    <div className="moduleKpiMeta">{formatMoneyAmount(summary.currentSales)} {t("sales")}</div>
                  </div>
                  <div className="moduleKpiCard">
                    <div className="moduleKpiLabel">{t("lastComplete")}</div>
                    <div className="moduleKpiValue">{formatCount(summary.latestCompleteActive)}</div>
                    <div className="moduleKpiMeta">{formatMoneyAmount(summary.latestCompleteSales)} {t("sales")}</div>
                  </div>
                  <div className="moduleKpiCard">
                    <div className="moduleKpiLabel">{t("monthBefore")}</div>
                    <div className="moduleKpiValue">{formatCount(summary.priorCompleteActive)}</div>
                    <div className="moduleKpiMeta">{formatMoneyAmount(summary.priorCompleteSales)} {t("sales")}</div>
                  </div>
                  <div className="moduleKpiCard">
                    <div className="moduleKpiLabel">{t("mom")}</div>
                    <div className={`moduleKpiValue ${change > 0 ? "moduleBiMonthCell--up" : change < 0 ? "moduleBiMonthCell--down" : ""}`}>
                      {formatSigned(change)} · {formatGrowthPercent(summary.momPercent)}
                    </div>
                    <div className={`moduleKpiMeta ${Number(summary.salesChange || 0) > 0 ? "moduleBiMonthCell--up" : Number(summary.salesChange || 0) < 0 ? "moduleBiMonthCell--down" : ""}`}>
                      {formatSigned(summary.salesChange)} · {formatGrowthPercent(summary.salesMomPercent)} {t("sales")}
                    </div>
                  </div>
                </div>

                <div className="moduleSectionHeader">
                  <h2>{t("companyTrend")}</h2>
                </div>
                <SeriesTable
                  filename="active-customers-company"
                  sheetName="Company"
                  labelHeader={t("companyTrend")}
                  rows={companyRows}
                  months={months}
                  currentMonth={report.currentMonth}
                  t={t}
                />

                <div className="moduleSectionHeader" style={{ marginTop: "1.5rem" }}>
                  <h2>{view === "team" ? t("teams") : t("salesmen")}</h2>
                  <div className="moduleHeaderMeta">
                    <button
                      type="button"
                      className={`moduleInlineButton${view === "salesman" ? " moduleInlineButton--active" : ""}`}
                      onClick={() => setView("salesman")}
                    >
                      {t("salesmen")}
                    </button>
                    <button
                      type="button"
                      className={`moduleInlineButton${view === "team" ? " moduleInlineButton--active" : ""}`}
                      onClick={() => setView("team")}
                    >
                      {t("teams")}
                    </button>
                  </div>
                </div>
                {view === "team" ? (
                  <SeriesTable
                    filename="active-customers-teams"
                    sheetName="Teams"
                    labelHeader={t("team")}
                    rows={teamRows}
                    months={months}
                    currentMonth={report.currentMonth}
                    t={t}
                  />
                ) : (
                  <SeriesTable
                    filename="active-customers-salesmen"
                    sheetName="Salesmen"
                    labelHeader={t("salesman")}
                    rows={salesmanRows}
                    months={months}
                    currentMonth={report.currentMonth}
                    t={t}
                  />
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
