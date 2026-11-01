"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { getKsaDateString } from "../../lib/workdayActivity";

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

function Section({ eyebrow, title, children }) {
  return (
    <section className="misSlide">
      <div className="misSlideHead">
        <div className="misEyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function MisPage() {
  const { language } = useAppLanguage();
  const t = useCallback((key) => translate(TEXT, key, language), [language]);
  const { access, loading: accessLoading } = useModuleAccess();
  const [asOf, setAsOf] = useState(() => getKsaDateString());
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  usePopupMessages({ error });

  const canOpen = access?.canAccess?.("mis");

  const load = useCallback(async (date) => {
    setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession();
      if (!session?.access_token) throw new Error("Please sign in again.");
      const data = await fetchJsonWithTimeout(
        `/api/business-dashboard/mis?asOf=${encodeURIComponent(date)}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          timeoutMs: 90000,
        },
      );
      if (!data?.success) throw new Error(data?.error || "Unable to load MIS");
      setReport(data.report || null);
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

  const months = report?.months || [];
  const salesMax = useMemo(
    () => Math.max(0, ...months.map((ym) => Number(report?.monthlySales?.[ym] || 0))),
    [months, report],
  );
  const gpMax = useMemo(
    () => Math.max(0, ...months.map((ym) => Number(report?.monthlyGp?.[ym] || 0))),
    [months, report],
  );
  const colMax = useMemo(
    () => Math.max(0, ...months.map((ym) => Number(report?.collections?.[ym] || 0))),
    [months, report],
  );

  const asOfCats = useMemo(() => {
    const ym = report?.asOfMonth;
    if (!ym) return [];
    return (report.categories || [])
      .filter((row) => row.period === ym)
      .slice(0, 10);
  }, [report]);

  const asOfSalesmen = useMemo(() => {
    const ym = report?.asOfMonth;
    if (!ym) return [];
    return (report.salesmen || [])
      .filter((row) => row.period === ym)
      .slice(0, 12);
  }, [report]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="MIS unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      />
    );
  }

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
              ) : !report ? (
                <div className="moduleCard"><p>{t("noData")}</p></div>
              ) : (
                <div className="misDeck">
                  <Section eyebrow="MOMENTUM" title={`Performance through ${monthLabel(report.asOfMonth)}`}>
                    <div className="misKpiGrid">
                      <Kpi
                        label="Sales"
                        value={money(report.headline.sales)}
                        note={`${pct(report.headline.salesMomPct)} vs prior month`}
                        tone={report.headline.salesMomPct >= 0 ? "green" : "orange"}
                      />
                      <Kpi
                        label="Gross profit"
                        value={money(report.headline.gp)}
                        note={`${pct(report.headline.gpMomPct)} · ${report.headline.gpPct}% margin`}
                        tone={report.headline.gpMomPct >= 0 ? "green" : "orange"}
                      />
                      <Kpi
                        label="Collections"
                        value={money(report.headline.collection)}
                        note={`${pct(report.headline.collectionMomPct)} vs prior month`}
                        tone={report.headline.collectionMomPct >= 0 ? "green" : "orange"}
                      />
                      <Kpi
                        label="Repeat mix"
                        value={`${report.headline.repeatPct}%`}
                        note={`${money(report.headline.repeatSales)} · ${report.headline.repeatCustomers} buyers`}
                        tone="teal"
                      />
                      <Kpi
                        label=">90-day AR"
                        value={money(report.headline.gt90Ar)}
                        note={`Total AR ${money(report.headline.totalAr)} · ~${report.headline.collectionDays ?? "—"} days`}
                        tone="orange"
                      />
                      <Kpi
                        label="YTD sales"
                        value={money(report.headline.ytdSales, { digits: 2 })}
                        note={`${report.headline.newCustomers} new customers this month`}
                        tone="teal"
                      />
                    </div>
                    <p className="misRemark">{report.remarks.momentum} {report.remarks.margin}</p>
                  </Section>

                  <Section eyebrow="SALES & GP" title="Monthly sales and gross profit">
                    <div className="misSplit">
                      <div>
                        <h3>Sales</h3>
                        {months.map((ym) => (
                          <BarRow
                            key={`s-${ym}`}
                            label={monthLabel(ym)}
                            value={report.monthlySales[ym]}
                            max={salesMax}
                            highlight={ym === report.asOfMonth}
                          />
                        ))}
                      </div>
                      <div>
                        <h3>Gross profit</h3>
                        {months.map((ym) => (
                          <BarRow
                            key={`g-${ym}`}
                            label={monthLabel(ym)}
                            value={report.monthlyGp[ym]}
                            max={gpMax}
                            highlight={ym === report.asOfMonth}
                          />
                        ))}
                      </div>
                    </div>
                  </Section>

                  <Section eyebrow="CASH" title="Collections and receivables">
                    <div className="misSplit">
                      <div>
                        <h3>Monthly collections</h3>
                        {months.map((ym) => (
                          <BarRow
                            key={`c-${ym}`}
                            label={monthLabel(ym)}
                            value={report.collections[ym]}
                            max={colMax}
                            highlight={ym === report.asOfMonth}
                          />
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
                  </Section>

                  <Section eyebrow="CUSTOMERS" title="Repeat business">
                    <div className="misKpiGrid">
                      <Kpi label="Repeat sales" value={money(report.headline.repeatSales)} note={`${report.headline.repeatPct}% of month`} tone="teal" />
                      <Kpi label="Repeat customers" value={String(report.headline.repeatCustomers)} note={`Prior month ${report.headline.previousRepeatCustomers}`} tone="teal" />
                      <Kpi label="New customers" value={String(report.headline.newCustomers)} note={`Prior month ${report.headline.previousNewCustomers}`} tone="green" />
                      <Kpi
                        label="Selected portfolio GP%"
                        value={`${report.portfolio?.[report.asOfMonth]?.gpPct ?? 0}%`}
                        note={money(report.portfolio?.[report.asOfMonth]?.sales || 0)}
                        tone="green"
                      />
                    </div>
                    <p className="misRemark">{report.remarks.repeat} {report.remarks.portfolio}</p>
                  </Section>

                  <Section eyebrow="MIX" title={`Category sales · ${monthLabel(report.asOfMonth)}`}>
                    <div className="moduleTableScroll">
                      <table className="moduleTable moduleBiTable">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Sales</th>
                            <th>GP</th>
                            <th>GP%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {asOfCats.map((row, index) => (
                            <tr key={row.category} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                              <td>{row.category}</td>
                              <td>{money(row.sales)}</td>
                              <td>{money(row.gp)}</td>
                              <td>{row.sales ? `${((row.gp / row.sales) * 100).toFixed(1)}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  <Section eyebrow="TEAM" title={`Salesman sales · ${monthLabel(report.asOfMonth)}`}>
                    <div className="moduleTableScroll">
                      <table className="moduleTable moduleBiTable">
                        <thead>
                          <tr>
                            <th>Salesman</th>
                            <th>Sales</th>
                          </tr>
                        </thead>
                        <tbody>
                          {asOfSalesmen.map((row, index) => (
                            <tr key={row.salesman} className={index % 2 ? "moduleBiRowAlt" : undefined}>
                              <td>{row.salesman}</td>
                              <td>{money(row.sales)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  <Section eyebrow="SUMMARY" title="Management view">
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
                    {report.inventory ? (
                      <p className="misRemark">
                        Inventory snapshot: {money(report.inventory.physical, { digits: 2 })}
                        {report.inventory.days != null ? ` · ~${report.inventory.days} days on hand` : ""}
                      </p>
                    ) : (
                      <p className="misRemark">
                        Physical inventory is not in the live BI cube. Optional setting key
                        {" "}
                        <code>mis_inventory_physical_v1</code>
                        {" "}
                        can publish month + amount for days-on-hand.
                      </p>
                    )}
                    <p className="misMeta">
                      Rows: sales {report.meta?.salesRowCount ?? "—"} · receipts {report.meta?.receiptRowCount ?? "—"} · outstanding {report.meta?.outstandingRowCount ?? "—"}
                    </p>
                  </Section>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
