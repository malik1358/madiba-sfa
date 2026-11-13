"use client";

import Link from "next/link";
import { Children, useCallback, useEffect, useMemo, useState } from "react";
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

const PORTFOLIO_EXCLUDE_SET = new Set(
  MIS_PORTFOLIO_EXCLUDE.map((value) => String(value || "").trim().toLowerCase()),
);

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
  kpiPanel: { en: "Key figures", ar: "الأرقام الرئيسية" },
  showKpis: { en: "Show", ar: "إظهار" },
  hideKpis: { en: "Hide", ar: "إخفاء" },
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

function Kpi({ label, value, note, tone = "teal" }) {
  return (
    <div className={`misKpi misKpi--${tone}`}>
      <div className="misKpiLabel">{label}</div>
      <div className="misKpiValue">{value}</div>
      {note ? <div className="misKpiNote">{note}</div> : null}
    </div>
  );
}

/** Collapsible KPI strip: closed by default so charts/tables keep the slide; open for full cards. */
function MisKpiPanel({
  language,
  title,
  compact = false,
  defaultOpen = false,
  children,
}) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const [open, setOpen] = useState(defaultOpen);
  const items = Children.toArray(children)
    .filter((child) => child && typeof child === "object" && child.props?.label != null)
    .map((child) => ({
      label: child.props.label,
      value: child.props.value,
      tone: child.props.tone || "teal",
    }));
  const heading = title || t("kpiPanel");

  return (
    <div className={`misKpiPanel${open ? " misKpiPanel--open" : ""}`}>
      <button
        type="button"
        className="misKpiPanelToggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="misKpiPanelChevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="misKpiPanelTitle">{heading}</span>
        <span className="misKpiPanelCount">{items.length}</span>
        <span className="misKpiPanelAction">{open ? t("hideKpis") : t("showKpis")}</span>
      </button>
      {!open && items.length ? (
        <div className="misKpiChipRow" role="list">
          {items.map((item) => (
            <div key={item.label} className={`misKpiChip misKpiChip--${item.tone}`} role="listitem">
              <span className="misKpiChipLabel">{item.label}</span>
              <strong className="misKpiChipValue">{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className={`misKpiGrid${compact ? " misKpiGrid--compact" : ""}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
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

function InventoryCategoryTable({ rows, language, totalDaysOnHand }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["category", "amount", "forwardCoverDays"];
  const valueOf = useCallback((row, key) => {
    if (key === "forwardCoverDays") {
      return row.forwardCoverDays != null ? String(row.forwardCoverDays) : "—";
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const stockTotal = visibleRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <ExportableTable filename="mis-inventory-categories" sheetName="Inventory" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll" style={{ marginTop: 12 }}>
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
              <BiExcelHead label="Stock value" filterKey="amount" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
              <BiExcelHead label="Forward cover (days)" filterKey="forwardCoverDays" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                <td>{row.category}</td>
                <td className="moduleBiTotalCol">{amountInt(row.amount)}</td>
                <td className={`moduleBiTotalCol${row.forwardCoverDays != null && row.forwardCoverDays > 90 ? " moduleBiMonthCell--down" : row.forwardCoverDays != null ? " moduleBiMonthCell--up" : ""}`}>
                  {row.forwardCoverDays != null ? amountInt(row.forwardCoverDays) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td className="moduleBiTotalCol"><strong>{amountInt(stockTotal)}</strong></td>
              <td className={`moduleBiTotalCol${totalDaysOnHand != null && totalDaysOnHand > 90 ? " moduleBiMonthCell--down" : totalDaysOnHand != null ? " moduleBiMonthCell--up" : ""}`}>
                <strong>{totalDaysOnHand != null ? amountInt(totalDaysOnHand) : "—"}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ExportableTable>
  );
}

function CategoryTable({ rows, language }) {
  const t = useMemo(() => translate(language, TEXT), [language]);
  const keys = ["category", "sales", "gp", "gpPct"];
  const valueOf = useCallback((row, key) => {
    if (key === "gpPct") {
      return row.sales ? `${((row.gp / row.sales) * 100).toFixed(1)}%` : "—";
    }
    return row[key];
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const salesTotal = visibleRows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
  const gpTotal = visibleRows.reduce((sum, row) => sum + Number(row.gp || 0), 0);

  return (
    <ExportableTable filename="mis-categories" sheetName="Categories" className="moduleTableWrap moduleBiTableWrap">
      <div className="moduleTableScroll">
        <table className="moduleTable moduleBiTable">
          <thead>
            <tr>
              <BiExcelHead label="Category" filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
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
                <td className="moduleBiTotalCol">{row.sales ? `${((row.gp / row.sales) * 100).toFixed(1)}%` : "—"}</td>
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
          <MisKpiPanel language={language} title="Headline KPIs">
            <Kpi label="Sales" value={money(report.headline.sales)} note={momNote(report.headline.salesMomPct)} tone={report.headline.salesMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Gross profit" value={money(report.headline.gp)} note={momNote(report.headline.gpMomPct, `${report.headline.gpPct}% margin (was ${report.headline.previousGpPct}%)`)} tone={report.headline.gpMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Collections" value={money(report.headline.collection)} note={momNote(report.headline.collectionMomPct)} tone={report.headline.collectionMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Repeat mix" value={`${report.headline.repeatPct}%`} note={momNote(report.headline.repeatMomPct, `was ${report.headline.previousRepeatPct}% · ${money(report.headline.repeatSales)}`)} tone={Number(report.headline.repeatMomPct) >= 0 ? "green" : "orange"} />
            <Kpi
              label=">90-day AR"
              value={money(report.headline.gt90Ar)}
              note={report.headline.gt90ArMomPct == null
                ? `Total AR ${money(report.headline.totalAr)} · ~${report.headline.collectionDays ?? "—"} days`
                : momNote(report.headline.gt90ArMomPct, `Total AR ${money(report.headline.totalAr)} · ~${report.headline.collectionDays ?? "—"} days`)}
              tone={report.headline.gt90ArMomPct == null || report.headline.gt90ArMomPct <= 0 ? "green" : "orange"}
            />
            <Kpi label="YTD sales" value={money(report.headline.ytdSales, { digits: 2 })} note={momNote(report.headline.ytdMomPct, `${report.headline.newCustomers} new customers`)} tone={Number(report.headline.ytdMomPct) >= 0 ? "green" : "orange"} />
          </MisKpiPanel>
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
              <MisKpiPanel language={language} title="AR ageing" compact>
                {Object.entries(report.headline.arBuckets || {}).map(([bucket, value]) => {
                  const mom = report.headline.arBucketMomPct?.[bucket];
                  const prior = report.headline.previousArBuckets?.[bucket];
                  return (
                    <Kpi
                      key={bucket}
                      label={bucket}
                      value={money(value)}
                      note={mom == null ? (prior == null ? "No prior snapshot" : money(prior)) : momNote(mom, prior != null ? `was ${money(prior)}` : "")}
                      tone={bucket.includes("90") || bucket.includes(">") ? "orange" : "teal"}
                    />
                  );
                })}
              </MisKpiPanel>
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
              <MisKpiPanel language={language} title="Inventory KPIs">
                <Kpi
                  label="Physical stock"
                  value={money(report.inventory.physical, { digits: 2 })}
                  note={report.inventory.physicalMomPct == null
                    ? null
                    : momNote(report.inventory.physicalMomPct, report.inventory.previousPhysical != null ? `was ${money(report.inventory.previousPhysical, { digits: 2 })}` : "")}
                  tone="teal"
                />
                <Kpi
                  label="Days on hand"
                  value={report.inventory.days != null ? String(report.inventory.days) : "—"}
                  note={report.inventory.daysMomPct == null
                    ? "Forward cover vs last 30 days sales"
                    : momNote(report.inventory.daysMomPct, report.inventory.previousDays != null ? `was ${report.inventory.previousDays}` : "last 30 days pace")}
                  tone={report.inventory.days > 90 ? "orange" : "green"}
                />
              </MisKpiPanel>
              {report.inventory.categories?.length ? (
                <InventoryCategoryTable
                  rows={report.inventory.categories}
                  language={language}
                  totalDaysOnHand={report.inventory.days}
                />
              ) : null}
            </>
          ) : (
            <p className="misRemark">
              Physical inventory is not published for {monthLabel(asOfYm)} yet.
            </p>
          )}
        </Slide>
      ),
    },
    {
      id: "repeat",
      label: "Repeat",
      node: (
        <Slide eyebrow="CUSTOMERS" title="Repeat business">
          <MisKpiPanel language={language} title="Repeat KPIs">
            <Kpi label="Repeat sales" value={money(report.headline.repeatSales)} note={momNote(report.headline.repeatSalesMomPct, `${report.headline.repeatPct}% of month`)} tone={Number(report.headline.repeatSalesMomPct) >= 0 ? "green" : "orange"} />
            <Kpi label="Repeat customers" value={String(report.headline.repeatCustomers)} note={`Prior month ${report.headline.previousRepeatCustomers}`} tone="teal" />
            <Kpi label="New customers" value={String(report.headline.newCustomers)} note={momNote(report.headline.newCustomersMomPct, `prior ${report.headline.previousNewCustomers}`)} tone={Number(report.headline.newCustomersMomPct) >= 0 ? "green" : "orange"} />
            <Kpi label="Prior repeat mix" value={`${report.headline.previousRepeatPct}%`} note={money(report.headline.previousRepeatSales)} tone="orange" />
          </MisKpiPanel>
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
          <MisKpiPanel language={language} title="Portfolio KPIs">
            <Kpi label="Portfolio sales" value={money(portfolio.sales || 0)} note={momNote(pctChangeSafe(portfolio.sales, prevPortfolio.sales), `prior ${money(prevPortfolio.sales || 0)}`)} tone="teal" />
            <Kpi label="Portfolio GP" value={money(portfolio.gp || 0)} note={momNote(pctChangeSafe(portfolio.gp, prevPortfolio.gp), `prior ${money(prevPortfolio.gp || 0)}`)} tone="green" />
            <Kpi label="Portfolio GP%" value={`${portfolio.gpPct ?? 0}%`} note={`Prior ${prevPortfolio.gpPct ?? 0}%`} tone="green" />
            <Kpi label="Active SKUs / customers" value={`${portfolio.skus ?? 0} / ${portfolio.customers ?? 0}`} tone="teal" />
          </MisKpiPanel>
          <p className="misRemark">{report.remarks.portfolio}</p>
        </Slide>
      ),
    },
    {
      id: "categories",
      label: "Categories",
      node: (
        <Slide eyebrow="MIX" title={`Category sales · ${monthLabel(asOfYm)}`}>
          <CategoryTable rows={asOfCats} language={language} />
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
  usePopupMessages({ error });

  const canOpen = access?.canAccess?.("mis");

  const load = useCallback(async (date, { rebuild = false } = {}) => {
    setLoading(true);
    setPreparing(Boolean(rebuild));
    setError("");
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) throw new Error("Please login again.");
      const params = new URLSearchParams({ asOf: date });
      if (rebuild) params.set("rebuild", "1");
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/business-dashboard/mis?${params.toString()}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        rebuild ? 90000 : 20000,
      );
      if (payload?.code === "MIS_NOT_PREPARED") {
        setReport(null);
        setBuiltAt("");
        setError(payload?.error || "Month-end MIS is not prepared yet.");
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to load MIS");
      }
      setReport(payload.report || null);
      setBuiltAt(payload.builtAt || payload.report?.meta?.preparedAt || "");
      if (payload.asOfDate) setAsOf(payload.asOfDate);
      if (payload.message) setError(payload.message);
      setSlideIndex(0);
    } catch (err) {
      setReport(null);
      setBuiltAt("");
      setError(err?.message || "Unable to load MIS");
    } finally {
      setPreparing(false);
      setLoading(false);
    }
  }, []);

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
                  onClick={() => load(asOf, { rebuild: true })}
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
              </div>

              {loading ? (
                <div className="moduleCard"><p>{preparing ? t("preparing") : t("loading")}</p></div>
              ) : !report || !active ? (
                <div className="moduleCard">
                  <p>{error ? t("notPrepared") : t("noData")}</p>
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
