"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ExportableTable from "../../components/ExportableTable";
import { translate } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  COVER_BUCKET_KEYS,
  enrichPhysicalCategoriesWithBuckets,
} from "../../lib/inventoryForwardCover";
import { defaultMisAsOfDate } from "../../lib/misPrepared";
import { getSupabaseClient } from "../../lib/supabase";
import { getKsaDateString } from "../../lib/workdayActivity";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  all: { en: "All", ar: "الكل" },
  publishedPhysical: { en: "Published physical", ar: "المخزون المنشور" },
  latestStock: { en: "Latest stock", ar: "أحدث مخزون" },
  loadingLive: { en: "Loading latest stock…", ar: "جاري تحميل أحدث مخزون…" },
  clearDrill: { en: "Clear drill", ar: "مسح التصفية" },
  drillHint: { en: "Click a category or bucket value to open the item list.", ar: "انقر الفئة أو قيمة الشريحة لفتح قائمة الأصناف." },
  itemDrillNeedsLive: { en: "Switch to Latest stock to drill into items.", ar: "فعّل أحدث مخزون لعرض الأصناف." },
  showingDrill: { en: "Showing", ar: "عرض" },
  noLiveStock: { en: "Latest EOD stock is not available.", ar: "أحدث مخزون نهاية اليوم غير متوفر." },
};

function amountInt(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function coverDaysTone(days) {
  if (days == null) return "";
  return days > 90 ? " moduleBiMonthCell--down" : " moduleBiMonthCell--up";
}

function normCoverCat(value) {
  return String(value || "").trim().toLowerCase();
}

function bucketCellValue(row, bucketKey) {
  const amount = Number(row?.bucketAmounts?.[bucketKey] || 0);
  return amount > 0 ? amount : null;
}

function InventoryLinkButton({ children, onClick, title }) {
  return (
    <button
      type="button"
      className="moduleLinkButton"
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: "inherit",
        font: "inherit",
        fontWeight: 700,
        textDecoration: "underline",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function InventoryCoverCategoryTable({
  rows,
  language,
  totalDaysOnHand,
  coverWindowDays = 30,
  onCategoryDrill,
  onBucketDrill,
  canDrillItems,
}) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const windowDays = Math.max(1, Number(coverWindowDays) || 30);
  const keys = ["category", "amount", "sales30d", "forwardCoverDays", ...COVER_BUCKET_KEYS];
  const valueOf = useCallback((row, key) => {
    if (key === "forwardCoverDays") {
      const days = row.forwardCoverDays ?? row.days;
      return days != null ? String(days) : "—";
    }
    if (COVER_BUCKET_KEYS.includes(key)) {
      const amount = bucketCellValue(row, key);
      return amount == null ? "—" : amount;
    }
    if (key === "sales30d") return row.sales30d ?? 0;
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const stockTotal = visibleRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sales30dTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales30d || 0), 0);
  const daysTotal = sales30dTotal
    ? Math.round(stockTotal / (sales30dTotal / windowDays))
    : (totalDaysOnHand != null ? totalDaysOnHand : null);
  const bucketTotals = Object.fromEntries(
    COVER_BUCKET_KEYS.map((key) => [
      key,
      visibleRows.reduce((sum, row) => sum + Number(row.bucketAmounts?.[key] || 0), 0),
    ]),
  );

  return (
    <ExportableTable filename="mis-inventory-categories" sheetName="Inventory" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 12 }}>
        <table className="moduleTable moduleBiTable misInventoryCoverTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="misInventoryStickyCol" />
              <BiExcelHead label="Stock value" filterKey="amount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
              <BiExcelHead label={`Last ${windowDays}d sales`} filterKey="sales30d" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Forward cover (days)" filterKey="forwardCoverDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
              {COVER_BUCKET_KEYS.map((key) => (
                <BiExcelHead
                  key={key}
                  label={key}
                  filterKey={key}
                  options={options}
                  filters={filters}
                  onChange={setFilter}
                  allLabel={t("all")}
                  className="moduleBiTotalCol"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const days = row.forwardCoverDays ?? row.days;
              return (
                <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                  <td className="misInventoryStickyCol">
                    <InventoryLinkButton
                      title={canDrillItems ? t("drillHint") : t("itemDrillNeedsLive")}
                      onClick={() => onCategoryDrill?.(row.category)}
                    >
                      {row.category}
                    </InventoryLinkButton>
                  </td>
                  <td className="moduleBiTotalCol">{amountInt(row.amount)}</td>
                  <td>{amountInt(row.sales30d)}</td>
                  <td className={`moduleBiTotalCol${coverDaysTone(days)}`}>
                    {days != null ? amountInt(days) : "—"}
                  </td>
                  {COVER_BUCKET_KEYS.map((key) => {
                    const amount = bucketCellValue(row, key);
                    return (
                      <td key={key} className="moduleBiTotalCol">
                        {amount == null ? "—" : (
                          <InventoryLinkButton
                            title={canDrillItems ? t("drillHint") : t("itemDrillNeedsLive")}
                            onClick={() => onBucketDrill?.(row.category, key)}
                          >
                            {amountInt(amount)}
                          </InventoryLinkButton>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="misInventoryStickyCol"><strong>Total</strong></td>
              <td className="moduleBiTotalCol"><strong>{amountInt(stockTotal)}</strong></td>
              <td><strong>{amountInt(sales30dTotal)}</strong></td>
              <td className={`moduleBiTotalCol${coverDaysTone(daysTotal)}`}>
                <strong>{daysTotal != null ? amountInt(daysTotal) : "—"}</strong>
              </td>
              {COVER_BUCKET_KEYS.map((key) => (
                <td key={key} className="moduleBiTotalCol">
                  <strong>{bucketTotals[key] ? amountInt(bucketTotals[key]) : "—"}</strong>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function InventoryCoverItemTable({ rows, language, coverWindowDays = 30 }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const windowDays = Math.max(1, Number(coverWindowDays) || 30);
  const keys = ["itemCode", "itemName", "category", "amount", "sales30d", "forwardCoverDays", ...COVER_BUCKET_KEYS];
  const valueOf = useCallback((row, key) => {
    if (key === "forwardCoverDays") {
      return row.forwardCoverDays != null ? String(row.forwardCoverDays) : "—";
    }
    if (COVER_BUCKET_KEYS.includes(key)) {
      const amount = bucketCellValue(row, key);
      return amount == null ? "—" : amount;
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const stockTotal = visibleRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sales30dTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales30d || 0), 0);
  const daysTotal = sales30dTotal ? Math.round(stockTotal / (sales30dTotal / windowDays)) : null;
  const bucketTotals = Object.fromEntries(
    COVER_BUCKET_KEYS.map((key) => [
      key,
      visibleRows.reduce((sum, row) => sum + Number(row.bucketAmounts?.[key] || 0), 0),
    ]),
  );

  return (
    <ExportableTable filename="mis-inventory-items" sheetName="Items" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 8 }}>
        <table className="moduleTable moduleBiTable misInventoryCoverTable">
          <thead>
            <tr>
              <BiExcelHead label="Item code" filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="misInventoryStickyCol" />
              <BiExcelHead label="Item name" filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Stock value" filterKey="amount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
              <BiExcelHead label={`Last ${windowDays}d sales`} filterKey="sales30d" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Forward cover (days)" filterKey="forwardCoverDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
              {COVER_BUCKET_KEYS.map((key) => (
                <BiExcelHead
                  key={key}
                  label={key}
                  filterKey={key}
                  options={options}
                  filters={filters}
                  onChange={setFilter}
                  allLabel={t("all")}
                  className="moduleBiTotalCol"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.itemCode} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td className="misInventoryStickyCol">{row.itemCode}</td>
                <td>{row.itemName}</td>
                <td>{row.category}</td>
                <td className="moduleBiTotalCol">{amountInt(row.amount)}</td>
                <td>{amountInt(row.sales30d)}</td>
                <td className={`moduleBiTotalCol${coverDaysTone(row.forwardCoverDays)}`}>
                  {row.forwardCoverDays != null ? amountInt(row.forwardCoverDays) : "—"}
                </td>
                {COVER_BUCKET_KEYS.map((key) => {
                  const amount = bucketCellValue(row, key);
                  return (
                    <td key={key} className="moduleBiTotalCol">
                      {amount == null ? "—" : amountInt(amount)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="misInventoryStickyCol" colSpan={3}><strong>Total</strong></td>
              <td className="moduleBiTotalCol"><strong>{amountInt(stockTotal)}</strong></td>
              <td><strong>{amountInt(sales30dTotal)}</strong></td>
              <td className={`moduleBiTotalCol${coverDaysTone(daysTotal)}`}>
                <strong>{daysTotal != null ? amountInt(daysTotal) : "—"}</strong>
              </td>
              {COVER_BUCKET_KEYS.map((key) => (
                <td key={key} className="moduleBiTotalCol">
                  <strong>{bucketTotals[key] ? amountInt(bucketTotals[key]) : "—"}</strong>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

export default function InventoryCoverPanel({ preparedInventory, language, asOfDate }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const [source, setSource] = useState(preparedInventory ? "physical" : "eod");
  const [liveCover, setLiveCover] = useState(null);
  const [liveError, setLiveError] = useState("");
  const [liveLoading, setLiveLoading] = useState(false);
  const [drill, setDrill] = useState(null);

  const physicalCategories = useMemo(
    () => enrichPhysicalCategoriesWithBuckets(preparedInventory?.categories || []),
    [preparedInventory],
  );

  const activeCover = source === "eod" ? liveCover : {
    source: "physical",
    stockDate: preparedInventory?.coverTo || asOfDate || null,
    physical: preparedInventory?.physical,
    sales30d: preparedInventory?.sales30d,
    days: preparedInventory?.days,
    coverWindowDays: preparedInventory?.coverWindowDays || 30,
    coverFrom: preparedInventory?.coverFrom,
    coverTo: preparedInventory?.coverTo,
    categories: physicalCategories,
    items: [],
  };

  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    setLiveError("");
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) throw new Error("Please login again.");
      const params = new URLSearchParams({
        source: "eod",
        asOf: asOfDate || defaultMisAsOfDate(getKsaDateString()) || getKsaDateString(),
      });
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/business-dashboard/mis/inventory-cover?${params.toString()}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        90000,
      );
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || t("noLiveStock"));
      }
      if (!payload.cover) {
        setLiveCover(null);
        setLiveError(payload.message || t("noLiveStock"));
        return;
      }
      setLiveCover(payload.cover);
    } catch (err) {
      setLiveCover(null);
      setLiveError(err?.message || t("noLiveStock"));
    } finally {
      setLiveLoading(false);
    }
  }, [asOfDate, t]);

  useEffect(() => {
    if (source !== "eod") return undefined;
    if (liveCover || liveLoading) return undefined;
    loadLive();
    return undefined;
  }, [source, liveCover, liveLoading, loadLive]);

  const canDrillItems = source === "eod" && Array.isArray(activeCover?.items) && activeCover.items.length > 0;

  const openCategoryDrill = useCallback((category) => {
    if (!canDrillItems) {
      setSource("eod");
      setDrill({ category: String(category || ""), bucket: "" });
      return;
    }
    setDrill({ category: String(category || ""), bucket: "" });
    requestAnimationFrame(() => {
      document.getElementById("mis-inventory-drill")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [canDrillItems]);

  const openBucketDrill = useCallback((category, bucket) => {
    if (!canDrillItems) {
      setSource("eod");
      setDrill({ category: String(category || ""), bucket: String(bucket || "") });
      return;
    }
    setDrill({ category: String(category || ""), bucket: String(bucket || "") });
    requestAnimationFrame(() => {
      document.getElementById("mis-inventory-drill")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [canDrillItems]);

  const drillItems = useMemo(() => {
    if (!drill || !canDrillItems) return [];
    const cat = normCoverCat(drill.category);
    const bucket = String(drill.bucket || "");
    return (activeCover.items || []).filter((row) => {
      if (cat && normCoverCat(row.category) !== cat) return false;
      if (bucket && row.bucket !== bucket) return false;
      return true;
    });
  }, [drill, canDrillItems, activeCover]);

  return (
    <>
      <div className="moduleToolbar" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`moduleInlineButton${source === "physical" ? " moduleInlineButton--active" : ""}`}
          onClick={() => { setSource("physical"); setDrill(null); }}
          disabled={!preparedInventory}
        >
          {t("publishedPhysical")}
        </button>
        <button
          type="button"
          className={`moduleInlineButton${source === "eod" ? " moduleInlineButton--active" : ""}`}
          onClick={() => { setSource("eod"); }}
        >
          {t("latestStock")}
        </button>
        {source === "eod" && activeCover?.stockDate ? (
          <span className="moduleHint">EOD {activeCover.stockDate}</span>
        ) : null}
        {source === "eod" && liveLoading ? <span className="moduleHint">{t("loadingLive")}</span> : null}
      </div>
      <p className="misMeta">{t("drillHint")}</p>
      {liveError && source === "eod" ? <p className="misRemark">{liveError}</p> : null}

      {activeCover?.categories?.length ? (
        <InventoryCoverCategoryTable
          rows={activeCover.categories}
          language={language}
          totalDaysOnHand={activeCover.days}
          coverWindowDays={activeCover.coverWindowDays || 30}
          onCategoryDrill={openCategoryDrill}
          onBucketDrill={openBucketDrill}
          canDrillItems={canDrillItems}
        />
      ) : (
        source === "eod" && !liveLoading
          ? <p className="misRemark">{t("noLiveStock")}</p>
          : (source === "physical" && !preparedInventory
            ? <p className="misRemark">Physical inventory is not published yet.</p>
            : null)
      )}

      <div id="mis-inventory-drill" style={{ marginTop: 16 }}>
        {drill ? (
          <>
            <div className="moduleToolbar" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="moduleHint">
                {t("showingDrill")}: {drill.category || "—"}
                {drill.bucket ? ` · ${drill.bucket}` : ""}
              </span>
              <button type="button" className="moduleInlineButton" onClick={() => setDrill(null)}>
                {t("clearDrill")}
              </button>
            </div>
            {canDrillItems ? (
              <InventoryCoverItemTable
                rows={drillItems}
                language={language}
                coverWindowDays={activeCover?.coverWindowDays || 30}
              />
            ) : (
              <p className="misRemark">{liveLoading ? t("loadingLive") : t("itemDrillNeedsLive")}</p>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
