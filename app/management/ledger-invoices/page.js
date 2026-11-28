"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { currentMonthDateRange } from "../../lib/salesInvoices";
import { getSupabaseClient } from "../../lib/supabase";
import { getKsaDateString } from "../../lib/workdayActivity";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Ledger Invoices", ar: "فواتير دفتر الأستاذ" },
  subtitle: {
    en: "Sales invoices that stay in the customer ledger. Immediate credit-note reversals are excluded (same rules as Payment Settlement and Balance Confirmation).",
    ar: "فواتير المبيعات المعتمدة في دفتر العميل. تُستبعد الفواتير الملغاة بإشعار دائن فوري (نفس قواعد تسوية المدفوعات وتأكيد الرصيد).",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: {
    en: "Building ledger invoices from active sales…",
    ar: "جاري بناء فواتير دفتر الأستاذ من المبيعات النشطة…",
  },
  refresh: { en: "Refresh", ar: "تحديث" },
  fromDate: { en: "From", ar: "من" },
  toDate: { en: "To", ar: "إلى" },
  view: { en: "View", ar: "العرض" },
  dateWise: { en: "Date-wise", ar: "حسب اليوم" },
  monthWise: { en: "Month-wise", ar: "حسب الشهر" },
  showReversed: { en: "Show excluded reversed", ar: "عرض الملغى المستبعد" },
  hideReversed: { en: "Hide excluded reversed", ar: "إخفاء الملغى المستبعد" },
  expand: { en: "Expand", ar: "توسيع" },
  collapse: { en: "Collapse", ar: "طي" },
  expandAll: { en: "Expand all", ar: "توسيع الكل" },
  collapseAll: { en: "Collapse all", ar: "طي الكل" },
  date: { en: "Date", ar: "التاريخ" },
  month: { en: "Month", ar: "الشهر" },
  voucher: { en: "Invoice", ar: "الفاتورة" },
  customer: { en: "Customer", ar: "العميل" },
  customerCode: { en: "Customer code", ar: "رمز العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  exclVat: { en: "Excl. VAT", ar: "بدون ضريبة" },
  inclVat: { en: "Incl. VAT", ar: "شامل الضريبة" },
  status: { en: "Status", ar: "الحالة" },
  creditNote: { en: "Credit note", ar: "إشعار دائن" },
  cash: { en: "Cash", ar: "نقدي" },
  credit: { en: "Credit", ar: "آجل" },
  kind: { en: "Kind", ar: "النوع" },
  invoices: { en: "Invoices", ar: "الفواتير" },
  customers: { en: "Customers", ar: "العملاء" },
  reversed: { en: "Excluded reversed", ar: "ملغى مستبعد" },
  total: { en: "Total", ar: "الإجمالي" },
  all: { en: "All", ar: "الكل" },
  noRows: {
    en: "No ledger invoices in this date range.",
    ar: "لا توجد فواتير دفتر أستاذ في هذا النطاق.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  hint: {
    en: "Universe matches Balance Confirmation Schedule A / Payment Settlement FIFO invoices. Voids paired by immediate credit note are listed only when “Show excluded reversed” is on. Month-wise and date-wise use the invoice date.",
    ar: "المجموعة تطابق جدول تأكيد الرصيد أ / فواتير تسوية المدفوعات. الفواتير الملغاة بإشعار دائن فوري تظهر فقط عند تفعيل «عرض الملغى المستبعد». العرض الشهري واليومي حسب تاريخ الفاتورة.",
  },
};

const INVOICE_FILTER_KEYS = [
  "invoiceDate",
  "voucherNumber",
  "customerName",
  "customerCode",
  "salesmanName",
  "kind",
  "amountExclVat",
  "amountInclVat",
  "status",
];

const DAY_FILTER_KEYS = [
  "invoiceDate",
  "invoiceCount",
  "reversedCount",
  "customerCount",
  "amountExclVat",
  "amountInclVat",
];

const MONTH_FILTER_KEYS = [
  "monthKey",
  "invoiceCount",
  "reversedCount",
  "customerCount",
  "amountExclVat",
  "amountInclVat",
];

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthLabel(monthKey) {
  const text = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return "—";
  const [year, month] = text.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(month) - 1]} ${year.slice(2)}`;
}

function invoiceCellValue(row, key) {
  if (key === "invoiceDate") return row.invoiceDate || "";
  if (key === "voucherNumber") return row.voucherNumber || "";
  if (key === "customerName") return row.customerName || "";
  if (key === "customerCode") return row.customerCode || "";
  if (key === "salesmanName") return row.salesmanName || row.salesmanCode || "";
  if (key === "kind") return row.isCash ? "Cash" : "Credit";
  if (key === "amountExclVat") return formatAmount(row.amountExclVat);
  if (key === "amountInclVat") return formatAmount(row.amountInclVat);
  if (key === "status") return row.status || "";
  return "";
}

function dayCellValue(row, key) {
  if (key === "invoiceDate") return row.invoiceDate || "";
  if (key === "invoiceCount") return String(row.invoiceCount || 0);
  if (key === "reversedCount") return String(row.reversedCount || 0);
  if (key === "customerCount") return String(row.customerCount || 0);
  if (key === "amountExclVat") return formatAmount(row.amountExclVat);
  if (key === "amountInclVat") return formatAmount(row.amountInclVat);
  return "";
}

function monthCellValue(row, key) {
  if (key === "monthKey") return monthLabel(row.monthKey);
  if (key === "invoiceCount") return String(row.invoiceCount || 0);
  if (key === "reversedCount") return String(row.reversedCount || 0);
  if (key === "customerCount") return String(row.customerCount || 0);
  if (key === "amountExclVat") return formatAmount(row.amountExclVat);
  if (key === "amountInclVat") return formatAmount(row.amountInclVat);
  return "";
}

function monthDefaults() {
  return currentMonthDateRange(getKsaDateString());
}

function InvoiceDetailTable({
  rows,
  t,
  language,
  filename,
  showCreditNote = false,
}) {
  const filterValueOf = useCallback((row, key) => invoiceCellValue(row, key), []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(
    rows,
    INVOICE_FILTER_KEYS,
    filterValueOf,
  );
  const totals = useMemo(() => visibleRows.reduce((sum, row) => ({
    amountExclVat: sum.amountExclVat + Number(row.amountExclVat || 0),
    amountInclVat: sum.amountInclVat + Number(row.amountInclVat || 0),
  }), { amountExclVat: 0, amountInclVat: 0 }), [visibleRows]);

  if (!rows.length) {
    return <p className="moduleHint">{t("noRows")}</p>;
  }

  return (
    <ExportableTable filename={filename} sheetName="Invoices" className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <BiExcelHead label={t("date")} filterKey="invoiceDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("voucher")} filterKey="voucherNumber" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("customer")} filterKey="customerName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("customerCode")} filterKey="customerCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("salesman")} filterKey="salesmanName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("kind")} filterKey="kind" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("exclVat")} filterKey="amountExclVat" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            <BiExcelHead label={t("inclVat")} filterKey="amountInclVat" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            <BiExcelHead label={t("status")} filterKey="status" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            {showCreditNote ? <th>{t("creditNote")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={`${row.invoiceDate}|${row.voucherNumber}|${row.customerCode}|${row.status}`}>
              <td>{row.invoiceDate || "—"}</td>
              <td>{row.voucherNumber || "—"}</td>
              <td>{row.customerName || "—"}</td>
              <td>{row.customerCode || "—"}</td>
              <td>{row.salesmanName || row.salesmanCode || "—"}</td>
              <td>{row.isCash ? t("cash") : t("credit")}</td>
              <td className="moduleBiTotalCol">{formatAmount(row.amountExclVat)}</td>
              <td className="moduleBiTotalCol">{formatAmount(row.amountInclVat)}</td>
              <td>{row.status || "—"}</td>
              {showCreditNote ? (
                <td>
                  {[row.creditNoteDate, row.creditNoteVoucher].filter(Boolean).join(" · ") || "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>{t("total")} ({visibleRows.length.toLocaleString(language === "ar" ? "ar" : "en-SA")})</td>
            <td className="moduleBiTotalCol">{formatAmount(totals.amountExclVat)}</td>
            <td className="moduleBiTotalCol">{formatAmount(totals.amountInclVat)}</td>
            <td />
            {showCreditNote ? <td /> : null}
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}

export default function LedgerInvoicesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const defaults = useMemo(() => monthDefaults(), []);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [viewMode, setViewMode] = useState("date");
  const [showReversed, setShowReversed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [report, setReport] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [reloadToken, setReloadToken] = useState(0);

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
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const response = await fetch(`/api/ledger-invoices?${params.toString()}`, {
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
            ? "Report timed out. Please refresh and try a shorter date range."
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
      setExpandedKeys(new Set());
    } catch (err) {
      setError(err.message || "Unable to load the report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport, reloadToken]);

  const invoices = useMemo(
    () => (Array.isArray(report?.invoices) ? report.invoices : []),
    [report],
  );
  const reversedInvoices = useMemo(
    () => (Array.isArray(report?.reversedInvoices) ? report.reversedInvoices : []),
    [report],
  );
  const days = useMemo(
    () => (Array.isArray(report?.days) ? report.days : []),
    [report],
  );
  const months = useMemo(
    () => (Array.isArray(report?.months) ? report.months : []),
    [report],
  );

  const dayFilterValueOf = useCallback((row, key) => dayCellValue(row, key), []);
  const monthFilterValueOf = useCallback((row, key) => monthCellValue(row, key), []);
  const dayFilters = useBiExcelFilters(days, DAY_FILTER_KEYS, dayFilterValueOf);
  const monthFilters = useBiExcelFilters(months, MONTH_FILTER_KEYS, monthFilterValueOf);

  const summary = report?.summary || {
    invoiceCount: 0,
    customerCount: 0,
    amountExclVat: 0,
    amountInclVat: 0,
    reversedCount: 0,
    reversedAmountExclVat: 0,
  };

  function toggleExpanded(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllKeys(keys) {
    setExpandedKeys(new Set(keys));
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Ledger invoices unavailable"
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

  const groupRows = viewMode === "month" ? monthFilters.visibleRows : dayFilters.visibleRows;
  const groupKeys = groupRows.map((row) => (
    viewMode === "month" ? row.monthKey : row.invoiceDate
  ));

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
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("fromDate")}
                <input
                  className="moduleInput"
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    if (event.target.value) setFromDate(event.target.value);
                  }}
                />
              </label>
              <label className="moduleField">
                {t("toDate")}
                <input
                  className="moduleInput"
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    if (event.target.value) setToDate(event.target.value);
                  }}
                />
              </label>
              <label className="moduleField">
                {t("view")}
                <select
                  className="moduleInput"
                  value={viewMode}
                  onChange={(event) => {
                    setViewMode(event.target.value);
                    setExpandedKeys(new Set());
                  }}
                >
                  <option value="date">{t("dateWise")}</option>
                  <option value="month">{t("monthWise")}</option>
                </select>
              </label>
              <button
                type="button"
                className="moduleInlineButton"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                {t("refresh")}
              </button>
              <button
                type="button"
                className="moduleInlineButton"
                onClick={() => setShowReversed((current) => !current)}
              >
                {showReversed ? t("hideReversed") : t("showReversed")}
              </button>
            </div>

            <div className="moduleMetricGrid" style={{ marginTop: "14px" }}>
              <div className="moduleMetricCard">
                <span className="moduleMetricLabel">{t("invoices")}</span>
                <strong>{Number(summary.invoiceCount || 0).toLocaleString(language === "ar" ? "ar" : "en-SA")}</strong>
              </div>
              <div className="moduleMetricCard">
                <span className="moduleMetricLabel">{t("customers")}</span>
                <strong>{Number(summary.customerCount || 0).toLocaleString(language === "ar" ? "ar" : "en-SA")}</strong>
              </div>
              <div className="moduleMetricCard">
                <span className="moduleMetricLabel">{t("exclVat")}</span>
                <strong>{formatAmount(summary.amountExclVat)}</strong>
              </div>
              <div className="moduleMetricCard">
                <span className="moduleMetricLabel">{t("inclVat")}</span>
                <strong>{formatAmount(summary.amountInclVat)}</strong>
              </div>
              <div className="moduleMetricCard">
                <span className="moduleMetricLabel">{t("reversed")}</span>
                <strong>
                  {Number(summary.reversedCount || 0).toLocaleString(language === "ar" ? "ar" : "en-SA")}
                  {" · "}
                  {formatAmount(summary.reversedAmountExclVat)}
                </strong>
              </div>
            </div>

            <p className="moduleHint" style={{ marginTop: "12px" }}>{t("hint")}</p>
            {error ? <p className="moduleError">{error}</p> : null}
            {loading ? <p className="moduleHint">{t("loading")}</p> : null}

            {!loading && viewMode === "date" && days.length === 0 && invoices.length === 0 ? (
              <p className="moduleHint">{t("noRows")}</p>
            ) : null}

            {!loading && viewMode === "date" ? (
              <>
                <div className="moduleActionRow" style={{ marginBottom: "10px" }}>
                  <button type="button" className="moduleInlineButton" onClick={() => expandAllKeys(groupKeys)}>
                    {t("expandAll")}
                  </button>
                  <button type="button" className="moduleInlineButton" onClick={() => setExpandedKeys(new Set())}>
                    {t("collapseAll")}
                  </button>
                </div>
                <ExportableTable filename="ledger-invoices-by-date" sheetName="By date" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th />
                        <BiExcelHead label={t("date")} filterKey="invoiceDate" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("invoices")} filterKey="invoiceCount" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("reversed")} filterKey="reversedCount" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("customers")} filterKey="customerCount" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("exclVat")} filterKey="amountExclVat" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("inclVat")} filterKey="amountInclVat" options={dayFilters.options} filters={dayFilters.filters} onChange={dayFilters.setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                      </tr>
                    </thead>
                    <tbody>
                      {dayFilters.visibleRows.map((row) => {
                        const open = expandedKeys.has(row.invoiceDate);
                        return (
                          <Fragment key={row.invoiceDate}>
                            <tr>
                              <td>
                                <button
                                  type="button"
                                  className="moduleInlineButton"
                                  onClick={() => toggleExpanded(row.invoiceDate)}
                                >
                                  {open ? t("collapse") : t("expand")}
                                </button>
                              </td>
                              <td>{row.invoiceDate}</td>
                              <td>{row.invoiceCount}</td>
                              <td>{row.reversedCount}</td>
                              <td>{row.customerCount}</td>
                              <td className="moduleBiTotalCol">{formatAmount(row.amountExclVat)}</td>
                              <td className="moduleBiTotalCol">{formatAmount(row.amountInclVat)}</td>
                            </tr>
                            {open ? (
                              <tr>
                                <td colSpan={7}>
                                  <InvoiceDetailTable
                                    rows={row.invoices || []}
                                    t={t}
                                    language={language}
                                    filename={`ledger-invoices-${row.invoiceDate}`}
                                  />
                                  {showReversed && (row.reversedInvoices || []).length ? (
                                    <div style={{ marginTop: "12px" }}>
                                      <p className="moduleHint">{t("reversed")}</p>
                                      <InvoiceDetailTable
                                        rows={row.reversedInvoices || []}
                                        t={t}
                                        language={language}
                                        filename={`ledger-reversed-${row.invoiceDate}`}
                                        showCreditNote
                                      />
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>{t("total")}</td>
                        <td className="moduleBiTotalCol">
                          {formatAmount(dayFilters.visibleRows.reduce((sum, row) => sum + Number(row.amountExclVat || 0), 0))}
                        </td>
                        <td className="moduleBiTotalCol">
                          {formatAmount(dayFilters.visibleRows.reduce((sum, row) => sum + Number(row.amountInclVat || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </>
            ) : null}

            {!loading && viewMode === "month" ? (
              <>
                <div className="moduleActionRow" style={{ marginBottom: "10px" }}>
                  <button type="button" className="moduleInlineButton" onClick={() => expandAllKeys(groupKeys)}>
                    {t("expandAll")}
                  </button>
                  <button type="button" className="moduleInlineButton" onClick={() => setExpandedKeys(new Set())}>
                    {t("collapseAll")}
                  </button>
                </div>
                <ExportableTable filename="ledger-invoices-by-month" sheetName="By month" className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <th />
                        <BiExcelHead label={t("month")} filterKey="monthKey" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("invoices")} filterKey="invoiceCount" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("reversed")} filterKey="reversedCount" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("customers")} filterKey="customerCount" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("exclVat")} filterKey="amountExclVat" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("inclVat")} filterKey="amountInclVat" options={monthFilters.options} filters={monthFilters.filters} onChange={monthFilters.setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                      </tr>
                    </thead>
                    <tbody>
                      {monthFilters.visibleRows.map((row) => {
                        const open = expandedKeys.has(row.monthKey);
                        return (
                          <Fragment key={row.monthKey}>
                            <tr>
                              <td>
                                <button
                                  type="button"
                                  className="moduleInlineButton"
                                  onClick={() => toggleExpanded(row.monthKey)}
                                >
                                  {open ? t("collapse") : t("expand")}
                                </button>
                              </td>
                              <td>{monthLabel(row.monthKey)}</td>
                              <td>{row.invoiceCount}</td>
                              <td>{row.reversedCount}</td>
                              <td>{row.customerCount}</td>
                              <td className="moduleBiTotalCol">{formatAmount(row.amountExclVat)}</td>
                              <td className="moduleBiTotalCol">{formatAmount(row.amountInclVat)}</td>
                            </tr>
                            {open ? (
                              <tr>
                                <td colSpan={7}>
                                  <InvoiceDetailTable
                                    rows={row.invoices || []}
                                    t={t}
                                    language={language}
                                    filename={`ledger-invoices-${row.monthKey}`}
                                  />
                                  {showReversed && (row.reversedInvoices || []).length ? (
                                    <div style={{ marginTop: "12px" }}>
                                      <p className="moduleHint">{t("reversed")}</p>
                                      <InvoiceDetailTable
                                        rows={row.reversedInvoices || []}
                                        t={t}
                                        language={language}
                                        filename={`ledger-reversed-${row.monthKey}`}
                                        showCreditNote
                                      />
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>{t("total")}</td>
                        <td className="moduleBiTotalCol">
                          {formatAmount(monthFilters.visibleRows.reduce((sum, row) => sum + Number(row.amountExclVat || 0), 0))}
                        </td>
                        <td className="moduleBiTotalCol">
                          {formatAmount(monthFilters.visibleRows.reduce((sum, row) => sum + Number(row.amountInclVat || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </>
            ) : null}

            {!loading && showReversed && viewMode === "date" && reversedInvoices.length && days.length === 0 ? (
              <div style={{ marginTop: "16px" }}>
                <p className="moduleHint">{t("reversed")}</p>
                <InvoiceDetailTable
                  rows={reversedInvoices}
                  t={t}
                  language={language}
                  filename="ledger-reversed-invoices"
                  showCreditNote
                />
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
