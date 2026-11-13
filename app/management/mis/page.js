"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { defaultMisAsOfDate } from "../../lib/misPrepared";
import { getKsaDateString } from "../../lib/workdayActivity";
import { compactChartNumber } from "../../lib/growthCharts";
import { MIS_PORTFOLIO_EXCLUDE } from "../../lib/misReport";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { GrowthTrendChart } from "../business-dashboard/GrowthCharts";
import InventoryCoverPanel from "./InventoryCoverPanel";
import CategoryGrowthFilters from "../business-dashboard/CategoryGrowthFilters";
import {
  emptyGrowthFilters,
  hasActiveGrowthFilters,
  normalizeGrowthFilters,
} from "../../lib/categoryGrowth";

const PORTFOLIO_EXCLUDE_SET = new Set(
  MIS_PORTFOLIO_EXCLUDE.map((value) => String(value || "").trim().toLowerCase()),
);

const MIS_FETCH_REBUILD_MS = 240_000;
const MIS_FETCH_FILTER_MS = 240_000;
const MIS_FETCH_PREPARED_MS = 25_000;

const TEXT = {
  title: { en: "Management MIS", ar: "تقرير الإدارة" },
  subtitle: {
    en: "Prepared month-end pack from BI sales, receipts, and outstanding.",
    ar: "حزمة نهاية الشهر الجاهزة من المبيعات والتحصيل والمستحقات.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  bi: { en: "Business Intelligence", ar: "ذكاء الأعمال" },
  loading: { en: "Loading prepared MIS…", ar: "جاري تحميل تقرير الإدارة…" },
  preparing: { en: "Preparing month-end MIS in the backend…", ar: "جاري تجهيز تقرير الإدارة في الخلفية…" },
  asOf: { en: "As of", ar: "حتى" },
  refresh: { en: "Refresh", ar: "تحديث" },
  denied: { en: "MIS is available to admin and manager only.", ar: "تقرير الإدارة متاح للمدير فقط." },
  noData: { en: "No MIS data returned.", ar: "لا توجد بيانات." },
  notPrepared: {
    en: "Month-end MIS is not prepared yet. Tap Refresh once to build it in the backend.",
    ar: "تقرير الإدارة غير جاهز بعد. اضغط تحديث مرة واحدة لبنائه في الخلفية.",
  },
  preparedAt: { en: "Prepared", ar: "جاهز" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  slideOf: { en: "Slide", ar: "شريحة" },
  all: { en: "All", ar: "الكل" },
  sliceDice: { en: "Slice and dice (all slides)", ar: "تقطيع وتصفية (كل الشرائح)" },
  sliceDiceScope: {
    en: "One filter set for the full Management MIS deck — every slide uses the same slice.",
    ar: "مجموعة تصفية واحدة لعرض تقرير الإدارة بالكامل — كل الشريحات تستخدم نفس القطاع.",
  },
  showFilters: { en: "Show", ar: "إظهار" },
  hideFilters: { en: "Hide", ar: "إخفاء" },
  filtersHint: {
    en: "Same salesman and field filters as Business Intelligence. Apply recalculates the entire MIS pack for all slides at once (does not overwrite the prepared company snapshot). Clear returns to the company pack.",
    ar: "نفس عوامل تصفية المندوب والحقول في ذكاء الأعمال. التطبيق يعيد حساب تقرير الإدارة بالكامل لكل الشرائح دفعة واحدة (دون استبدال الحزمة الجاهزة للشركة). المسح يعيد الحزمة الجاهزة للشركة.",
  },
  filtering: { en: "Applying filters to all slides…", ar: "جاري تطبيق التصفية على كل الشرائح…" },
  filteredStamp: { en: "Filtered · all slides", ar: "مُصفّى · كل الشرائح" },
  timeoutRebuild: {
    en: "Refresh timed out on this device. The backend may still be preparing — wait a moment and open MIS again without Refresh, or try Refresh once more.",
    ar: "انتهت مهلة التحديث على هذا الجهاز. قد يستمر التجهيز في الخلفية — انتظر ثم افتح التقرير دون تحديث، أو أعد المحاولة.",
  },
  timeoutRebuildRecovered: {
    en: "Refresh took longer than expected, but a prepared pack is available — loaded the saved snapshot.",
    ar: "استغرق التحديث وقتاً أطول من المتوقع، لكن الحزمة الجاهزة متوفرة — تم تحميل اللقطة المحفوظة.",
  },
  timeoutFilter: {
    en: "Filter apply timed out. Your previous slide view is unchanged — try again or Clear to return to the company pack.",
    ar: "انتهت مهلة تطبيق التصفية. العرض السابق كما هو — أعد المحاولة أو امسح للعودة إلى حزمة الشركة.",
  },
};

function money(value, { digits = 1 } = {}) {
  const n = Number(value) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}SAR ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}SAR ${(abs / 1_000).toFixed(digits)}K`;
  return `${sign}SAR ${abs.toFixed(0)}`;
}

/** Table amounts: plain integer, no currency prefix. */
function amountInt(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function momNote(momPct, extra = "") {
  const base = `${pct(momPct)} vs prior month`;
  return extra ? `${base} · ${extra}` : base;
}

function pctChangeSafe(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur / prev) - 1) * 1000) / 10;
}

function momCellClass(momPct, { current = false } = {}) {
  const parts = [];
  if (current) parts.push("moduleBiMonthCell--current");
  if (momPct == null || !Number.isFinite(Number(momPct))) return parts.join(" ") || undefined;
  if (Number(momPct) > 0) parts.push("moduleBiMonthCell--up");
  else if (Number(momPct) < 0) parts.push("moduleBiMonthCell--down");
  return parts.join(" ") || undefined;
}

function amountWithMom(value, momPct) {
  return (
    <span className="moduleBiAmountDelta">
      <strong>{amountInt(value)}</strong>
      {momPct == null || !Number.isFinite(Number(momPct)) ? null : <em>{pct(momPct)}</em>}
    </span>
  );
}

function momTrendClass(value) {
  const n = Number(value) || 0;
  if (n > 0) return "moduleBiMonthCell--up";
  if (n < 0) return "moduleBiMonthCell--down";
  return "";
}

function lossClass(value) {
  const n = Number(value) || 0;
  if (n > 0) return "moduleBiMonthCell--down";
  if (n < 0) return "moduleBiMonthCell--up";
  return "";
}

function cumulativeSeries(months, valuesByMonth) {
  let running = 0;
  return months.map((ym) => {
    running += Number(valuesByMonth?.[ym] || 0);
    return running;
  });
}

function monthLabel(ym) {
  const [y, m] = String(ym || "").split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] || m} ${String(y).slice(2)}`;
}

/** AR / DSO / inventory-days MoM: lower is better → up=red, down=green. */
function arMomNoteClass(momPct) {
  if (momPct == null || !Number.isFinite(Number(momPct)) || Number(momPct) === 0) return "";
  return Number(momPct) > 0 ? "misKpiNote--worse" : "misKpiNote--better";
}

function daysOnHandValue(days, momPct) {
  if (days == null || !Number.isFinite(Number(days))) return "—";
  if (momPct == null || !Number.isFinite(Number(momPct))) return String(days);
  return `${days} (${pct(momPct)})`;
}

function Kpi({ label, value, note, noteClassName = "", tone = "teal" }) {
  return (
    <div className={`misKpi misKpi--${tone}`}>
      <div className="misKpiLabel">{label}</div>
      <div className="misKpiValue">{value}</div>
      {note ? <div className={`misKpiNote${noteClassName ? ` ${noteClassName}` : ""}`}>{note}</div> : null}
    </div>
  );
}

/** Collapsible BI-style slice/dice filters — closed by default so slides stay readable. */
function MisFilterDrawer({ language, open, onToggle, activeCount, children }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  return (
    <div className={`misFilterDrawer${open ? " misFilterDrawer--open" : ""}`}>
      <button
        type="button"
        className="misFilterDrawerToggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="misFilterDrawerChevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="misFilterDrawerTitle">{t("sliceDice")}</span>
        {activeCount > 0 ? <span className="misFilterDrawerCount">{activeCount}</span> : null}
        <span className="misFilterDrawerAction">{open ? t("hideFilters") : t("showFilters")}</span>
      </button>
      {open ? (
        <div className="misFilterDrawerBody">
          <p className="misFilterDrawerScope">{t("sliceDiceScope")}</p>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function resolveSlideIndexAfterReport(nextReport, slideIdBefore, language) {
  if (!nextReport) return 0;
  const nextSlides = buildSlides(nextReport, language);
  if (slideIdBefore) {
    const idx = nextSlides.findIndex((slide) => slide.id === slideIdBefore);
    if (idx >= 0) return idx;
  }
  return 0;
}

function BarRow({ label, value, max, highlight }) {
  const width = max > 0 ? Math.max(4, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className={`misBarRow${highlight ? " misBarRow--hi" : ""}`}>
      <div className="misBarLabel">{label}</div>
      <div className="misBarTrack">
        <div className="misBarFill" style={{ width: `${width}%` }} />
      </div>
      <div className="misBarValue">{money(value)}</div>
    </div>
  );
}

function Slide({ eyebrow, title, children, variant = "" }) {
  return (
    <section className={`misSlide${variant ? ` misSlide--${variant}` : ""}`}>
      <div className="misSlideHead">
        <div className="misEyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      <div className="misSlideBody">{children}</div>
    </section>
  );
}

function CategoryTable({
  rows,
  language,
  asOfMonthLabel = "This month",
  previousMonthLabel = "Last month",
}) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["category", "sales", "previousSales", "gp", "previousGp", "gpPct", "previousGpPct"];
  const valueOf = useCallback((row, key) => {
    if (key === "gpPct") {
      const pctValue = row.gpPct != null ? Number(row.gpPct) : (Number(row.sales) ? (row.gp / row.sales) * 100 : null);
      return pctValue != null && Number.isFinite(pctValue) ? `${pctValue.toFixed(1)}%` : "—";
    }
    if (key === "previousGpPct") {
      const pctValue = row.previousGpPct != null
        ? Number(row.previousGpPct)
        : (Number(row.previousSales) ? (row.previousGp / row.previousSales) * 100 : null);
      return pctValue != null && Number.isFinite(pctValue) ? `${pctValue.toFixed(1)}%` : "—";
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const salesTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
  const previousSalesTotal = visibleRows.reduce((sum, row) => sum + Number(row.previousSales || 0), 0);
  const gpTotal = visibleRows.reduce((sum, row) => sum + Number(row.gp || 0), 0);
  const previousGpTotal = visibleRows.reduce((sum, row) => sum + Number(row.previousGp || 0), 0);
  const salesMomTotal = pctChangeSafe(salesTotal, previousSalesTotal);
  const gpMomTotal = pctChangeSafe(gpTotal, previousGpTotal);
  const gpPctTotal = salesTotal ? Math.round((gpTotal / salesTotal) * 1000) / 10 : null;
  const previousGpPctTotal = previousSalesTotal
    ? Math.round((previousGpTotal / previousSalesTotal) * 1000) / 10
    : null;

  return (
    <ExportableTable filename="mis-categories" sheetName="Categories" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={`${asOfMonthLabel} sales`} filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label={`${previousMonthLabel} sales`} filterKey="previousSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={`${asOfMonthLabel} GP`} filterKey="gp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label={`${previousMonthLabel} GP`} filterKey="previousGp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={`${asOfMonthLabel} GP%`} filterKey="gpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label={`${previousMonthLabel} GP%`} filterKey="previousGpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.category}</td>
                <td className={momCellClass(row.salesMomPct, { current: true })}>
                  {amountWithMom(row.sales, row.salesMomPct)}
                </td>
                <td>{amountInt(row.previousSales)}</td>
                <td className={momCellClass(row.gpMomPct, { current: true })}>
                  {amountWithMom(row.gp, row.gpMomPct)}
                </td>
                <td>{amountInt(row.previousGp)}</td>
                <td className="moduleBiMonthCell--current">
                  {row.sales || row.gpPct != null ? `${Number(row.gpPct ?? 0).toFixed(1)}%` : "—"}
                </td>
                <td className="moduleBiTotalCol">
                  {row.previousSales || row.previousGpPct != null ? `${Number(row.previousGpPct ?? 0).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className={momCellClass(salesMomTotal, { current: true })}>
                {amountWithMom(salesTotal, salesMomTotal)}
              </td>
              <td>{amountInt(previousSalesTotal)}</td>
              <td className={momCellClass(gpMomTotal, { current: true })}>
                {amountWithMom(gpTotal, gpMomTotal)}
              </td>
              <td>{amountInt(previousGpTotal)}</td>
              <td className="moduleBiMonthCell--current">
                {gpPctTotal != null ? `${gpPctTotal.toFixed(1)}%` : "—"}
              </td>
              <td className="moduleBiTotalCol">
                {previousGpPctTotal != null ? `${previousGpPctTotal.toFixed(1)}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function SalesmanTable({ rows, language }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["salesman", "sales"];
  const valueOf = useCallback((row, key) => row[key], []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const salesTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales || 0), 0);

  return (
    <ExportableTable filename="mis-salesmen" sheetName="Salesmen" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Salesman" filterKey="salesman" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Sales" filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.salesman} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.salesman}</td>
                <td className="moduleBiTotalCol">{amountInt(row.sales)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="moduleBiTotalCol">{amountInt(salesTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function RepeatCategoryMomTable({ rows, language, currentLabel = "This month", previousLabel = "Last month" }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["category", "previousSales", "sales", "delta", "salesMomPct"];
  const valueOf = useCallback((row, key) => {
    if (key === "salesMomPct") return row[key] != null ? `${row[key]}%` : "—";
    if (["previousSales", "sales", "delta"].includes(key)) return amountInt(row[key]);
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const priorTotal = visibleRows.reduce((acc, row) => acc + Number(row.previousSales || 0), 0);
  const salesTotal = visibleRows.reduce((acc, row) => acc + Number(row.sales || 0), 0);
  const deltaTotal = Math.round(salesTotal - priorTotal);

  return (
    <ExportableTable filename="mis-repeat-category-mom" sheetName="Repeat by category" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 12 }}>
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={`${previousLabel} repeat`} filterKey="previousSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label={`${currentLabel} repeat`} filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label="Difference" filterKey="delta" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="MoM%" filterKey="salesMomPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.category}</td>
                <td>{amountInt(row.previousSales)}</td>
                <td className="moduleBiMonthCell--current">{amountInt(row.sales)}</td>
                <td className={momTrendClass(row.delta)}>{amountInt(row.delta)}</td>
                <td className={`moduleBiTotalCol ${momTrendClass(row.salesMomPct)}`}>{pct(row.salesMomPct)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{amountInt(priorTotal)}</strong></td>
              <td className="moduleBiMonthCell--current"><strong>{amountInt(salesTotal)}</strong></td>
              <td className={momTrendClass(deltaTotal)}><strong>{amountInt(deltaTotal)}</strong></td>
              <td className={`moduleBiTotalCol ${momTrendClass(pctChangeSafe(salesTotal, priorTotal))}`}>
                <strong>{pct(pctChangeSafe(salesTotal, priorTotal))}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function normPortfolioCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function PortfolioCategoryMomTable({ rows, lossItems = [], language }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const [drillCategory, setDrillCategory] = useState(null);
  const keys = [
    "category", "previousSales", "sales", "salesLoss", "salesMomPct",
    "previousGp", "gp", "previousGpPct", "gpPct",
  ];
  const valueOf = useCallback((row, key) => {
    if (key === "salesMomPct" || key === "gpPct" || key === "previousGpPct") {
      return row[key] != null ? `${row[key]}%` : "—";
    }
    if (["previousSales", "sales", "salesLoss", "previousGp", "gp"].includes(key)) {
      return amountInt(row[key]);
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const sum = (key) => visibleRows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
  const priorSalesTotal = sum("previousSales");
  const salesTotal = sum("sales");
  const lossTotal = sum("salesLoss");
  const priorGpTotal = sum("previousGp");
  const gpTotal = sum("gp");

  const drillLossRows = useMemo(() => {
    if (!drillCategory) return [];
    const key = normPortfolioCategory(drillCategory);
    return lossItems.filter((row) => normPortfolioCategory(row.category) === key);
  }, [drillCategory, lossItems]);

  const toggleDrill = useCallback((category) => {
    setDrillCategory((current) => (current === category ? null : category));
  }, []);

  return (
    <>
    <ExportableTable filename="mis-portfolio-category-mom" sheetName="Portfolio MoM" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 12 }}>
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Prior sales" filterKey="previousSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Current sales" filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label="Sales Δ" filterKey="salesLoss" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="MoM%" filterKey="salesMomPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Prior GP" filterKey="previousGp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Current GP" filterKey="gp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label="Prior GP%" filterKey="previousGpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Current GP%" filterKey="gpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol moduleBiMonthCell--current" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.category}</td>
                <td>{amountInt(row.previousSales)}</td>
                <td className="moduleBiMonthCell--current">{amountInt(row.sales)}</td>
                <td className={lossClass(row.salesLoss)}>
                  {row.salesLoss > 0 ? (
                    <button
                      type="button"
                      className="misSalesLossLink"
                      title="Show items with sales loss"
                      aria-label="Show items with sales loss"
                      onClick={() => toggleDrill(row.category)}
                    >
                      {amountInt(row.salesLoss)}
                    </button>
                  ) : (
                    amountInt(row.salesLoss)
                  )}
                </td>
                <td className={momTrendClass(row.salesMomPct)}>{pct(row.salesMomPct)}</td>
                <td>{amountInt(row.previousGp)}</td>
                <td className="moduleBiMonthCell--current">{amountInt(row.gp)}</td>
                <td>{row.previousGpPct != null ? `${row.previousGpPct}%` : "—"}</td>
                <td className="moduleBiTotalCol moduleBiMonthCell--current">{row.gpPct != null ? `${row.gpPct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{amountInt(priorSalesTotal)}</strong></td>
              <td className="moduleBiMonthCell--current"><strong>{amountInt(salesTotal)}</strong></td>
              <td className={lossClass(lossTotal)}><strong>{amountInt(lossTotal)}</strong></td>
              <td className={momTrendClass(pctChangeSafe(salesTotal, priorSalesTotal))}>
                <strong>{pct(pctChangeSafe(salesTotal, priorSalesTotal))}</strong>
              </td>
              <td><strong>{amountInt(priorGpTotal)}</strong></td>
              <td className="moduleBiMonthCell--current"><strong>{amountInt(gpTotal)}</strong></td>
              <td><strong>{priorSalesTotal ? `${((priorGpTotal / priorSalesTotal) * 100).toFixed(1)}%` : "—"}</strong></td>
              <td className="moduleBiTotalCol moduleBiMonthCell--current">
                <strong>{salesTotal ? `${((gpTotal / salesTotal) * 100).toFixed(1)}%` : "—"}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
    {drillCategory ? (
      <div className="misDrillPanel">
        <div className="misDrillPanelHead">
          <h3>{`Sales loss items · ${drillCategory}`}</h3>
          <button type="button" className="misDrillPanelClose" onClick={() => setDrillCategory(null)}>
            Close
          </button>
        </div>
        {drillLossRows.length ? (
          <PortfolioTopLossItemsTable rows={drillLossRows} language={language} />
        ) : (
          <p className="misMeta">No item-level sales losses in the prepared pack for this category.</p>
        )}
      </div>
    ) : null}
    </>
  );
}

function PortfolioTopLossItemsTable({ rows, language }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = [
    "itemName", "itemCode", "category", "previousSales", "sales", "salesLoss", "salesMomPct",
    "previousGp", "gp", "gpPct",
  ];
  const valueOf = useCallback((row, key) => {
    if (key === "salesMomPct" || key === "gpPct") {
      return row[key] != null ? `${row[key]}%` : "—";
    }
    if (["previousSales", "sales", "salesLoss", "previousGp", "gp"].includes(key)) {
      return amountInt(row[key]);
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const rowKey = (row) => `${row.itemCode || ""}||${row.itemName}`;

  return (
    <ExportableTable filename="mis-portfolio-top-loss-items" sheetName="Top loss items" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 12 }}>
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Item" filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Code" filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Prior sales" filterKey="previousSales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Current sales" filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label="Sales loss" filterKey="salesLoss" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="MoM%" filterKey="salesMomPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Prior GP" filterKey="previousGp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Current GP" filterKey="gp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiMonthCell--current" />
              <BiExcelHead label="GP%" filterKey="gpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol moduleBiMonthCell--current" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={rowKey(row)} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.itemName}</td>
                <td>{row.itemCode || "—"}</td>
                <td>{row.category}</td>
                <td>{amountInt(row.previousSales)}</td>
                <td className="moduleBiMonthCell--current">{amountInt(row.sales)}</td>
                <td className={lossClass(row.salesLoss)}>{amountInt(row.salesLoss)}</td>
                <td className={momTrendClass(row.salesMomPct)}>{pct(row.salesMomPct)}</td>
                <td>{amountInt(row.previousGp)}</td>
                <td className="moduleBiMonthCell--current">{amountInt(row.gp)}</td>
                <td className="moduleBiTotalCol moduleBiMonthCell--current">{row.gpPct != null ? `${row.gpPct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ExportableTable>
  );
}

function MadibaTable({ rows, language }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["category", "sales", "gp", "gpPct"];
  const valueOf = useCallback((row, key) => {
    if (key === "gpPct") return `${row.gpPct ?? 0}%`;
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const salesTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
  const gpTotal = visibleRows.reduce((sum, row) => sum + Number(row.gp || 0), 0);

  return (
    <ExportableTable filename="mis-madiba" sheetName="MADIBA" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Focus" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Sales" filterKey="sales" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="GP" filterKey="gp" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="GP%" filterKey="gpPct" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.category}</td>
                <td>{amountInt(row.sales)}</td>
                <td>{amountInt(row.gp)}</td>
                <td className="moduleBiTotalCol">{`${row.gpPct ?? 0}%`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{amountInt(salesTotal)}</td>
              <td>{amountInt(gpTotal)}</td>
              <td className="moduleBiTotalCol">{salesTotal ? `${((gpTotal / salesTotal) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function buildSlides(report, language) {
  const months = report?.months || [];
  const colMax = Math.max(0, ...months.map((ym) => Number(report?.collections?.[ym] || 0)));
  const asOfYm = report.asOfMonth;
  const asOfCats = (report.categories || []).filter((row) => row.period === asOfYm);
  const asOfSalesmen = (report.salesmen || []).filter((row) => row.period === asOfYm);
  const asOfMadiba = (report.madiba || []).filter((row) => row.period === asOfYm);
  const portfolio = report.portfolio?.[asOfYm] || {};
  const prevPortfolio = report.previousMonth ? report.portfolio?.[report.previousMonth] || {} : {};
  const rangeLabel = months.length
    ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`
    : monthLabel(asOfYm);
  const salesSeries = [
    {
      key: "monthly-sales",
      label: "Monthly sales",
      color: "#0f4c5c",
      values: months.map((ym) => Number(report.monthlySales?.[ym] || 0)),
    },
    {
      key: "ytd-sales",
      label: "YTD run-rate",
      color: "#16a34a",
      dashed: true,
      values: cumulativeSeries(months, report.monthlySales),
    },
  ];
  const madibaFocusCats = ["Sundry", "Personal Care", "Fragrance", "Baby Care"];
  const madibaCatColors = {
    Sundry: "#0f4c5c",
    "Personal Care": "#0891b2",
    Fragrance: "#7c3aed",
    "Baby Care": "#ea580c",
  };
  const madibaSalesSeries = [
    {
      key: "madiba-total",
      label: "MADIBA focus total",
      color: "#0b2545",
      values: months.map((ym) => Number(report.monthlyMadibaSales?.[ym] || 0)),
    },
    ...madibaFocusCats.map((cat) => ({
      key: `madiba-${cat}`,
      label: cat,
      color: madibaCatColors[cat],
      values: months.map((ym) => Number(report.monthlyMadibaByCategory?.[ym]?.[cat] || 0)),
    })),
  ];
  const gpSeries = [
    {
      key: "monthly-gp",
      label: "Monthly GP",
      color: "#0f4c5c",
      values: months.map((ym) => Number(report.monthlyGp?.[ym] || 0)),
    },
    {
      key: "ytd-gp",
      label: "YTD GP run-rate",
      color: "#16a34a",
      dashed: true,
      values: cumulativeSeries(months, report.monthlyGp),
    },
  ];
  const repeatSeries = [
    {
      key: "repeat-pct",
      label: "Repeat mix %",
      color: "#0f4c5c",
      values: months.map((ym) => Number(report.monthlyRepeat?.[ym]?.pct || 0)),
    },
    {
      key: "repeat-sales",
      label: "Repeat sales (SAR)",
      color: "#2563eb",
      values: months.map((ym) => Number(report.monthlyRepeat?.[ym]?.sales || 0)),
    },
  ];

  return [
    {
      id: "cover",
      label: "Cover",
      node: (
        <Slide eyebrow="NOOR SHUKRAN · KSA NON FOOD" title={`FY${String(asOfYm).slice(2, 4)} management review`} variant="cover">
          <p className="misCoverLead">Performance through {monthLabel(asOfYm)}</p>
          <p className="misCoverTopics">Sales · Gross profit · Cash conversion · Inventory · Customer quality</p>
          <div className="misCoverBadge">{rangeLabel}</div>
          <p className="misRemark">{report.remarks.bottomLine}</p>
        </Slide>
      ),
    },
    {
      id: "momentum",
      label: "Momentum",
      node: (
        <Slide eyebrow="MOMENTUM" title={`Performance through ${monthLabel(asOfYm)}`}>
          <div className="misKpiGrid">
            <Kpi label="Sales" value={money(report.headline.sales)} note={momNote(report.headline.salesMomPct)} tone={report.headline.salesMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Gross profit" value={money(report.headline.gp)} note={momNote(report.headline.gpMomPct, `${report.headline.gpPct}% margin (was ${report.headline.previousGpPct}%)`)} tone={report.headline.gpMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Collections" value={money(report.headline.collection)} note={momNote(report.headline.collectionMomPct)} tone={report.headline.collectionMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Repeat mix" value={`${report.headline.repeatPct}%`} note={momNote(report.headline.repeatMomPct, `was ${report.headline.previousRepeatPct}% · ${money(report.headline.repeatSales)}`)} tone={Number(report.headline.repeatMomPct) >= 0 ? "green" : "orange"} />
            <Kpi
              label=">90-day AR"
              value={money(report.headline.gt90Ar)}
              note={report.headline.gt90ArMomPct == null
                ? `Total AR ${money(report.headline.totalAr)} · rolling 3m ~${report.headline.collectionDays3m ?? report.headline.collectionDays ?? "—"} days`
                : momNote(report.headline.gt90ArMomPct, `Total AR ${money(report.headline.totalAr)} · rolling 3m ~${report.headline.collectionDays3m ?? report.headline.collectionDays ?? "—"} days`)}
              noteClassName={arMomNoteClass(report.headline.gt90ArMomPct)}
              tone={report.headline.gt90ArMomPct == null || report.headline.gt90ArMomPct <= 0 ? "green" : "orange"}
            />
            <Kpi label="YTD sales" value={money(report.headline.ytdSales, { digits: 2 })} note={momNote(report.headline.ytdMomPct, `${report.headline.newCustomers} new customers`)} tone={Number(report.headline.ytdMomPct) >= 0 ? "green" : "orange"} />
          </div>
          <p className="misRemark">{report.remarks.momentum} {report.remarks.margin}</p>
        </Slide>
      ),
    },
    {
      id: "sales-gp",
      label: "Sales & GP",
      node: (
        <Slide eyebrow="SALES & GP" title="Sales and GP run-rate">
          <div className="misSplit">
            <div>
              <h3>Sales run-rate</h3>
              <GrowthTrendChart periods={months} series={salesSeries} periodLabel={monthLabel} formatValue={compactChartNumber} />
            </div>
            <div>
              <h3>Gross profit run-rate</h3>
              <GrowthTrendChart periods={months} series={gpSeries} periodLabel={monthLabel} formatValue={compactChartNumber} />
            </div>
          </div>
        </Slide>
      ),
    },
    {
      id: "cash",
      label: "Cash",
      node: (
        <Slide eyebrow="CASH" title="Collections and receivables">
          <div className="misSplit">
            <div>
              <h3>Monthly collections</h3>
              {months.map((ym) => (
                <BarRow key={`c-${ym}`} label={monthLabel(ym)} value={report.collections[ym]} max={colMax} highlight={ym === asOfYm} />
              ))}
            </div>
            <div>
              <h3>AR ageing vs prior month</h3>
              <div className="misKpiGrid misKpiGrid--compact">
                {Object.entries(report.headline.arBuckets || {}).map(([bucket, value]) => {
                  const mom = report.headline.arBucketMomPct?.[bucket];
                  const prior = report.headline.previousArBuckets?.[bucket];
                  const noteTone = arMomNoteClass(mom);
                  return (
                    <Kpi
                      key={bucket}
                      label={bucket}
                      value={money(value)}
                      note={mom == null ? (prior == null ? "No prior snapshot" : money(prior)) : momNote(mom, prior != null ? `was ${money(prior)}` : "")}
                      noteClassName={noteTone}
                      tone={mom == null
                        ? (bucket.includes("90") || bucket.includes(">") ? "orange" : "teal")
                        : (Number(mom) > 0 ? "orange" : "green")}
                    />
                  );
                })}
              </div>
              <p className="misRemark">{report.remarks.receivables}</p>
            </div>
          </div>
        </Slide>
      ),
    },
    {
      id: "inventory",
      label: "Inventory",
      node: (
        <Slide eyebrow="INVENTORY" title="Working capital in stock">
          {report.inventory ? (
            <>
              <div className="misKpiGrid">
                <Kpi
                  label="Stock in hand"
                  value={money(report.inventory.physical, { digits: 2 })}
                  note={report.inventory.physicalMomPct == null
                    ? null
                    : momNote(report.inventory.physicalMomPct, report.inventory.previousPhysical != null ? `was ${money(report.inventory.previousPhysical, { digits: 2 })}` : "")}
                  tone="teal"
                />
                <Kpi
                  label="Days on hand (month sales)"
                  value={daysOnHandValue(report.inventory.daysMonth, report.inventory.daysMonthMomPct)}
                  note={[
                    report.inventory.monthSales != null ? `month sales ${money(report.inventory.monthSales, { digits: 2 })}` : null,
                    report.inventory.daysMonthMomPct == null
                      ? "stock ÷ (month sales ÷ days in month)"
                      : momNote(
                        report.inventory.daysMonthMomPct,
                        report.inventory.previousDaysMonth != null ? `was ${report.inventory.previousDaysMonth}` : "",
                      ),
                  ].filter(Boolean).join(" · ")}
                  noteClassName={arMomNoteClass(report.inventory.daysMonthMomPct)}
                  tone={report.inventory.daysMonth > 90 ? "orange" : "green"}
                />
                <Kpi
                  label="Days on hand (forward cover)"
                  value={daysOnHandValue(report.inventory.days, report.inventory.daysMomPct)}
                  note={[
                    report.inventory.sales30d != null ? `last 30d sales ${money(report.inventory.sales30d, { digits: 2 })}` : null,
                    report.inventory.daysMomPct == null
                      ? "stock ÷ (last 30d sales ÷ 30)"
                      : momNote(
                        report.inventory.daysMomPct,
                        report.inventory.previousDays != null ? `was ${report.inventory.previousDays}` : "",
                      ),
                  ].filter(Boolean).join(" · ")}
                  noteClassName={arMomNoteClass(report.inventory.daysMomPct)}
                  tone={report.inventory.days > 90 ? "orange" : "green"}
                />
              </div>
            </>
          ) : (
            <p className="misRemark">
              Physical inventory is not published for {monthLabel(asOfYm)} yet. Use Latest stock for EOD cover.
            </p>
          )}
          <InventoryCoverPanel
            preparedInventory={report.inventory}
            language={language}
            asOfDate={report.asOfDate || asOfYm}
          />
        </Slide>
      ),
    },
    {
      id: "repeat",
      label: "Repeat",
      node: (
        <Slide eyebrow="CUSTOMERS" title="Repeat business">
          <div className="misKpiGrid">
            <Kpi label="Repeat sales" value={money(report.headline.repeatSales)} note={momNote(report.headline.repeatSalesMomPct, `${report.headline.repeatPct}% of month`)} tone={Number(report.headline.repeatSalesMomPct) >= 0 ? "green" : "orange"} />
            <Kpi label="Repeat customers" value={String(report.headline.repeatCustomers)} note={`Prior month ${report.headline.previousRepeatCustomers}`} tone="teal" />
            <Kpi label="New customers" value={String(report.headline.newCustomers)} note={momNote(report.headline.newCustomersMomPct, `prior ${report.headline.previousNewCustomers}`)} tone={Number(report.headline.newCustomersMomPct) >= 0 ? "green" : "orange"} />
            <Kpi label="Prior repeat mix" value={`${report.headline.previousRepeatPct}%`} note={money(report.headline.previousRepeatSales)} tone="orange" />
          </div>
          <h3>Category repeat · {monthLabel(asOfYm)} vs {monthLabel(report.previousMonth)}</h3>
          <p className="misMeta">Filter any column. Difference and MoM% are green when up, red when down.</p>
          {(report.repeatCategories || []).length ? (
            <RepeatCategoryMomTable
              rows={report.repeatCategories}
              language={language}
              currentLabel={monthLabel(asOfYm)}
              previousLabel={monthLabel(report.previousMonth)}
            />
          ) : (
            <p className="misRemark">No category repeat sales for this as-of month yet.</p>
          )}
          <h3>Historical month-on-month growth</h3>
          <GrowthTrendChart
            periods={months}
            series={repeatSeries}
            periodLabel={monthLabel}
            formatValue={(value) => (Number(value) >= 1000 ? compactChartNumber(value) : `${Number(value || 0).toFixed(1)}%`)}
          />
          <p className="misRemark">{report.remarks.repeat}</p>
        </Slide>
      ),
    },
    {
      id: "portfolio",
      label: "Portfolio",
      node: (
        <Slide eyebrow="PORTFOLIO" title="Selected high-margin categories">
          <p className="misRemark">
            Included:
            {" "}
            {(asOfCats
              .filter((row) => !PORTFOLIO_EXCLUDE_SET.has(String(row.category || "").trim().toLowerCase()))
              .map((row) => row.category)
              .filter(Boolean)
              .join(", ")) || "Sundry, Personal Care, Fragrance, Baby Care, Cosmetics, POS Supplies, and other non-excluded lines"}
            .
          </p>
          <p className="misMeta">
            Excluded from this portfolio: Electronics, Building Material, Office supplies, and Stationery.
          </p>
          <div className="misKpiGrid">
            <Kpi label="Portfolio sales" value={money(portfolio.sales || 0)} note={momNote(pctChangeSafe(portfolio.sales, prevPortfolio.sales), `prior ${money(prevPortfolio.sales || 0)}`)} tone="teal" />
            <Kpi label="Portfolio GP" value={money(portfolio.gp || 0)} note={momNote(pctChangeSafe(portfolio.gp, prevPortfolio.gp), `prior ${money(prevPortfolio.gp || 0)}`)} tone="green" />
            <Kpi label="Portfolio GP%" value={`${portfolio.gpPct ?? 0}%`} note={`Prior ${prevPortfolio.gpPct ?? 0}%`} tone="green" />
            <Kpi label="Active SKUs / customers" value={`${portfolio.skus ?? 0} / ${portfolio.customers ?? 0}`} tone="teal" />
          </div>
          {report.portfolioCategories?.length ? (
            <>
              <h3>Category MoM · where the dip is</h3>
              <PortfolioCategoryMomTable
                rows={report.portfolioCategories}
                lossItems={report.portfolioLossItems || []}
                language={language}
              />
            </>
          ) : null}
          {report.portfolioTopLossItems?.length ? (
            <>
              <h3>Top 10 items by sales loss</h3>
              <PortfolioTopLossItemsTable rows={report.portfolioTopLossItems} language={language} />
            </>
          ) : null}
          <p className="misRemark">{report.remarks.portfolio}</p>
        </Slide>
      ),
    },
    {
      id: "categories",
      label: "Categories",
      node: (
        <Slide eyebrow="MIX" title={`Category sales · ${monthLabel(asOfYm)}`}>
          <CategoryTable
            rows={asOfCats}
            language={language}
            asOfMonthLabel={monthLabel(asOfYm)}
            previousMonthLabel={report.previousMonth ? monthLabel(report.previousMonth) : "Last month"}
          />
        </Slide>
      ),
    },
    {
      id: "salesmen",
      label: "Team",
      node: (
        <Slide eyebrow="TEAM" title={`Salesman sales · ${monthLabel(asOfYm)}`}>
          <SalesmanTable rows={asOfSalesmen} language={language} />
        </Slide>
      ),
    },
    {
      id: "madiba",
      label: "MADIBA",
      node: (
        <Slide eyebrow="MADIBA BRAND" title={`Focus categories · ${monthLabel(asOfYm)}`}>
          <h3>Historical sales growth</h3>
          <GrowthTrendChart
            periods={months}
            series={madibaSalesSeries}
            periodLabel={monthLabel}
            formatValue={compactChartNumber}
          />
          {asOfMadiba.length ? (
            <MadibaTable rows={asOfMadiba} language={language} />
          ) : (
            <p className="misRemark">No MADIBA-branded lines found in Sundry / Personal Care / Fragrance / Baby Care for this month.</p>
          )}
        </Slide>
      ),
    },
    {
      id: "swot",
      label: "SWOT",
      node: (
        <Slide eyebrow="SWOT" title={`Position after ${monthLabel(asOfYm)}`}>
          <div className="misSwotGrid">
            <div className="misSwotCard misSwotCard--strength">
              <h3>Strengths</h3>
              <ul>
                <li>{report.remarks.momentum}</li>
                <li>{report.remarks.margin}</li>
                <li>{report.remarks.portfolio}</li>
              </ul>
            </div>
            <div className="misSwotCard misSwotCard--weak">
              <h3>Weaknesses</h3>
              <ul>
                <li>{report.remarks.receivables}</li>
                <li>{report.remarks.repeat}</li>
                <li>{report.inventory ? `Inventory days ~${report.inventory.days}.` : "Physical inventory days not published yet."}</li>
              </ul>
            </div>
            <div className="misSwotCard misSwotCard--opportunity">
              <h3>Opportunities</h3>
              <ul>
                <li>Push repeat frequency on the installed customer base.</li>
                <li>Rebuild selected high-margin portfolio volume without diluting GP%.</li>
                <li>Convert aged AR without constraining productive sales.</li>
              </ul>
            </div>
            <div className="misSwotCard misSwotCard--threat">
              <h3>Threats</h3>
              <ul>
                <li>Supply disruption and long lead times.</li>
                <li>Aggressive stock cuts could create stock-outs.</li>
                <li>Receivable ageing can absorb cash despite sales.</li>
              </ul>
            </div>
          </div>
        </Slide>
      ),
    },
    {
      id: "initiatives",
      label: "Initiatives",
      node: (
        <Slide eyebrow="FOCUS" title="Current business initiatives">
          <div className="misInitiativeGrid">
            {[
              ["1. Receivable conversion", "Drive faster collections; reduce >90-day AR toward <SAR 1.0M."],
              ["2. Repeat business", `Lift repeat mix from ${report.headline.repeatPct}% toward >50%.`],
              ["3. Inventory productivity", "Convert rebuilt stock through sell-through without stock-outs."],
              ["4. High-margin portfolio", `Protect portfolio GP% near ${portfolio.gpPct ?? 0}%.`],
              ["5. Westpoint distribution", "Expand active dealer coverage and repeat demand."],
              ["6. Cash van / Timber", "Build productive routes and commercially validated range."],
            ].map(([title, body]) => (
              <div key={title} className="misInitiativeCard">
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </Slide>
      ),
    },
    {
      id: "summary",
      label: "Summary",
      node: (
        <Slide eyebrow="SUMMARY" title="Management view">
          <div className="misSummaryGrid">
            <div className="misSummaryCard">
              <h3>Where we stand</h3>
              <p>{report.remarks.momentum}</p>
              <p>{report.remarks.margin}</p>
              <p>{report.remarks.repeat}</p>
            </div>
            <div className="misSummaryCard">
              <h3>Near-term focus</h3>
              <p>{report.remarks.receivables}</p>
              <p>{report.remarks.portfolio}</p>
              <p>{report.remarks.bottomLine}</p>
            </div>
          </div>
          <p className="misMeta">
            As of {report.asOfDate} · sales source {report.meta?.salesSource || "—"} · rows sales {report.meta?.salesRowCount ?? "—"} · receipts {report.meta?.receiptRowCount ?? "—"} · outstanding {report.meta?.outstandingRowCount ?? "—"}
          </p>
        </Slide>
      ),
    },
  ];
}

export default function MisPage() {
  const { language } = useAppLanguage();
  const t = useMemo(() => translate(language, TEXT), [language]);
  const { access, loading: accessLoading } = useModuleAccess();
  const [asOf, setAsOf] = useState(() => defaultMisAsOfDate(getKsaDateString()) || getKsaDateString());
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [report, setReport] = useState(null);
  const [builtAt, setBuiltAt] = useState("");
  const [error, setError] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState(() => emptyGrowthFilters());
  const [filterApplied, setFilterApplied] = useState(() => emptyGrowthFilters());
  const [filterCatalogs, setFilterCatalogs] = useState({});
  const [filtering, setFiltering] = useState(false);
  const [filteredView, setFilteredView] = useState(false);
  const reportRef = useRef(null);
  const slideIdRef = useRef(null);
  usePopupMessages({ error });

  const canOpen = access?.canAccess?.("mis");
  const activeFilterCount = useMemo(() => {
    const filters = normalizeGrowthFilters(filterApplied);
    let count = 0;
    if (filters.dateFrom || filters.dateTo) count += 1;
    if (filters.amountMin != null || filters.amountMax != null) count += 1;
    if (filters.quantityMin != null || filters.quantityMax != null) count += 1;
    Object.values(filters.values || {}).forEach((values) => {
      if (Array.isArray(values) && values.length) count += 1;
    });
    return count;
  }, [filterApplied]);

  const load = useCallback(async (date, { rebuild = false, filters = null } = {}) => {
    const usingFilters = filters && hasActiveGrowthFilters(filters);
    const slideIdBefore = slideIdRef.current;
    const hadReport = Boolean(reportRef.current);
    setLoading(true);
    setPreparing(Boolean(rebuild) && !usingFilters);
    setFiltering(Boolean(usingFilters));
    setError("");
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) throw new Error("Please login again.");
      let response;
      let payload;
      if (usingFilters) {
        ({ response, payload } = await fetchJsonWithTimeout(
          "/api/business-dashboard/mis",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ asOf: date, filters }),
          },
          MIS_FETCH_FILTER_MS,
        ));
      } else {
        const params = new URLSearchParams({ asOf: date });
        if (rebuild) params.set("rebuild", "1");
        ({ response, payload } = await fetchJsonWithTimeout(
          `/api/business-dashboard/mis?${params.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          rebuild ? MIS_FETCH_REBUILD_MS : MIS_FETCH_PREPARED_MS,
        ));
      }
      if (payload?.code === "MIS_NOT_PREPARED") {
        setReport(null);
        setBuiltAt("");
        setFilteredView(false);
        setError(payload?.error || t("notPrepared"));
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to load MIS");
      }
      setReport(payload.report || null);
      setBuiltAt(payload.builtAt || payload.report?.meta?.preparedAt || "");
      if (payload.catalogs) setFilterCatalogs(payload.catalogs);
      setFilteredView(Boolean(payload.filtered || usingFilters));
      if (payload.asOfDate) setAsOf(payload.asOfDate);
      if (payload.message) setError(payload.message);
      setSlideIndex(resolveSlideIndexAfterReport(payload.report, slideIdBefore, language));
    } catch (err) {
      const timedOut = String(err?.message || "").toLowerCase().includes("timed out");
      if (timedOut) {
        try {
          const supabase = getSupabaseClient();
          const session = await resolveAuthSession(supabase, 12000);
          if (session?.access_token) {
            const params = new URLSearchParams({ asOf: date });
            const recovered = await fetchJsonWithTimeout(
              `/api/business-dashboard/mis?${params.toString()}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } },
              MIS_FETCH_PREPARED_MS,
            );
            if (recovered.response?.ok && recovered.payload?.success && recovered.payload?.report) {
              setReport(recovered.payload.report);
              setBuiltAt(recovered.payload.builtAt || recovered.payload.report?.meta?.preparedAt || "");
              if (recovered.payload.catalogs) setFilterCatalogs(recovered.payload.catalogs);
              setFilteredView(Boolean(recovered.payload.filtered));
              if (recovered.payload.asOfDate) setAsOf(recovered.payload.asOfDate);
              setError(rebuild ? t("timeoutRebuildRecovered") : "");
              setSlideIndex(resolveSlideIndexAfterReport(recovered.payload.report, slideIdBefore, language));
              return;
            }
          }
        } catch {
          // fall through to timeout messaging below
        }
      }
      if (timedOut && usingFilters && hadReport) {
        setError(t("timeoutFilter"));
        return;
      }
      if (timedOut && rebuild) {
        if (hadReport) {
          setError(t("timeoutRebuild"));
        } else {
          setReport(null);
          setBuiltAt("");
          setFilteredView(false);
          setError(t("timeoutRebuild"));
        }
        return;
      }
      if (timedOut && usingFilters) {
        setError(t("timeoutFilter"));
        if (!hadReport) {
          setReport(null);
          setBuiltAt("");
          setFilteredView(false);
        }
        return;
      }
      setReport(null);
      setBuiltAt("");
      setFilteredView(false);
      setError(err?.message || "Unable to load MIS");
    } finally {
      setPreparing(false);
      setFiltering(false);
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => {
    if (accessLoading) return;
    if (!canOpen) {
      setLoading(false);
      return;
    }
    load(asOf, { rebuild: false });
    // Open from prepared pack only; as-of changes apply on Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, canOpen, load]);

  const slides = useMemo(
    () => (report ? buildSlides(report, language) : []),
    [report, language],
  );

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    slideIdRef.current = slides[slideIndex]?.id ?? null;
  }, [slides, slideIndex]);

  useEffect(() => {
    if (!slides.length) return undefined;
    function onKey(event) {
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        setSlideIndex((index) => Math.min(slides.length - 1, index + 1));
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setSlideIndex((index) => Math.max(0, index - 1));
      }
      if (event.key === "Home") {
        event.preventDefault();
        setSlideIndex(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        setSlideIndex(slides.length - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  useEffect(() => {
    if (slideIndex >= slides.length) setSlideIndex(0);
  }, [slideIndex, slides.length]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="MIS unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      />
    );
  }

  const active = slides[slideIndex] || null;

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage misPage">
        <div className="moduleShell misShell">
          <header className="moduleHeader misHeader">
            <div>
              <p className="moduleEyebrow">NOOR SHUKRAN · KSA NON FOOD</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderActions">
              <AppLanguageSwitch />
              <Link className="moduleButton" href="/management/business-dashboard">{t("bi")}</Link>
              <Link className="moduleButton" href="/management">{t("back")}</Link>
            </div>
          </header>

          {!accessLoading && !canOpen ? (
            <div className="moduleCard"><p>{t("denied")}</p></div>
          ) : (
            <>
              <div className="misToolbar">
                <label>
                  {t("asOf")}
                  <input
                    type="date"
                    value={asOf}
                    onChange={(event) => setAsOf(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="moduleButton moduleButtonPrimary"
                  onClick={() => {
                    const empty = emptyGrowthFilters();
                    setFilterDraft(empty);
                    setFilterApplied(empty);
                    load(asOf, { rebuild: true });
                  }}
                  disabled={loading}
                >
                  {t("refresh")}
                </button>
                {builtAt ? (
                  <span className="misPreparedStamp">
                    {t("preparedAt")}
                    {" "}
                    {new Date(builtAt).toLocaleString()}
                  </span>
                ) : null}
                {filteredView ? (
                  <span className="misPreparedStamp misPreparedStamp--filtered">{t("filteredStamp")}</span>
                ) : null}
              </div>

              <MisFilterDrawer
                language={language}
                open={filtersOpen}
                onToggle={() => setFiltersOpen((value) => !value)}
                activeCount={activeFilterCount}
              >
                <CategoryGrowthFilters
                  language={language}
                  draft={filterDraft}
                  catalogs={filterCatalogs}
                  applied={filterApplied}
                  onDraftChange={setFilterDraft}
                  onGroupByChange={() => {}}
                  onApply={() => {
                    const next = normalizeGrowthFilters(filterDraft);
                    setFilterApplied(next);
                    load(asOf, { filters: next });
                  }}
                  onClear={() => {
                    const empty = emptyGrowthFilters();
                    setFilterDraft(empty);
                    setFilterApplied(empty);
                    load(asOf, { rebuild: false });
                  }}
                  lockGroupBy="category"
                  showSearch={false}
                  showStatusFilters={false}
                  hint={t("filtersHint")}
                />
              </MisFilterDrawer>

              {loading ? (
                <div className="moduleCard"><p>{preparing ? t("preparing") : (filtering ? t("filtering") : t("loading"))}</p></div>
              ) : !report || !active ? (
                <div className="moduleCard">
                  <p>{error || (!report ? t("notPrepared") : t("noData"))}</p>
                </div>
              ) : (
                <div className="misDeck misDeck--presenter">
                  <div className="misDeckNav" role="navigation" aria-label="MIS slides">
                    <button
                      type="button"
                      className="moduleButton"
                      disabled={slideIndex <= 0}
                      onClick={() => setSlideIndex((index) => Math.max(0, index - 1))}
                    >
                      {t("prev")}
                    </button>
                    <div className="misDeckStatus">
                      {t("slideOf")}
                      {" "}
                      {slideIndex + 1}
                      {" / "}
                      {slides.length}
                      <span className="misDeckStatusLabel">{active.label}</span>
                    </div>
                    <button
                      type="button"
                      className="moduleButton moduleButtonPrimary"
                      disabled={slideIndex >= slides.length - 1}
                      onClick={() => setSlideIndex((index) => Math.min(slides.length - 1, index + 1))}
                    >
                      {t("next")}
                    </button>
                  </div>

                  <div className="misDeckTabs" role="tablist" aria-label="Jump to slide">
                    {slides.map((slide, index) => (
                      <button
                        key={slide.id}
                        type="button"
                        role="tab"
                        aria-selected={index === slideIndex}
                        className={`misDeckTab${index === slideIndex ? " misDeckTab--active" : ""}`}
                        onClick={() => setSlideIndex(index)}
                      >
                        {index + 1}. {slide.label}
                      </button>
                    ))}
                  </div>

                  <div className="misDeckStage" key={active.id}>
                    {active.node}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
