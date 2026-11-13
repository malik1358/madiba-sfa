"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Expected Collection", ar: "التحصيل المتوقع" },
  subtitle: {
    en: "Open invoices expected to pay by month-end (BM + Rest). Same rules as the KPI Collection expected-remaining estimate.",
    ar: "الفواتير المفتوحة المتوقع تحصيلها حتى نهاية الشهر (مواد بناء + الباقي). نفس قواعد تقدير التحصيل المتوقع في مؤشرات الأداء.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
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
  daysToEnd: { en: "Days → month-end", ar: "أيام حتى نهاية الشهر" },
  approxPay: { en: "Approx pay", ar: "تقريبي للسداد" },
  bm: { en: "BM SAR", ar: "مواد بناء (ر.س)" },
  rest: { en: "Rest SAR", ar: "الباقي (ر.س)" },
  total: { en: "Total", ar: "الإجمالي" },
  customers: { en: "Customers", ar: "العملاء" },
  invoices: { en: "Invoices", ar: "الفواتير" },
  monthEnd: { en: "Month-end", ar: "نهاية الشهر" },
  asOf: { en: "As of", ar: "حتى" },
  noRows: {
    en: "No open invoices are expected to pay by this month-end under the current rule.",
    ar: "لا توجد فواتير مفتوحة متوقع سدادها حتى نهاية هذا الشهر حسب القاعدة الحالية.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "Avg days used = max(lifetime avg, days on last paid invoice); 120 if never paid. Legal-queue customers are excluded. Expected amount is the BM + Rest sales-mix share of each open invoice whose approx pay date is on or before month-end (overdue still open counts).",
    ar: "متوسط الأيام = أعلى قيمة بين متوسط العمر وأيام آخر فاتورة مسددة؛ 120 إن لم يُسدد قط. يُستبعد عملاء الطابور القانوني. المبلغ المتوقع هو حصة مواد البناء + الباقي من كل فاتورة مفتوحة تاريخ سدادها التقريبي في أو قبل نهاية الشهر (المتأخر المفتوح يُحتسب).",
  },
};

const FILTER_KEYS = [
  "customerName",
  "customerCode",
  "avgDays",
  "lifetimeAvg",
  "lastPaidInvoiceDays",
  "lastReceiptDate",
  "refNo",
  "invoiceDate",
  "pendingAmount",
  "amount",
  "daysToMonthEnd",
  "approxPayDate",
  "bmValue",
  "restValue",
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

function cellValue(row, key) {
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

  const rows = useMemo(() => (Array.isArray(report?.rows) ? report.rows : []), [report]);
  const filterValueOf = useCallback((row, key) => cellValue(row, key), []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, filterValueOf);
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
              <h2>{t("title")}</h2>
              <span>{visibleRows.length}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            <p className="moduleHint">
              {t("asOf")}: {report?.asOf || "—"}
              {" · "}
              {t("monthEnd")}: {report?.monthEnd || "—"}
              {" · "}
              {t("customers")}: {report?.customerCount ?? 0}
              {" · "}
              {t("invoices")}: {report?.invoiceCount ?? 0}
              {" · "}
              BM: {formatAmount(report?.bmTotal || 0)}
              {" · "}
              Rest: {formatAmount(report?.restTotal || 0)}
              {" · "}
              {t("total")}: {formatAmount(report?.total || 0)}
            </p>
            <p className="moduleHint">{t("hint")}</p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable
                filename="expected-collection"
                tableId="expected-collection"
                sheetName="Expected collection"
                className="moduleTableWrap moduleBiTableWrap"
              >
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("customerCode")} filterKey="customerCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("customer")} filterKey="customerName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("avgDays")} filterKey="avgDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lifetime")} filterKey="lifetimeAvg" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lastPaid")} filterKey="lastPaidInvoiceDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("lastReceipt")} filterKey="lastReceiptDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("invoice")} filterKey="refNo" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("invoiceDate")} filterKey="invoiceDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("pending")} filterKey="pendingAmount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("amount")} filterKey="amount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                      <BiExcelHead label={t("daysToEnd")} filterKey="daysToMonthEnd" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("approxPay")} filterKey="approxPayDate" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("bm")} filterKey="bmValue" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("rest")} filterKey="restValue" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={`${row.customerCode}:${row.refNo}:${row.invoiceDate}:${row.amount}`}>
                        <td>{row.customerCode}</td>
                        <td>{row.customerName || "—"}</td>
                        <td>{formatMaybe(row.avgDays)}</td>
                        <td>{formatMaybe(row.lifetimeAvg)}</td>
                        <td>{formatMaybe(row.lastPaidInvoiceDays)}</td>
                        <td>{formatMaybe(row.lastReceiptDate)}</td>
                        <td>{row.refNo || "—"}</td>
                        <td>{row.invoiceDate || "—"}</td>
                        <td>{formatAmount(row.pendingAmount)}</td>
                        <td className="moduleBiTotalCol">{formatAmount(row.amount)}</td>
                        <td>{formatMaybe(row.daysToMonthEnd)}</td>
                        <td>{formatMaybe(row.approxPayDate)}</td>
                        <td>{formatAmount(row.bmValue)}</td>
                        <td>{formatAmount(row.restValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="moduleBiTotalRow">
                      <td colSpan={8}><strong>{t("total")}</strong></td>
                      <td><strong>{formatAmount(totals.pendingAmount)}</strong></td>
                      <td className="moduleBiTotalCol"><strong>{formatAmount(totals.amount)}</strong></td>
                      <td colSpan={2} />
                      <td><strong>{formatAmount(totals.bmValue)}</strong></td>
                      <td><strong>{formatAmount(totals.restValue)}</strong></td>
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
