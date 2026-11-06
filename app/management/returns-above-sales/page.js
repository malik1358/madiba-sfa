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
  title: { en: "Returns Above Sales", ar: "مرتجعات أعلى من المبيعات" },
  subtitle: {
    en: "Customer and item pairs where credit-note value is higher than sales value from the first imported day. Voucher numbers are the sales and the returns so each line can be traced.",
    ar: "العميل والصنف عندما تكون قيمة إشعار الدائن أعلى من قيمة المبيعات منذ أول يوم مستورد. أرقام السندات هي المبيعات والمرتجعات لتتبع كل سطر.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  customer: { en: "Customer", ar: "العميل" },
  customerCode: { en: "Customer code", ar: "رمز العميل" },
  item: { en: "Item", ar: "الصنف" },
  itemCode: { en: "Item code", ar: "رمز الصنف" },
  salesAmount: { en: "Sales SAR", ar: "مبيعات (ر.س)" },
  returnAmount: { en: "Return SAR", ar: "مرتجع (ر.س)" },
  excess: { en: "Excess SAR", ar: "الزيادة (ر.س)" },
  salesVouchers: { en: "Sales vouchers", ar: "سندات البيع" },
  returnVouchers: { en: "Return vouchers", ar: "سندات المرتجع" },
  total: { en: "Total", ar: "الإجمالي" },
  items: { en: "Items", ar: "الأصناف" },
  customers: { en: "Customers", ar: "العملاء" },
  span: { en: "History", ar: "الفترة" },
  noRows: {
    en: "No customer and item has return value above sales value.",
    ar: "لا يوجد عميل وصنف قيمة مرتجعه أعلى من قيمة مبيعاته.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "A line is a return when the voucher type is a credit note or sales return, or when the amount is negative. Comparison is by value. The same numeric voucher is counted once when it was imported both with and without a leading zero. A003927 is the same item as A003928. A sales invoice named in the credit-note reference is counted when it is missing from the live batch. Amounts are ex-VAT.",
    ar: "السطر مرتجع عندما يكون نوع السند إشعار دائن أو مرتجع مبيعات، أو عندما يكون المبلغ سالباً. المقارنة بالقيمة. السند الرقمي يُحتسب مرة واحدة إذا استُورد مع صفر في البداية وبدونه. الصنف A003927 هو نفس A003928. فاتورة البيع المذكورة في مرجع إشعار الدائن تُحتسب إذا كانت ناقصة من الدفعة الحالية. المبالغ بدون الضريبة.",
  },
};

const FILTER_KEYS = [
  "customerName",
  "customerCode",
  "itemName",
  "itemCode",
  "salesAmount",
  "returnAmount",
  "salesVouchers",
  "returnVouchers",
  "excessAmount",
];

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cellValue(row, key) {
  if (key === "customerName") return row.customerName || "";
  if (key === "customerCode") return row.customerCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "itemCode") return row.itemCode || "";
  if (key === "salesAmount") return formatAmount(row.salesAmount);
  if (key === "returnAmount") return formatAmount(row.returnAmount);
  if (key === "excessAmount") return formatAmount(row.excessAmount);
  if (key === "salesVouchers") return row.salesVouchers || "";
  if (key === "returnVouchers") return row.returnVouchers || "";
  return "";
}

export default function ReturnsAboveSalesPage() {
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
      const response = await fetch("/api/returns-above-sales", {
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
    salesAmount: sum.salesAmount + Number(row.salesAmount || 0),
    returnAmount: sum.returnAmount + Number(row.returnAmount || 0),
    excessAmount: sum.excessAmount + Number(row.excessAmount || 0),
  }), {
    salesAmount: 0,
    returnAmount: 0,
    excessAmount: 0,
  }), [visibleRows]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Returns above sales unavailable"
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

  const span = report?.span?.firstDate
    ? `${report.span.firstDate} → ${report.span.lastDate || report.span.firstDate}`
    : "";

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
              {span ? `${t("span")}: ${span} · ` : ""}
              {t("customers")}: {report?.summary?.customerCount ?? 0}
              {" · "}
              {t("items")}: {report?.summary?.itemCount ?? 0}
              {" · "}
              {t("excess")}: {formatAmount(report?.summary?.excessAmount || 0)}
            </p>
            <p className="moduleHint">{t("hint")}</p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="returns-above-sales" sheetName="Returns above sales" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("customer")} filterKey="customerName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("customerCode")} filterKey="customerCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("item")} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("itemCode")} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("salesAmount")} filterKey="salesAmount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("returnAmount")} filterKey="returnAmount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("salesVouchers")} filterKey="salesVouchers" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("returnVouchers")} filterKey="returnVouchers" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("excess")} filterKey="excessAmount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={`${row.customerCode}-${row.itemCode}`}>
                        <td>{row.customerName}</td>
                        <td>{row.customerCode}</td>
                        <td>{row.itemName}</td>
                        <td>{row.itemCode}</td>
                        <td>{formatAmount(row.salesAmount)}</td>
                        <td className="moduleBiMonthCell--down">{formatAmount(row.returnAmount)}</td>
                        <td className="moduleBiVoucherCell">{row.salesVouchers || "—"}</td>
                        <td className="moduleBiVoucherCell">{row.returnVouchers || "—"}</td>
                        <td className="moduleBiTotalCol moduleBiMonthCell--down">{formatAmount(row.excessAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td>{visibleRows.length}</td>
                      <td />
                      <td />
                      <td>{formatAmount(totals.salesAmount)}</td>
                      <td className="moduleBiMonthCell--down">{formatAmount(totals.returnAmount)}</td>
                      <td />
                      <td />
                      <td className="moduleBiTotalCol moduleBiMonthCell--down">{formatAmount(totals.excessAmount)}</td>
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
