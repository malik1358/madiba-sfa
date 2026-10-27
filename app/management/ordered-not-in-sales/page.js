"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { DEFAULT_ORDERED_NOT_IN_SALES_DAYS } from "../../lib/orderedNotInSales.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Ordered Not in Sales", ar: "مطلوب وغير مباع" },
  subtitle: {
    en: "Items on submitted orders in the last 7 KSA days that never appear in uploaded sales for the same window. These are the usual out-of-stock gaps.",
    ar: "أصناف ظهرت في الطلبات المسلّمة خلال آخر 7 أيام (توقيت السعودية) ولم تظهر في المبيعات المرفوعة لنفس الفترة. غالباً تكون نفاد مخزون.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Item code", ar: "رمز الصنف" },
  item: { en: "Item", ar: "الصنف" },
  category: { en: "Category", ar: "الفئة" },
  orderedQty: { en: "Ordered qty", ar: "الكمية المطلوبة" },
  orderCount: { en: "Orders", ar: "الطلبات" },
  orderValue: { en: "Order value", ar: "قيمة الطلب" },
  lastOrdered: { en: "Last ordered", ar: "آخر طلب" },
  total: { en: "Total", ar: "الإجمالي" },
  window: { en: "Window", ar: "الفترة" },
  orderedItems: { en: "Ordered items", ar: "أصناف مطلوبة" },
  soldItems: { en: "Also in sales", ar: "ظهرت أيضاً في المبيعات" },
  missingItems: { en: "Not in sales", ar: "غير موجودة في المبيعات" },
  noRows: {
    en: "Every ordered item in this window also appears in sales.",
    ar: "كل الأصناف المطلوبة في هذه الفترة ظهرت أيضاً في المبيعات.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
};

const FILTER_KEYS = [
  "itemCode",
  "itemName",
  "category",
  "orderedQty",
  "orderCount",
  "orderValue",
  "lastOrderedAt",
];

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 3,
  });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(iso) {
  const text = String(iso || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function cellValue(row, key) {
  if (key === "itemCode") return row.itemCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "category") return row.category || "";
  if (key === "orderedQty") return formatQty(row.orderedQty);
  if (key === "orderCount") return String(row.orderCount ?? "");
  if (key === "orderValue") return formatAmount(row.orderValue);
  if (key === "lastOrderedAt") return formatDateTime(row.lastOrderedAt);
  return "";
}

export default function OrderedNotInSalesPage() {
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
      const response = await fetch(
        `/api/ordered-not-in-sales?days=${DEFAULT_ORDERED_NOT_IN_SALES_DAYS}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
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
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, cellValue);
  const totals = useMemo(() => {
    let orderedQty = 0;
    let orderCount = 0;
    let orderValue = 0;
    visibleRows.forEach((row) => {
      orderedQty += Number(row.orderedQty || 0);
      orderCount += Number(row.orderCount || 0);
      orderValue += Number(row.orderValue || 0);
    });
    return {
      orderedQty: Math.round(orderedQty * 1000) / 1000,
      orderCount,
      orderValue: Math.round(orderValue * 100) / 100,
    };
  }, [visibleRows]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Ordered not in sales unavailable"
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

  const windowLabel = report?.window
    ? `${report.window.fromDate} → ${report.window.toDate}`
    : `${DEFAULT_ORDERED_NOT_IN_SALES_DAYS} days`;

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
              {t("window")}: {windowLabel}
              {report?.summary
                ? ` · ${t("orderedItems")}: ${report.summary.orderedItems} · ${t("soldItems")}: ${report.summary.soldItems} · ${t("missingItems")}: ${report.summary.missingItems}`
                : ""}
            </p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="ordered-not-in-sales" sheetName="Out of stock" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("code")} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("item")} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("category")} filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("orderedQty")} filterKey="orderedQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("orderCount")} filterKey="orderCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("orderValue")} filterKey="orderValue" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                      <BiExcelHead label={t("lastOrdered")} filterKey="lastOrderedAt" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.itemCode}>
                        <td>{row.itemCode}</td>
                        <td>{row.itemName}</td>
                        <td>{row.category}</td>
                        <td>{formatQty(row.orderedQty)}</td>
                        <td>{row.orderCount}</td>
                        <td className="moduleBiTotalCol">{formatAmount(row.orderValue)}</td>
                        <td>{formatDateTime(row.lastOrderedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td>{visibleRows.length}</td>
                      <td />
                      <td>{formatQty(totals.orderedQty)}</td>
                      <td>{totals.orderCount}</td>
                      <td className="moduleBiTotalCol">{formatAmount(totals.orderValue)}</td>
                      <td />
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
