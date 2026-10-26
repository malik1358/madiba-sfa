"use client";

import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { excelFilterCellText } from "../../lib/biExcelFilters";
import { averageMonthlyAttendance } from "../../lib/monthlyAttendanceReport";
import { formatWorkingHours, getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const FILTER_KEYS = ["date", "workingHours", "customerVisits", "collectionAmount", "orderAmount"];

const TEXT = {
  title: { en: "Monthly Attendance", ar: "الحضور الشهري" },
  subtitle: {
    en: "Your month of working hours, customer visits, collections, and orders",
    ar: "ساعات عملك وزيارات العملاء والتحصيل والطلبات خلال الشهر",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading monthly attendance...", ar: "جاري تحميل الحضور الشهري..." },
  month: { en: "Month", ar: "الشهر" },
  user: { en: "Salesman / collector", ar: "المندوب / المحصل" },
  accessDenied: {
    en: "Salesmen, collectors, and management can open this report.",
    ar: "يمكن للمندوبين والمحصلين والإدارة فتح هذا التقرير.",
  },
  noUsers: { en: "No salesman or collector is available.", ar: "لا يوجد مندوب أو محصل." },
  note: {
    en: "Working hours follow the Daily Visit Report: non-far customer stops from 08:00 KSA around lunch, excluding unlogged gaps longer than 2 hours. Customer visits are distinct customers with a visit, collection, or submitted order. Collection amount is money received. Order amount is submitted order value, once per order. A day with no login still appears.",
    ar: "ساعات العمل تتبع تقرير الزيارات اليومي: التوقفات القريبة من العميل من 08:00 بتوقيت السعودية حول الغداء، مع استبعاد الفجوات غير المسجلة الأطول من ساعتين. زيارات العملاء هي العملاء المختلفون الذين لديهم زيارة أو تحصيل أو طلب مُرسل. مبلغ التحصيل هو المبلغ المستلم. مبلغ الطلب هو قيمة الطلب المُرسل، مرة واحدة لكل طلب. يظهر اليوم حتى بدون تسجيل دخول.",
  },
  attendedDays: { en: "Days logged in", ar: "أيام تسجيل الدخول" },
  totalWorkingHours: { en: "Working hours", ar: "ساعات العمل" },
  totalVisits: { en: "Customer visits", ar: "زيارات العملاء" },
  totalCollection: { en: "Collection amount", ar: "مبلغ التحصيل" },
  totalOrders: { en: "Order amount", ar: "مبلغ الطلبات" },
  colDate: { en: "Date", ar: "التاريخ" },
  colWorkingHours: { en: "Working hours", ar: "ساعات العمل" },
  colVisits: { en: "Customer visits", ar: "زيارات العملاء" },
  colCollection: { en: "Collection amount", ar: "مبلغ التحصيل" },
  colOrder: { en: "Order amount", ar: "مبلغ الطلبات" },
  totalFooter: { en: "Total", ar: "الإجمالي" },
  averageFooter: { en: "Average", ar: "المتوسط" },
  all: { en: "All", ar: "الكل" },
  showing: { en: "Showing", ar: "يعرض" },
};

function currentMonth() {
  return getKsaDateString().slice(0, 7);
}

function formatReportDate(value) {
  const [year, month, day] = String(value || "").split("-");
  if (!year || !month || !day) return value || "-";
  return `${day}/${month}/${year}`;
}

function formatHours(minutes) {
  const label = formatWorkingHours(minutes);
  return !label || label === "-" ? "0h" : label;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function compareTone(current, previous) {
  if (previous == null) return "";
  const left = Number(current || 0);
  const right = Number(previous || 0);
  if (left > right) return "moduleBiMonthCell--up";
  if (left < right) return "moduleBiMonthCell--down";
  return "";
}

function filterValue(row, key) {
  if (key === "date") return formatReportDate(row.date);
  if (key === "workingHours") return row.workingHoursLabel || formatHours(row.workingHoursMinutes);
  if (key === "customerVisits") return excelFilterCellText(row.customerVisits || 0);
  if (key === "collectionAmount") return formatAmount(row.collectionAmount);
  if (key === "orderAmount") return formatAmount(row.orderAmount);
  return "";
}

export default function MonthlyAttendancePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const today = getKsaDateString();

  usePopupMessages({ error });

  const allowed = Boolean(access?.canAccess?.("monthlyAttendance"));
  const rows = useMemo(
    () => (Array.isArray(report?.rows) ? report.rows : []),
    [report],
  );
  const {
    filters,
    options,
    visibleRows,
    setFilter,
  } = useBiExcelFilters(rows, FILTER_KEYS, filterValue);

  const previousByDate = useMemo(() => {
    const map = new Map();
    rows.forEach((row, index) => {
      map.set(row.date, index > 0 ? rows[index - 1] : null);
    });
    return map;
  }, [rows]);

  const visibleTotals = useMemo(() => visibleRows.reduce((totals, row) => ({
    minutes: totals.minutes + Number(row.workingHoursMinutes || 0),
    visits: totals.visits + Number(row.customerVisits || 0),
    collection: totals.collection + Number(row.collectionAmount || 0),
    orders: totals.orders + Number(row.orderAmount || 0),
  }), { minutes: 0, visits: 0, collection: 0, orders: 0 }), [visibleRows]);

  const visibleAverage = useMemo(() => averageMonthlyAttendance({
    minutes: visibleTotals.minutes,
    visits: visibleTotals.visits,
    collection: visibleTotals.collection,
    orders: visibleTotals.orders,
  }, visibleRows.length), [visibleRows.length, visibleTotals]);

  useEffect(() => {
    if (accessLoading || !allowed) {
      if (!accessLoading) setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) => current || "Report load timed out. Please login and refresh the page.");
    });

    async function loadReport() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        stopSafetyTimer();
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error("Please login again.");

        const params = new URLSearchParams({ month });
        if (userId) params.set("userId", userId);
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/monthly-attendance?${params.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          60000,
        );
        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load monthly attendance.");
        }

        setReport(payload.report || null);
        setAvailableUsers(Array.isArray(payload.availableUsers) ? payload.availableUsers : []);
        if (!userId && payload.report?.user?.userId) setUserId(payload.report.user.userId);
        if (!payload.report && payload.error) setError(payload.error);
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        setError(message === "SESSION_TIMEOUT"
          ? "Session check timed out. Please refresh the page or login again."
          : (err.message || "Unable to load monthly attendance."));
        setReport(null);
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
  }, [accessLoading, allowed, month, userId]);

  if (!supabaseClient) return <SupabaseUnavailable />;

  const headProps = {
    options,
    filters,
    onChange: setFilter,
    allLabel: t("all"),
  };

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <header className="moduleHeader">
            <div>
              <AccessibleHeaderLink href="/management">{t("back")}</AccessibleHeaderLink>
              <h1>{t("title")}</h1>
              <p>
                {t("subtitle")}
                {report?.user?.userName ? ` — ${report.user.userName}` : ""}
              </p>
            </div>
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
          </header>

          {!accessLoading && !allowed ? <p>{t("accessDenied")}</p> : null}

          {allowed ? (
            <div className="moduleToolbar">
              <label>
                {t("month")}
                <input
                  type="month"
                  className="moduleInput"
                  value={month}
                  max={currentMonth()}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </label>
              {availableUsers.length > 0 ? (
                <label>
                  {t("user")}
                  <select
                    className="moduleInput"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  >
                    {availableUsers.map((user) => (
                      <option key={user.userId} value={user.userId}>{user.userName}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          {allowed ? <p className="moduleHint">{t("note")}</p> : null}
          {allowed && loading ? <p>{t("loading")}</p> : null}

          {allowed && !loading && report ? (
            <>
              <div className="moduleMetricGrid">
                <section className="moduleMetricCard">
                  <span>{t("attendedDays")}</span>
                  <strong>{report.totals?.attendedDays || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalWorkingHours")}</span>
                  <strong>{formatHours(report.totals?.totalWorkingMinutes)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalVisits")}</span>
                  <strong>{report.totals?.totalCustomerVisits || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalCollection")}</span>
                  <strong>{formatAmount(report.totals?.totalCollectionAmount)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("totalOrders")}</span>
                  <strong>{formatAmount(report.totals?.totalOrderAmount)}</strong>
                </section>
              </div>

              <section className="moduleSection">
                <p className="moduleHint">{t("showing")} {visibleRows.length} / {rows.length}</p>
                <ExportableTable
                  filename={`monthly-attendance-${month}${report.user?.salesmanCode ? `-${report.user.salesmanCode}` : ""}`}
                  sheetName="Monthly Attendance"
                  className="moduleTableWrap moduleBiTableWrap"
                >
                  <table className="moduleTable moduleBiTable monthlyAttendanceTable">
                    <thead>
                      <tr>
                        <BiExcelHead {...headProps} label={t("colDate")} filterKey="date" />
                        <BiExcelHead {...headProps} label={t("colWorkingHours")} filterKey="workingHours" className="moduleBiTotalCol" />
                        <BiExcelHead {...headProps} label={t("colVisits")} filterKey="customerVisits" />
                        <BiExcelHead {...headProps} label={t("colCollection")} filterKey="collectionAmount" />
                        <BiExcelHead {...headProps} label={t("colOrder")} filterKey="orderAmount" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const previous = previousByDate.get(row.date);
                        const dateClass = row.date === today ? "moduleBiMonthCell--current" : "";
                        return (
                          <tr key={row.date}>
                            <td className={dateClass}>{formatReportDate(row.date)}</td>
                            <td className={`moduleBiTotalCol ${compareTone(row.workingHoursMinutes, previous?.workingHoursMinutes)}`.trim()}>
                              {row.workingHoursLabel || formatHours(row.workingHoursMinutes)}
                            </td>
                            <td className={compareTone(row.customerVisits, previous?.customerVisits)}>
                              {row.customerVisits || 0}
                            </td>
                            <td className={compareTone(row.collectionAmount, previous?.collectionAmount)}>
                              {formatAmount(row.collectionAmount)}
                            </td>
                            <td className={compareTone(row.orderAmount, previous?.orderAmount)}>
                              {formatAmount(row.orderAmount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="moduleBiTotalRow">
                        <td><strong>{t("totalFooter")}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatHours(visibleTotals.minutes)}</strong></td>
                        <td><strong>{visibleTotals.visits}</strong></td>
                        <td><strong>{formatAmount(visibleTotals.collection)}</strong></td>
                        <td><strong>{formatAmount(visibleTotals.orders)}</strong></td>
                      </tr>
                      <tr className="moduleBiAverageRow">
                        <td><strong>{t("averageFooter")}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatHours(visibleAverage.workingMinutes)}</strong></td>
                        <td><strong>{visibleAverage.customerVisits.toFixed(1)}</strong></td>
                        <td><strong>{formatAmount(visibleAverage.collectionAmount)}</strong></td>
                        <td><strong>{formatAmount(visibleAverage.orderAmount)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>
            </>
          ) : null}
          {allowed && !loading && !report && !error ? <p>{t("noUsers")}</p> : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
