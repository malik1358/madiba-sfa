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
  EXPECTED_STOCKED_SALES_CATEGORY_FILTER_KEYS,
  EXPECTED_STOCKED_SALES_ITEM_FILTER_KEYS,
} from "../../lib/expectedStockedSales.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Expected Stocked Sales", ar: "المبيعات المتوقعة مع توفر المخزون" },
  subtitle: {
    en: "Expected monthly sales if every qualifying item is in stock: each item’s second-highest completed month after company seasonal peaks are removed. Items need lifetime GP above 10%. Local products (LP*) are excluded.",
    ar: "المبيعات الشهرية المتوقعة إذا توفرت كل الأصناف المؤهلة: ثاني أعلى شهر مكتمل لكل صنف بعد استبعاد أشهر الذروة الموسمية للشركة. يشترط هامش ربح إجمالي أكثر من 10%. أصناف LP* مستثناة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  categorySummary: { en: "Category summary", ar: "ملخص الفئات" },
  itemDetail: { en: "Item detail", ar: "تفاصيل الأصناف" },
  category: { en: "Category", ar: "الفئة" },
  items: { en: "Items", ar: "الأصناف" },
  item: { en: "Item", ar: "الصنف" },
  itemCode: { en: "Item code", ar: "رمز الصنف" },
  mergedFrom: { en: "Merged codes", ar: "رموز مدمجة" },
  gpPercent: { en: "GP %", ar: "هامش %" },
  eligibleMonths: { en: "Eligible months", ar: "الأشهر المؤهلة" },
  peakMonth: { en: "Highest month", ar: "أعلى شهر" },
  peakSales: { en: "Highest SAR", ar: "أعلى قيمة" },
  expectedMonth: { en: "Expected month", ar: "الشهر المتوقع" },
  expectedQty: { en: "Expected qty", ar: "الكمية المتوقعة" },
  expectedSales: { en: "Expected SAR", ar: "القيمة المتوقعة" },
  share: { en: "Share %", ar: "الحصة %" },
  total: { en: "Total", ar: "الإجمالي" },
  span: { en: "History", ar: "الفترة" },
  seasonal: { en: "Seasonal months excluded", ar: "الأشهر الموسمية المستبعدة" },
  incomplete: { en: "Current month excluded", ar: "الشهر الحالي مستبعد" },
  minGp: { en: "Min GP", ar: "أدنى هامش" },
  noRows: {
    en: "No qualifying items with GP above 10% and non-seasonal monthly sales.",
    ar: "لا توجد أصناف مؤهلة بهامش أعلى من 10% ومبيعات شهرية غير موسمية.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "Company seasonal peaks are the top completed months at least 25% above the median monthly sales (up to three). Those calendar months are dropped for every item. Replacement item codes (for example old 100-pc gloves → current 70-pc gloves) are merged so history is not double-counted. Expected SAR is the second-highest remaining month (or the only month when history is thin). Amounts are ex-VAT net sales.",
    ar: "ذروة الشركة الموسمية هي أعلى الأشهر المكتملة التي تزيد 25% على الأقل عن وسيط المبيعات الشهرية (حتى ثلاثة أشهر). تُستبعد تلك الأشهر التقويمية لكل صنف. رموز الأصناف البديلة (مثل قفازات 100 قطعة القديمة ← 70 قطعة الحالية) تُدمج حتى لا تُحسب مرتين. القيمة المتوقعة هي ثاني أعلى شهر متبقٍ (أو الشهر الوحيد عند قلة التاريخ). المبالغ صافي مبيعات بدون ضريبة.",
  },
};

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value) {
  if (value == null || value === "") return "—";
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 3,
  });
}

function formatPercent(value) {
  if (value == null || value === "") return "—";
  return `${Number(value).toLocaleString("en-SA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}%`;
}

function monthLabel(monthKey) {
  const text = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return "—";
  const [year, month] = text.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(month) - 1]} ${year.slice(2)}`;
}

function calendarMonthLabel(mm) {
  const names = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
    "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
  };
  return names[String(mm || "")] || String(mm || "");
}

function itemCellValue(row, key) {
  if (key === "itemCode") return row.itemCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "category") return row.category || "";
  if (key === "mergedFrom") return row.mergedFrom || "";
  if (key === "gpPercent") return formatPercent(row.gpPercent);
  if (key === "eligibleMonthCount") return String(row.eligibleMonthCount ?? "");
  if (key === "peakMonth") return monthLabel(row.peakMonth);
  if (key === "peakSales") return formatAmount(row.peakSales);
  if (key === "expectedMonth") return monthLabel(row.expectedMonth);
  if (key === "expectedQty") return formatQty(row.expectedQty);
  if (key === "expectedSales") return formatAmount(row.expectedSales);
  return "";
}

function categoryCellValue(row, key) {
  if (key === "category") return row.category || "";
  if (key === "itemCount") return String(row.itemCount ?? "");
  if (key === "expectedSales") return formatAmount(row.expectedSales);
  if (key === "sharePercent") return formatPercent(row.sharePercent);
  return "";
}

export default function ExpectedStockedSalesPage() {
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
      const response = await fetch("/api/expected-stocked-sales", {
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

  const itemRows = useMemo(() => (Array.isArray(report?.rows) ? report.rows : []), [report]);
  const categoryRows = useMemo(
    () => (Array.isArray(report?.categoryRows) ? report.categoryRows : []),
    [report],
  );
  const itemFilterValueOf = useCallback((row, key) => itemCellValue(row, key), []);
  const categoryFilterValueOf = useCallback((row, key) => categoryCellValue(row, key), []);
  const {
    filters: itemFilters,
    options: itemOptions,
    visibleRows: visibleItems,
    setFilter: setItemFilter,
  } = useBiExcelFilters(itemRows, EXPECTED_STOCKED_SALES_ITEM_FILTER_KEYS, itemFilterValueOf);
  const {
    filters: categoryFilters,
    options: categoryOptions,
    visibleRows: visibleCategories,
    setFilter: setCategoryFilter,
  } = useBiExcelFilters(categoryRows, EXPECTED_STOCKED_SALES_CATEGORY_FILTER_KEYS, categoryFilterValueOf);

  const itemTotals = useMemo(() => visibleItems.reduce((sum, row) => ({
    expectedSales: sum.expectedSales + Number(row.expectedSales || 0),
    expectedQty: sum.expectedQty + Number(row.expectedQty || 0),
  }), { expectedSales: 0, expectedQty: 0 }), [visibleItems]);

  const categoryTotals = useMemo(() => visibleCategories.reduce((sum, row) => ({
    itemCount: sum.itemCount + Number(row.itemCount || 0),
    expectedSales: sum.expectedSales + Number(row.expectedSales || 0),
  }), { itemCount: 0, expectedSales: 0 }), [visibleCategories]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Expected stocked sales unavailable"
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
  const seasonalLabel = (report?.season?.calendarMonths || [])
    .map(calendarMonthLabel)
    .filter(Boolean)
    .join(", ") || "—";

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
              <h2>{t("categorySummary")}</h2>
              <span>{formatAmount(report?.summary?.expectedSales || 0)}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            <p className="moduleHint">
              {span ? `${t("span")}: ${span} · ` : ""}
              {t("items")}: {report?.summary?.itemCount ?? 0}
              {" · "}
              {t("expectedSales")}: {formatAmount(report?.summary?.expectedSales || 0)}
              {" · "}
              {t("seasonal")}: {seasonalLabel}
              {report?.incompleteMonth ? ` · ${t("incomplete")}: ${monthLabel(report.incompleteMonth)}` : ""}
              {" · "}
              {t("minGp")}: {formatPercent(report?.minGpPercent ?? 10)}
            </p>
            <p className="moduleHint">{t("hint")}</p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : categoryRows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="expected-stocked-sales-categories" sheetName="Categories" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("category")} filterKey="category" options={categoryOptions} filters={categoryFilters} onChange={setCategoryFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("items")} filterKey="itemCount" options={categoryOptions} filters={categoryFilters} onChange={setCategoryFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("share")} filterKey="sharePercent" options={categoryOptions} filters={categoryFilters} onChange={setCategoryFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("expectedSales")} filterKey="expectedSales" options={categoryOptions} filters={categoryFilters} onChange={setCategoryFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCategories.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{row.itemCount}</td>
                        <td>{formatPercent(row.sharePercent)}</td>
                        <td className="moduleBiTotalCol">{formatAmount(row.expectedSales)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td>{categoryTotals.itemCount}</td>
                      <td>{formatPercent(100)}</td>
                      <td className="moduleBiTotalCol">{formatAmount(categoryTotals.expectedSales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </ExportableTable>
            )}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("itemDetail")}</h2>
              <span>{visibleItems.length}</span>
            </div>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : itemRows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="expected-stocked-sales-items" sheetName="Items" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("itemCode")} filterKey="itemCode" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("item")} filterKey="itemName" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("category")} filterKey="category" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("mergedFrom")} filterKey="mergedFrom" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("gpPercent")} filterKey="gpPercent" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("eligibleMonths")} filterKey="eligibleMonthCount" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("peakMonth")} filterKey="peakMonth" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("peakSales")} filterKey="peakSales" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("expectedMonth")} filterKey="expectedMonth" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("expectedQty")} filterKey="expectedQty" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("expectedSales")} filterKey="expectedSales" options={itemOptions} filters={itemFilters} onChange={setItemFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((row) => (
                      <tr key={row.itemCode}>
                        <td>{row.itemCode}</td>
                        <td>{row.itemName}</td>
                        <td>{row.category}</td>
                        <td>{row.mergedFrom || "—"}</td>
                        <td>{formatPercent(row.gpPercent)}</td>
                        <td>{row.eligibleMonthCount}</td>
                        <td>{monthLabel(row.peakMonth)}</td>
                        <td>{formatAmount(row.peakSales)}</td>
                        <td>{monthLabel(row.expectedMonth)}</td>
                        <td>{formatQty(row.expectedQty)}</td>
                        <td className="moduleBiTotalCol">{formatAmount(row.expectedSales)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td>{visibleItems.length}</td>
                      <td />
                      <td />
                      <td />
                      <td />
                      <td />
                      <td />
                      <td />
                      <td>{formatQty(itemTotals.expectedQty)}</td>
                      <td className="moduleBiTotalCol">{formatAmount(itemTotals.expectedSales)}</td>
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
