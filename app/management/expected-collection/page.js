"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import {
  groupExpectedCollectionRowsByCustomer,
  groupExpectedCollectionRowsBySalesman,
} from "../../lib/expectedCollectionReport.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Expected Collection", ar: "التحصيل المتوقع" },
  subtitle: {
    en: "Open invoices expected to pay by each month-end for the current KSA month and the next two (BM + Rest). Same rules as the KPI Collection expected-remaining estimate.",
    ar: "الفواتير المفتوحة المتوقع تحصيلها حتى نهاية كل شهر للشهر الحالي في السعودية والشهرين التاليين (مواد بناء + الباقي). نفس قواعد تقدير التحصيل المتوقع في مؤشرات الأداء.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: {
    en: "Building expected collection from outstanding, receipts, and sales history…",
    ar: "جاري بناء التحصيل المتوقع من المستحقات والإيصالات وسجل المبيعات…",
  },
  refresh: { en: "Refresh", ar: "تحديث" },
  expand: { en: "Expand", ar: "توسيع" },
  collapse: { en: "Collapse", ar: "طي" },
  expandAll: { en: "Expand all", ar: "توسيع الكل" },
  collapseAll: { en: "Collapse all", ar: "طي الكل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  unassigned: { en: "Unassigned", ar: "غير معيّن" },
  customer: { en: "Customer", ar: "العميل" },
  customerCode: { en: "Customer code", ar: "رمز العميل" },
  avgDays: { en: "Avg days used", ar: "متوسط الأيام المستخدم" },
  lifetime: { en: "Lifetime avg", ar: "متوسط العمر" },
  lastPaid: { en: "Last paid days", ar: "أيام آخر سداد" },
  lastReceipt: { en: "Last receipt", ar: "آخر إيصال" },
  invoice: { en: "Invoice", ar: "الفاتورة" },
  invoiceDate: { en: "Invoice date", ar: "تاريخ الفاتورة" },
  pending: { en: "Pending SAR", ar: "المتبقي (ر.س)" },
  amount: { en: "Expected SAR", ar: "المتوقع (ر.س)" },
  totalExpected: { en: "Total Expected SAR", ar: "إجمالي المتوقع (ر.س)" },
  daysToEnd: { en: "Days → month-end", ar: "أيام حتى نهاية الشهر" },
  approxPay: { en: "Approx pay", ar: "تقريبي للسداد" },
  bm: { en: "BM SAR", ar: "مواد بناء (ر.س)" },
  rest: { en: "Rest SAR", ar: "الباقي (ر.س)" },
  total: { en: "Total", ar: "الإجمالي" },
  customers: { en: "Customers", ar: "العملاء" },
  invoices: { en: "Invoices", ar: "الفواتير" },
  monthEnd: { en: "Month-end", ar: "نهاية الشهر" },
  asOf: { en: "As of", ar: "حتى" },
  horizon: { en: "3-month estimate", ar: "تقدير 3 أشهر" },
  month: { en: "Month", ar: "الشهر" },
  newInMonth: { en: "New in month", ar: "جديد في الشهر" },
  byMonthEnd: { en: "By month-end", ar: "حتى نهاية الشهر" },
  currentMonth: { en: "Current", ar: "الحالي" },
  detailFor: { en: "Detail for", ar: "التفاصيل لـ" },
  noRows: {
    en: "No open invoices are expected to pay in this month window under the current rule.",
    ar: "لا توجد فواتير مفتوحة متوقع سدادها في نافذة هذا الشهر حسب القاعدة الحالية.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "Summary shows each month’s new expected SAR and the cumulative amount by that month-end. Detail tabs list invoices newly expected in the selected month (current includes overdue still open). Grouped by salesman, then customer. Avg days = max(lifetime, last paid); no payment yet, avg >120, and legal-queue customers are excluded. Amount is BM + Rest share.",
    ar: "الملخص يعرض المتوقع الجديد لكل شهر والإجمالي التراكمي حتى نهايته. تبويبات التفاصيل تعرض الفواتير المتوقع سدادها جديداً في الشهر المختار (الشهر الحالي يشمل المتأخر المفتوح). مجمّع حسب المندوب ثم العميل. متوسط الأيام = أعلى قيمة بين العمر وآخر سداد؛ يُستبعد من لم يسدد أو تجاوز 120 يوماً والطابور القانوني. المبلغ حصة مواد البناء + الباقي.",
  },
};

const FILTER_KEYS = [
  "salesmanName",
  "customerName",
  "customerCode",
  "avgDays",
  "lifetimeAvg",
  "lastPaidInvoiceDays",
  "lastReceiptDate",
  "refNo",
  "invoiceDate",
  "pendingAmount",
  "daysToMonthEnd",
  "approxPayDate",
  "bmValue",
  "restValue",
  "amount",
];

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMaybe(value) {
  if (value == null || value === "") return "—";
  return String(value);
}

function monthLabel(monthKey) {
  const text = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return "—";
  const [year, month] = text.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(month) - 1]} ${year.slice(2)}`;
}

function cellValue(row, key) {
  if (key === "salesmanName") return row.salesmanName || row.salesmanCode || "";
  if (key === "customerName") return row.customerName || "";
  if (key === "customerCode") return row.customerCode || "";
  if (key === "avgDays") return row.avgDays == null ? "" : String(row.avgDays);
  if (key === "lifetimeAvg") return row.lifetimeAvg == null ? "" : String(row.lifetimeAvg);
  if (key === "lastPaidInvoiceDays") return row.lastPaidInvoiceDays == null ? "" : String(row.lastPaidInvoiceDays);
  if (key === "lastReceiptDate") return row.lastReceiptDate || "";
  if (key === "refNo") return row.refNo || "";
  if (key === "invoiceDate") return row.invoiceDate || "";
  if (key === "pendingAmount") return formatAmount(row.pendingAmount);
  if (key === "amount") return formatAmount(row.amount);
  if (key === "daysToMonthEnd") return row.daysToMonthEnd == null ? "" : String(row.daysToMonthEnd);
  if (key === "approxPayDate") return row.approxPayDate || "";
  if (key === "bmValue") return formatAmount(row.bmValue);
  if (key === "restValue") return formatAmount(row.restValue);
  return "";
}

export default function ExpectedCollectionPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [report, setReport] = useState(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());

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
      const response = await fetch("/api/expected-collection", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(
          response.status === 504 || /timeout|error occurred/i.test(raw)
            ? "Report timed out. Please refresh and try again."
            : "Unable to load the report.",
        );
      }
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to load the report.");
      }
      setReport(payload);
      const firstMonth = Array.isArray(payload?.months) && payload.months[0]
        ? payload.months[0].monthKey
        : String(payload?.monthEnd || "").slice(0, 7);
      setSelectedMonthKey(firstMonth || "");
      setExpandedKeys(new Set());
    } catch (err) {
      setError(err.message || "Unable to load the report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const months = useMemo(
    () => (Array.isArray(report?.months) ? report.months : []),
    [report],
  );
  const horizonRows = useMemo(() => {
    if (months.length) {
      return months.map((month) => ({
        monthKey: month.monthKey,
        monthLabel: `${monthLabel(month.monthKey)}${month.isCurrent ? ` (${t("currentMonth")})` : ""}`,
        monthEnd: month.monthEnd || "",
        customerCount: month.customerCount ?? 0,
        invoiceCount: month.invoiceCount ?? 0,
        bmTotal: month.bmTotal || 0,
        restTotal: month.restTotal || 0,
        total: month.total || 0,
        cumulativeTotal: month.cumulativeTotal ?? month.total ?? 0,
        isCurrent: Boolean(month.isCurrent),
      }));
    }
    if (!report) return [];
    const key = String(report.monthEnd || "").slice(0, 7);
    return [{
      monthKey: key,
      monthLabel: `${monthLabel(key)} (${t("currentMonth")})`,
      monthEnd: report.monthEnd || "",
      customerCount: report.customerCount || 0,
      invoiceCount: report.invoiceCount || 0,
      bmTotal: report.bmTotal || 0,
      restTotal: report.restTotal || 0,
      total: report.total || 0,
      cumulativeTotal: report.total || 0,
      isCurrent: true,
    }];
  }, [months, report, t]);
  const horizonFilterValueOf = useCallback((row, key) => {
    if (key === "monthLabel") return row.monthLabel || "";
    if (key === "monthEnd") return row.monthEnd || "";
    if (key === "customerCount") return String(row.customerCount ?? "");
    if (key === "invoiceCount") return String(row.invoiceCount ?? "");
    if (key === "bmTotal") return formatAmount(row.bmTotal);
    if (key === "restTotal") return formatAmount(row.restTotal);
    if (key === "total") return formatAmount(row.total);
    if (key === "cumulativeTotal") return formatAmount(row.cumulativeTotal);
    return "";
  }, []);
  const {
    filters: horizonFilters,
    options: horizonOptions,
    visibleRows: visibleHorizonRows,
    setFilter: setHorizonFilter,
  } = useBiExcelFilters(
    horizonRows,
    ["monthLabel", "monthEnd", "customerCount", "invoiceCount", "bmTotal", "restTotal", "total", "cumulativeTotal"],
    horizonFilterValueOf,
  );
  const activeMonth = useMemo(() => {
    if (!months.length) {
      return {
        monthKey: selectedMonthKey || String(report?.monthEnd || "").slice(0, 7),
        monthEnd: report?.monthEnd || "",
        rows: Array.isArray(report?.rows) ? report.rows : [],
        total: report?.total || 0,
        bmTotal: report?.bmTotal || 0,
        restTotal: report?.restTotal || 0,
        customerCount: report?.customerCount || 0,
        invoiceCount: report?.invoiceCount || 0,
        isCurrent: true,
      };
    }
    return months.find((month) => month.monthKey === selectedMonthKey) || months[0];
  }, [months, selectedMonthKey, report]);

  const rows = useMemo(
    () => (Array.isArray(activeMonth?.rows) ? activeMonth.rows : []),
    [activeMonth],
  );
  const filterValueOf = useCallback((row, key) => cellValue(row, key), []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, filterValueOf);
  const salesmanGroups = useMemo(
    () => groupExpectedCollectionRowsBySalesman(visibleRows).map((group) => ({
      ...group,
      salesmanName: group.key === "__UNASSIGNED__" ? t("unassigned") : group.salesmanName,
      customers: groupExpectedCollectionRowsByCustomer(group.rows),
    })),
    [visibleRows, t],
  );
  const totals = useMemo(() => visibleRows.reduce((sum, row) => ({
    pendingAmount: sum.pendingAmount + Number(row.pendingAmount || 0),
    amount: sum.amount + Number(row.amount || 0),
    bmValue: sum.bmValue + Number(row.bmValue || 0),
    restValue: sum.restValue + Number(row.restValue || 0),
  }), {
    pendingAmount: 0,
    amount: 0,
    bmValue: 0,
    restValue: 0,
  }), [visibleRows]);

  const horizonTotals = useMemo(() => {
    if (!months.length) {
      return {
        total: Number(report?.total || 0),
        bmTotal: Number(report?.bmTotal || 0),
        restTotal: Number(report?.restTotal || 0),
        customerCount: Number(report?.customerCount || 0),
        invoiceCount: Number(report?.invoiceCount || 0),
      };
    }
    const last = months[months.length - 1];
    return {
      total: Number(last?.cumulativeTotal || 0),
      bmTotal: Number(last?.cumulativeBmTotal || 0),
      restTotal: Number(last?.cumulativeRestTotal || 0),
      customerCount: Number(last?.cumulativeCustomerCount || 0),
      invoiceCount: Number(last?.cumulativeInvoiceCount || 0),
    };
  }, [months, report]);

  const toggleGroup = useCallback((key) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set();
    salesmanGroups.forEach((group) => {
      next.add(group.key);
      (group.customers || []).forEach((customer) => {
        if (customer.invoiceCount > 1) {
          next.add(`c:${group.key}:${customer.key}`);
        }
      });
    });
    setExpandedKeys(next);
  }, [salesmanGroups]);

  const collapseAll = useCallback(() => {
    setExpandedKeys(new Set());
  }, []);

  const selectMonth = useCallback((monthKey) => {
    setSelectedMonthKey(monthKey);
    setExpandedKeys(new Set());
  }, []);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Expected collection unavailable"
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
              <h2>{t("horizon")}</h2>
              <span>{months.length || 1}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            <p className="moduleHint">
              {t("asOf")}: {report?.asOf || "—"}
              {" · "}
              {t("totalExpected")}: {formatAmount(horizonTotals.total)}
              {" · "}
              BM: {formatAmount(horizonTotals.bmTotal)}
              {" · "}
              Rest: {formatAmount(horizonTotals.restTotal)}
              {" · "}
              {t("customers")}: {horizonTotals.customerCount}
              {" · "}
              {t("invoices")}: {horizonTotals.invoiceCount}
            </p>
            <p className="moduleHint">{t("hint")}</p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : (
              <ExportableTable
                filename="expected-collection-horizon"
                tableId="expected-collection-horizon"
                sheetName="3-month estimate"
                className="moduleTableWrap moduleBiTableWrap"
              >
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("month")} filterKey="monthLabel" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("monthEnd")} filterKey="monthEnd" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("customers")} filterKey="customerCount" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("invoices")} filterKey="invoiceCount" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("bm")} filterKey="bmTotal" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("rest")} filterKey="restTotal" options={horizonOptions} filters={horizonFilters} onChange={setHorizonFilter} allLabel={t("all")} />
                      <BiExcelHead
                        label={t("newInMonth")}
                        filterKey="total"
                        options={horizonOptions}
                        filters={horizonFilters}
                        onChange={setHorizonFilter}
                        allLabel={t("all")}
                        className="moduleBiTotalCol"
                        summary={formatAmount(horizonTotals.total)}
                      />
                      <BiExcelHead
                        label={t("byMonthEnd")}
                        filterKey="cumulativeTotal"
                        options={horizonOptions}
                        filters={horizonFilters}
                        onChange={setHorizonFilter}
                        allLabel={t("all")}
                        className="moduleBiTotalCol"
                        summary={formatAmount(horizonTotals.total)}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHorizonRows.map((month, index) => {
                      const active = month.monthKey === activeMonth?.monthKey;
                      return (
                        <tr
                          key={month.monthKey || month.monthEnd || index}
                          className={active ? "moduleBiMonthCell--current" : undefined}
                        >
                          <td>
                            <button
                              type="button"
                              className="moduleInlineButton"
                              onClick={() => selectMonth(month.monthKey)}
                            >
                              {monthLabel(month.monthKey)}
                              {month.isCurrent ? ` (${t("currentMonth")})` : ""}
                            </button>
                          </td>
                          <td>{month.monthEnd || "—"}</td>
                          <td>{month.customerCount ?? 0}</td>
                          <td>{month.invoiceCount ?? 0}</td>
                          <td>{formatAmount(month.bmTotal)}</td>
                          <td>{formatAmount(month.restTotal)}</td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(month.total)}</strong></td>
                          <td className="moduleBiTotalCol">
                            <strong>{formatAmount(month.cumulativeTotal ?? month.total)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="moduleBiTotalRow">
                      <td colSpan={4}><strong>{t("total")}</strong></td>
                      <td><strong>{formatAmount(horizonTotals.bmTotal)}</strong></td>
                      <td><strong>{formatAmount(horizonTotals.restTotal)}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{formatAmount(horizonTotals.total)}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{formatAmount(horizonTotals.total)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </ExportableTable>
            )}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("detailFor")}: {monthLabel(activeMonth?.monthKey)}</h2>
              <span>{visibleRows.length}</span>
              {months.map((month) => (
                <button
                  key={`tab:${month.monthKey}`}
                  type="button"
                  className="moduleInlineButton"
                  aria-pressed={month.monthKey === activeMonth?.monthKey}
                  onClick={() => selectMonth(month.monthKey)}
                >
                  {monthLabel(month.monthKey)}
                  {month.isCurrent ? ` (${t("currentMonth")})` : ""}
                </button>
              ))}
              <button type="button" className="moduleInlineButton" onClick={expandAll}>{t("expandAll")}</button>
              <button type="button" className="moduleInlineButton" onClick={collapseAll}>{t("collapseAll")}</button>
            </div>
            <p className="moduleHint">
              {t("monthEnd")}: {activeMonth?.monthEnd || "—"}
              {" · "}
              {t("customers")}: {activeMonth?.customerCount ?? 0}
              {" · "}
              {t("invoices")}: {activeMonth?.invoiceCount ?? 0}
              {" · "}
              {t("salesman")}: {salesmanGroups.length}
              {" · "}
              BM: {formatAmount(totals.bmValue)}
              {" · "}
              Rest: {formatAmount(totals.restValue)}
              {" · "}
              {t("totalExpected")}: {formatAmount(totals.amount)}
            </p>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable
                filename={`expected-collection-${activeMonth?.monthKey || "month"}`}
                tableId="expected-collection"
                sheetName={`Expected ${monthLabel(activeMonth?.monthKey)}`}
                className="moduleTableWrap moduleBiTableWrap"
              >
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <th aria-label={t("expand")} />
                      <BiExcelHead label={t("salesman")} filterKey="salesmanName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("customerCode")} filterKey="customerCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("customer")} filterKey="customerName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("avgDays")} filterKey="avgDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lifetime")} filterKey="lifetimeAvg" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lastPaid")} filterKey="lastPaidInvoiceDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lastReceipt")} filterKey="lastReceiptDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("invoice")} filterKey="refNo" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("invoiceDate")} filterKey="invoiceDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("pending")} filterKey="pendingAmount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("daysToEnd")} filterKey="daysToMonthEnd" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("approxPay")} filterKey="approxPayDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("bm")} filterKey="bmValue" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("rest")} filterKey="restValue" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead
                        label={t("totalExpected")}
                        filterKey="amount"
                        options={options}
                        filters={filters}
                        onChange={setFilter}
                        allLabel={t("all")}
                        className="moduleBiTotalCol"
                        summary={formatAmount(totals.amount)}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {salesmanGroups.flatMap((group) => {
                      const expanded = expandedKeys.has(group.key);
                      const summary = (
                        <tr key={`s:${group.key}`} className="expectedCollectionSalesmanRow">
                          <td>
                            <button
                              type="button"
                              className="stockTakeReportExpandBtn"
                              aria-expanded={expanded}
                              aria-label={expanded ? t("collapse") : t("expand")}
                              onClick={() => toggleGroup(group.key)}
                            >
                              {expanded ? "−" : "+"}
                            </button>
                          </td>
                          <td>
                            <strong>{group.salesmanName}</strong>
                            {group.salesmanCode ? <div className="moduleCode">{group.salesmanCode}</div> : null}
                            <div className="moduleCode">
                              {group.invoiceCount} {t("invoices").toLowerCase()}
                              {" · "}
                              {group.customerCount} {t("customers").toLowerCase()}
                            </div>
                          </td>
                          <td colSpan={8} />
                          <td><strong>{formatAmount(group.pendingAmount)}</strong></td>
                          <td colSpan={2} />
                          <td><strong>{formatAmount(group.bmValue)}</strong></td>
                          <td><strong>{formatAmount(group.restValue)}</strong></td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(group.amount)}</strong></td>
                        </tr>
                      );
                      if (!expanded) return [summary];
                      const customerRows = (group.customers || []).flatMap((customer) => {
                        const customerKey = `c:${group.key}:${customer.key}`;
                        const multi = customer.invoiceCount > 1;
                        const customerExpanded = multi && expandedKeys.has(customerKey);
                        const single = !multi ? customer.rows[0] : null;
                        const customerSummary = (
                          <tr key={customerKey} className="expectedCollectionCustomerRow">
                            <td>
                              {multi ? (
                                <button
                                  type="button"
                                  className="stockTakeReportExpandBtn"
                                  aria-expanded={customerExpanded}
                                  aria-label={customerExpanded ? t("collapse") : t("expand")}
                                  onClick={() => toggleGroup(customerKey)}
                                >
                                  {customerExpanded ? "−" : "+"}
                                </button>
                              ) : null}
                            </td>
                            <td>{customer.salesmanName || customer.salesmanCode || t("unassigned")}</td>
                            <td>{customer.customerCode || "—"}</td>
                            <td>
                              <strong>{customer.customerName || "—"}</strong>
                              {multi ? (
                                <div className="moduleCode">
                                  {customer.invoiceCount} {t("invoices").toLowerCase()}
                                </div>
                              ) : null}
                            </td>
                            <td>{formatMaybe(customer.avgDays)}</td>
                            <td>{formatMaybe(customer.lifetimeAvg)}</td>
                            <td>{formatMaybe(customer.lastPaidInvoiceDays)}</td>
                            <td>{formatMaybe(customer.lastReceiptDate)}</td>
                            <td>{single ? (single.refNo || "—") : "—"}</td>
                            <td>{single ? (single.invoiceDate || "—") : "—"}</td>
                            <td><strong>{formatAmount(customer.pendingAmount)}</strong></td>
                            <td>{single ? formatMaybe(single.daysToMonthEnd) : "—"}</td>
                            <td>{single ? formatMaybe(single.approxPayDate) : "—"}</td>
                            <td><strong>{formatAmount(customer.bmValue)}</strong></td>
                            <td><strong>{formatAmount(customer.restValue)}</strong></td>
                            <td className="moduleBiTotalCol"><strong>{formatAmount(customer.amount)}</strong></td>
                          </tr>
                        );
                        if (!multi || !customerExpanded) return [customerSummary];
                        return [
                          customerSummary,
                          ...customer.rows.map((row) => (
                            <tr
                              key={`${customerKey}:${row.refNo}:${row.invoiceDate}:${row.amount}`}
                              className="expectedCollectionDetailRow"
                            >
                              <td />
                              <td>{row.salesmanName || row.salesmanCode || t("unassigned")}</td>
                              <td>{row.customerCode}</td>
                              <td>{row.customerName || "—"}</td>
                              <td>{formatMaybe(row.avgDays)}</td>
                              <td>{formatMaybe(row.lifetimeAvg)}</td>
                              <td>{formatMaybe(row.lastPaidInvoiceDays)}</td>
                              <td>{formatMaybe(row.lastReceiptDate)}</td>
                              <td>{row.refNo || "—"}</td>
                              <td>{row.invoiceDate || "—"}</td>
                              <td>{formatAmount(row.pendingAmount)}</td>
                              <td>{formatMaybe(row.daysToMonthEnd)}</td>
                              <td>{formatMaybe(row.approxPayDate)}</td>
                              <td>{formatAmount(row.bmValue)}</td>
                              <td>{formatAmount(row.restValue)}</td>
                              <td className="moduleBiTotalCol">{formatAmount(row.amount)}</td>
                            </tr>
                          )),
                        ];
                      });
                      return [summary, ...customerRows];
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="moduleBiTotalRow">
                      <td colSpan={10}><strong>{t("total")}</strong></td>
                      <td><strong>{formatAmount(totals.pendingAmount)}</strong></td>
                      <td colSpan={2} />
                      <td><strong>{formatAmount(totals.bmValue)}</strong></td>
                      <td><strong>{formatAmount(totals.restValue)}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{formatAmount(totals.amount)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </ExportableTable>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
