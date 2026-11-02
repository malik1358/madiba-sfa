"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { getKsaDateString } from "../../lib/workdayActivity";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

/** Default to last day of the previous KSA month (month-end pack). */
function defaultMisAsOfDate() {
  const today = getKsaDateString();
  const [year, month] = today.split("-").map(Number);
  const lastPrev = new Date(Date.UTC(year, month - 1, 0));
  return lastPrev.toISOString().slice(0, 10);
}

const TEXT = {
  title: { en: "Management MIS", ar: "تقرير الإدارة" },
  subtitle: {
    en: "Live month-end pack from BI sales, receipts, and outstanding.",
    ar: "حزمة نهاية الشهر مباشرة من المبيعات والتحصيل والمستحقات.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  bi: { en: "Business Intelligence", ar: "ذكاء الأعمال" },
  loading: { en: "Building live MIS…", ar: "جاري بناء تقرير الإدارة…" },
  asOf: { en: "As of", ar: "حتى" },
  refresh: { en: "Refresh", ar: "تحديث" },
  denied: { en: "MIS is available to admin and manager only.", ar: "تقرير الإدارة متاح للمدير فقط." },
  noData: { en: "No MIS data returned.", ar: "لا توجد بيانات." },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  slideOf: { en: "Slide", ar: "شريحة" },
  all: { en: "All", ar: "الكل" },
};

function money(value, { digits = 1 } = {}) {
  const n = Number(value) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}SAR ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}SAR ${(abs / 1_000).toFixed(digits)}K`;
  return `${sign}SAR ${abs.toFixed(0)}`;
}

function pct(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
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
                <td>{money(row.sales)}</td>
                <td>{money(row.gp)}</td>
                <td className="moduleBiTotalCol">{row.sales ? `${((row.gp / row.sales) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{money(salesTotal)}</td>
              <td>{money(gpTotal)}</td>
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
                <td className="moduleBiTotalCol">{money(row.sales)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="moduleBiTotalCol">{money(salesTotal)}</td>
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
                <td>{money(row.sales)}</td>
                <td>{money(row.gp)}</td>
                <td className="moduleBiTotalCol">{`${row.gpPct ?? 0}%`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{money(salesTotal)}</td>
              <td>{money(gpTotal)}</td>
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
  const salesMax = Math.max(0, ...months.map((ym) => Number(report?.monthlySales?.[ym] || 0)));
  const gpMax = Math.max(0, ...months.map((ym) => Number(report?.monthlyGp?.[ym] || 0)));
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
            <Kpi label="Sales" value={money(report.headline.sales)} note={`${pct(report.headline.salesMomPct)} vs prior month`} tone={report.headline.salesMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Gross profit" value={money(report.headline.gp)} note={`${pct(report.headline.gpMomPct)} · ${report.headline.gpPct}% margin`} tone={report.headline.gpMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Collections" value={money(report.headline.collection)} note={`${pct(report.headline.collectionMomPct)} vs prior month`} tone={report.headline.collectionMomPct >= 0 ? "green" : "orange"} />
            <Kpi label="Repeat mix" value={`${report.headline.repeatPct}%`} note={`${money(report.headline.repeatSales)} · ${report.headline.repeatCustomers} buyers`} tone="teal" />
            <Kpi label=">90-day AR" value={money(report.headline.gt90Ar)} note={`Total AR ${money(report.headline.totalAr)} · ~${report.headline.collectionDays ?? "—"} days`} tone="orange" />
            <Kpi label="YTD sales" value={money(report.headline.ytdSales, { digits: 2 })} note={`${report.headline.newCustomers} new customers this month`} tone="teal" />
          </div>
          <p className="misRemark">{report.remarks.momentum} {report.remarks.margin}</p>
        </Slide>
      ),
    },
    {
      id: "sales-gp",
      label: "Sales & GP",
      node: (
        <Slide eyebrow="SALES & GP" title="Monthly sales and gross profit">
          <div className="misSplit">
            <div>
              <h3>Sales</h3>
              {months.map((ym) => (
                <BarRow key={`s-${ym}`} label={monthLabel(ym)} value={report.monthlySales[ym]} max={salesMax} highlight={ym === asOfYm} />
              ))}
            </div>
            <div>
              <h3>Gross profit</h3>
              {months.map((ym) => (
                <BarRow key={`g-${ym}`} label={monthLabel(ym)} value={report.monthlyGp[ym]} max={gpMax} highlight={ym === asOfYm} />
              ))}
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
              <h3>AR ageing (latest outstanding upload)</h3>
              <div className="misKpiGrid misKpiGrid--compact">
                {Object.entries(report.headline.arBuckets || {}).map(([bucket, value]) => (
                  <Kpi key={bucket} label={bucket} value={money(value)} tone={bucket.includes("90") || bucket.includes(">") ? "orange" : "teal"} />
                ))}
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
            <div className="misKpiGrid">
              <Kpi label="Physical stock" value={money(report.inventory.physical, { digits: 2 })} tone="teal" />
              <Kpi label="Days on hand" value={report.inventory.days != null ? String(report.inventory.days) : "—"} note={`vs ${monthLabel(asOfYm)} sales pace`} tone={report.inventory.days > 90 ? "orange" : "green"} />
            </div>
          ) : (
            <p className="misRemark">
              Physical inventory is not in the live BI cube yet. Publish
              {" "}
              <code>mis_inventory_physical_v1</code>
              {" "}
              as
              {" "}
              <code>{`{ "month": "${asOfYm}", "physical": 1234567 }`}</code>
              {" "}
              to unlock days-on-hand on this slide.
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
          <div className="misKpiGrid">
            <Kpi label="Repeat sales" value={money(report.headline.repeatSales)} note={`${report.headline.repeatPct}% of month`} tone="teal" />
            <Kpi label="Repeat customers" value={String(report.headline.repeatCustomers)} note={`Prior month ${report.headline.previousRepeatCustomers}`} tone="teal" />
            <Kpi label="New customers" value={String(report.headline.newCustomers)} note={`Prior month ${report.headline.previousNewCustomers}`} tone="green" />
            <Kpi label="Prior repeat mix" value={`${report.headline.previousRepeatPct}%`} note={money(report.headline.previousRepeatSales)} tone="orange" />
          </div>
          <p className="misRemark">{report.remarks.repeat}</p>
        </Slide>
      ),
    },
    {
      id: "portfolio",
      label: "Portfolio",
      node: (
        <Slide eyebrow="PORTFOLIO" title="Selected high-margin categories">
          <div className="misKpiGrid">
            <Kpi label="Portfolio sales" value={money(portfolio.sales || 0)} note={`Prior ${money(prevPortfolio.sales || 0)}`} tone="teal" />
            <Kpi label="Portfolio GP" value={money(portfolio.gp || 0)} note={`Prior ${money(prevPortfolio.gp || 0)}`} tone="green" />
            <Kpi label="Portfolio GP%" value={`${portfolio.gpPct ?? 0}%`} note={`Prior ${prevPortfolio.gpPct ?? 0}%`} tone="green" />
            <Kpi label="Active SKUs / customers" value={`${portfolio.skus ?? 0} / ${portfolio.customers ?? 0}`} tone="teal" />
          </div>
          <p className="misRemark">{report.remarks.portfolio}</p>
          <p className="misMeta">Excludes Electronics, Building Material, Office supplies, and Stationery.</p>
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
  const [asOf, setAsOf] = useState(() => defaultMisAsOfDate());
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  usePopupMessages({ error });

  const canOpen = access?.canAccess?.("mis");

  const load = useCallback(async (date) => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) throw new Error("Please login again.");
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/business-dashboard/mis?asOf=${encodeURIComponent(date)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        90000,
      );
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to load MIS");
      }
      setReport(payload.report || null);
      setSlideIndex(0);
    } catch (err) {
      setReport(null);
      setError(err?.message || "Unable to load MIS");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessLoading) return;
    if (!canOpen) {
      setLoading(false);
      return;
    }
    load(asOf);
  }, [accessLoading, canOpen, asOf, load]);

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
                <button type="button" className="moduleButton moduleButtonPrimary" onClick={() => load(asOf)} disabled={loading}>
                  {t("refresh")}
                </button>
              </div>

              {loading ? (
                <div className="moduleCard"><p>{t("loading")}</p></div>
              ) : !report || !active ? (
                <div className="moduleCard"><p>{t("noData")}</p></div>
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
