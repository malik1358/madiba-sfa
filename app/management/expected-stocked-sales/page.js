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
    en: "Expected monthly sales if every qualifying item is in stock: each item’s second-highest completed month after company seasonal peaks are removed. Main view uses lifetime GP above 10%; a second view includes every item sold at a profit (GP above 0%). Local products (LP*) are excluded.",
    ar: "المبيعات الشهرية المتوقعة إذا توفرت كل الأصناف المؤهلة: ثاني أعلى شهر مكتمل لكل صنف بعد استبعاد أشهر الذروة الموسمية. العرض الرئيسي لهامش أعلى من 10%، وعرض ثانٍ لكل صنف بُيع بربح (هامش أعلى من 0%). أصناف LP* مستثناة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  categorySummary: { en: "Category summary (GP > 10%)", ar: "ملخص الفئات (هامش > 10%)" },
  profitableSummary: { en: "All profitable items (GP > 0%)", ar: "كل الأصناف الرابحة (هامش > 0%)" },
  itemDetail: { en: "Item detail (GP > 10%)", ar: "تفاصيل الأصناف (هامش > 10%)" },
  profitableItems: { en: "Item detail (GP > 0%)", ar: "تفاصيل الأصناف (هامش > 0%)" },
  category: { en: "Category", ar: "الفئة" },
  items: { en: "Items", ar: "الأصناف" },
  item: { en: "Item", ar: "الصنف" },
  itemCode: { en: "Item code", ar: "رمز الصنف" },
  mergedFrom: { en: "Merged codes", ar: "رموز مدمجة" },
  gpPercent: { en: "Lifetime GP %", ar: "هامش العمر %" },
  expectedGpPercent: { en: "Expected margin %", ar: "الهامش المتوقع %" },
  expectedProfit: { en: "Expected GP SAR", ar: "الربح المتوقع" },
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
    en: "No qualifying items with non-seasonal monthly sales for this GP cut.",
    ar: "لا توجد أصناف مؤهلة بمبيعات شهرية غير موسمية لهذا حد الهامش.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
  hint: {
    en: "Company seasonal peaks are the top completed months at least 25% above the median monthly sales (up to three). Those calendar months are dropped for every item. Replacement item codes are merged so history is not double-counted. Expected SAR / GP are from the second-highest remaining month. Lifetime GP % filters which items appear. Amounts are ex-VAT.",
    ar: "ذروة الشركة الموسمية هي أعلى الأشهر المكتملة التي تزيد 25% على الأقل عن وسيط المبيعات الشهرية (حتى ثلاثة). تُستبعد تلك الأشهر التقويمية. رموز الأصناف البديلة تُدمج. القيمة/الربح المتوقعان من ثاني أعلى شهر متبقٍ. هامش العمر يحدد الأصناف. المبالغ بدون ضريبة.",
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
  if (key === "expectedProfit") return formatAmount(row.expectedProfit);
  if (key === "expectedGpPercent") return formatPercent(row.expectedGpPercent);
  return "";
}

function categoryCellValue(row, key) {
  if (key === "category") return row.category || "";
  if (key === "itemCount") return String(row.itemCount ?? "");
  if (key === "expectedSales") return formatAmount(row.expectedSales);
  if (key === "expectedProfit") return formatAmount(row.expectedProfit);
  if (key === "expectedGpPercent") return formatPercent(row.expectedGpPercent);
  if (key === "sharePercent") return formatPercent(row.sharePercent);
  return "";
}

function sumItemTotals(rows) {
  return (rows || []).reduce((sum, row) => ({
    expectedSales: sum.expectedSales + Number(row.expectedSales || 0),
    expectedProfit: sum.expectedProfit + Number(row.expectedProfit || 0),
    expectedQty: sum.expectedQty + Number(row.expectedQty || 0),
  }), { expectedSales: 0, expectedProfit: 0, expectedQty: 0 });
}

function sumCategoryTotals(rows) {
  return (rows || []).reduce((sum, row) => ({
    itemCount: sum.itemCount + Number(row.itemCount || 0),
    expectedSales: sum.expectedSales + Number(row.expectedSales || 0),
    expectedProfit: sum.expectedProfit + Number(row.expectedProfit || 0),
  }), { itemCount: 0, expectedSales: 0, expectedProfit: 0 });
}

function marginFromTotals(totals) {
  const sales = Number(totals?.expectedSales || 0);
  const profit = Number(totals?.expectedProfit || 0);
  if (!sales) return null;
  return (profit / sales) * 100;
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
  const profitableItemRows = useMemo(
    () => (Array.isArray(report?.profitableRows) ? report.profitableRows : []),
    [report],
  );
  const profitableCategoryRows = useMemo(
    () => (Array.isArray(report?.profitableCategoryRows) ? report.profitableCategoryRows : []),
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
  const {
    filters: profitableItemFilters,
    options: profitableItemOptions,
    visibleRows: visibleProfitableItems,
    setFilter: setProfitableItemFilter,
  } = useBiExcelFilters(profitableItemRows, EXPECTED_STOCKED_SALES_ITEM_FILTER_KEYS, itemFilterValueOf);
  const {
    filters: profitableCategoryFilters,
    options: profitableCategoryOptions,
    visibleRows: visibleProfitableCategories,
    setFilter: setProfitableCategoryFilter,
  } = useBiExcelFilters(profitableCategoryRows, EXPECTED_STOCKED_SALES_CATEGORY_FILTER_KEYS, categoryFilterValueOf);

  const itemTotals = useMemo(() => sumItemTotals(visibleItems), [visibleItems]);
  const categoryTotals = useMemo(() => sumCategoryTotals(visibleCategories), [visibleCategories]);
  const profitableItemTotals = useMemo(() => sumItemTotals(visibleProfitableItems), [visibleProfitableItems]);
  const profitableCategoryTotals = useMemo(
    () => sumCategoryTotals(visibleProfitableCategories),
    [visibleProfitableCategories],
  );

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

  function renderCategoryTable({
    filename,
    sheetName,
    rows,
    visibleRows,
    options,
    filters,
    setFilter,
    totals,
  }) {
    if (!rows.length) return <div className="moduleHint">{t("noRows")}</div>;
    return (
      <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label={t("category")} filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("items")} filterKey="itemCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("share")} filterKey="sharePercent" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedSales")} filterKey="expectedSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedProfit")} filterKey="expectedProfit" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedGpPercent")} filterKey="expectedGpPercent" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.category}>
                <td>{row.category}</td>
                <td>{row.itemCount}</td>
                <td>{formatPercent(row.sharePercent)}</td>
                <td>{formatAmount(row.expectedSales)}</td>
                <td>{formatAmount(row.expectedProfit)}</td>
                <td className="moduleBiTotalCol">{formatPercent(row.expectedGpPercent)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{t("total")}</td>
              <td>{totals.itemCount}</td>
              <td>{formatPercent(100)}</td>
              <td>{formatAmount(totals.expectedSales)}</td>
              <td>{formatAmount(totals.expectedProfit)}</td>
              <td className="moduleBiTotalCol">{formatPercent(marginFromTotals(totals))}</td>
            </tr>
          </tfoot>
        </table>
      </ExportableTable>
    );
  }

  function renderItemTable({
    filename,
    sheetName,
    rows,
    visibleRows,
    options,
    filters,
    setFilter,
    totals,
  }) {
    if (!rows.length) return <div className="moduleHint">{t("noRows")}</div>;
    return (
      <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label={t("itemCode")} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("item")} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("category")} filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("mergedFrom")} filterKey="mergedFrom" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("gpPercent")} filterKey="gpPercent" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("eligibleMonths")} filterKey="eligibleMonthCount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("peakMonth")} filterKey="peakMonth" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("peakSales")} filterKey="peakSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedMonth")} filterKey="expectedMonth" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedQty")} filterKey="expectedQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedSales")} filterKey="expectedSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedProfit")} filterKey="expectedProfit" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={t("expectedGpPercent")} filterKey="expectedGpPercent" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
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
                <td>{formatAmount(row.expectedSales)}</td>
                <td>{formatAmount(row.expectedProfit)}</td>
                <td className="moduleBiTotalCol">{formatPercent(row.expectedGpPercent)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{t("total")}</td>
              <td>{visibleRows.length}</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td>{formatQty(totals.expectedQty)}</td>
              <td>{formatAmount(totals.expectedSales)}</td>
              <td>{formatAmount(totals.expectedProfit)}</td>
              <td className="moduleBiTotalCol">{formatPercent(marginFromTotals(totals))}</td>
            </tr>
          </tfoot>
        </table>
      </ExportableTable>
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
              {t("expectedProfit")}: {formatAmount(report?.summary?.expectedProfit || 0)}
              {" · "}
              {t("expectedGpPercent")}: {formatPercent(report?.summary?.expectedGpPercent)}
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
            ) : renderCategoryTable({
              filename: "expected-stocked-sales-categories-gp10",
              sheetName: "GP gt 10",
              rows: categoryRows,
              visibleRows: visibleCategories,
              options: categoryOptions,
              filters: categoryFilters,
              setFilter: setCategoryFilter,
              totals: categoryTotals,
            })}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("profitableSummary")}</h2>
              <span>{formatAmount(report?.profitableSummary?.expectedSales || 0)}</span>
            </div>
            <p className="moduleHint">
              {t("items")}: {report?.profitableSummary?.itemCount ?? 0}
              {" · "}
              {t("expectedSales")}: {formatAmount(report?.profitableSummary?.expectedSales || 0)}
              {" · "}
              {t("expectedProfit")}: {formatAmount(report?.profitableSummary?.expectedProfit || 0)}
              {" · "}
              {t("expectedGpPercent")}: {formatPercent(report?.profitableSummary?.expectedGpPercent)}
              {" · "}
              {t("minGp")}: {formatPercent(report?.profitableMinGpPercent ?? 0)}
            </p>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : renderCategoryTable({
              filename: "expected-stocked-sales-categories-gp0",
              sheetName: "GP gt 0",
              rows: profitableCategoryRows,
              visibleRows: visibleProfitableCategories,
              options: profitableCategoryOptions,
              filters: profitableCategoryFilters,
              setFilter: setProfitableCategoryFilter,
              totals: profitableCategoryTotals,
            })}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("itemDetail")}</h2>
              <span>{visibleItems.length}</span>
            </div>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : renderItemTable({
              filename: "expected-stocked-sales-items-gp10",
              sheetName: "Items GP10",
              rows: itemRows,
              visibleRows: visibleItems,
              options: itemOptions,
              filters: itemFilters,
              setFilter: setItemFilter,
              totals: itemTotals,
            })}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("profitableItems")}</h2>
              <span>{visibleProfitableItems.length}</span>
            </div>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : renderItemTable({
              filename: "expected-stocked-sales-items-gp0",
              sheetName: "Items GP0",
              rows: profitableItemRows,
              visibleRows: visibleProfitableItems,
              options: profitableItemOptions,
              filters: profitableItemFilters,
              setFilter: setProfitableItemFilter,
              totals: profitableItemTotals,
            })}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
