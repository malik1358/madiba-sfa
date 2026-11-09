"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { formatEodQty } from "../../lib/eodStock.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Inter-city Stock Transfer", ar: "نقل المخزون بين المدن" },
  subtitle: {
    en: "Real catalogue items with stock in Riyadh but not Dammam (and vice versa). Suggested transfer covers ≥15 days from the destination city’s peak weekly sales in 6 months; never-sold items get a minimum of 5. Building materials and Tally section titles are excluded.",
    ar: "أصناف الكتالوج المتوفرة في الرياض وغير المتوفرة في الدمام (والعكس). النقل المقترح يغطي 15 يوماً على الأقل من أعلى مبيعات أسبوعية للوجهة خلال 6 أشهر؛ الأصناف غير المباعة تحصل على حد أدنى 5. مواد البناء وعناوين أقسام تالي مستثناة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Item code", ar: "رمز الصنف" },
  item: { en: "Item", ar: "الصنف" },
  unit: { en: "Unit", ar: "الوحدة" },
  sourceQty: { en: "{city} qty", ar: "كمية {city}" },
  destQty: { en: "{city} qty", ar: "كمية {city}" },
  peakWeekly: { en: "Peak weekly sales", ar: "أعلى مبيعات أسبوعية" },
  peakWeek: { en: "Peak week", ar: "أسبوع الذروة" },
  dailyDemand: { en: "Daily demand", ar: "الطلب اليومي" },
  targetCover: { en: "15-day target", ar: "هدف 15 يوماً" },
  suggested: { en: "Suggested transfer", ar: "النقل المقترح" },
  afterDest: { en: "After at {city}", ar: "بعد النقل في {city}" },
  remainSource: { en: "Left at {city}", ar: "المتبقي في {city}" },
  daysCover: { en: "Days cover after", ar: "أيام التغطية بعد النقل" },
  total: { en: "Total", ar: "الإجمالي" },
  stockDate: { en: "Stock date", ar: "تاريخ المخزون" },
  salesWindow: { en: "Sales window", ar: "فترة المبيعات" },
  riyadh: { en: "Riyadh", ar: "الرياض" },
  dammam: { en: "Dammam", ar: "الدمام" },
  riyadhToDammam: { en: "Riyadh → Dammam", ar: "الرياض ← الدمام" },
  dammamToRiyadh: { en: "Dammam → Riyadh", ar: "الدمام ← الرياض" },
  items: { en: "Items", ar: "الأصناف" },
  suggestedTotal: { en: "Suggested qty", ar: "الكمية المقترحة" },
  noRows: {
    en: "No items are stocked in only one of Riyadh or Dammam on the latest end-of-day file.",
    ar: "لا توجد أصناف متوفرة في مدينة واحدة فقط من الرياض أو الدمام في آخر ملف مخزون.",
  },
  noStock: {
    en: "Upload end-of-day stock for Riyadh and Dammam first (Imports → End-of-day Stock).",
    ar: "ارفع أولاً مخزون نهاية اليوم للرياض والدمام (الاستيراد ← مخزون نهاية اليوم).",
  },
  capped: { en: "Capped by source stock", ar: "محدود بمخزون المصدر" },
  unsoldMin: { en: "Min 5 (not sold yet)", ar: "حد أدنى 5 (لم يُبع بعد)" },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
};

const DIRECTION_CITIES = {
  riyadhToDammam: { source: "riyadh", destination: "dammam" },
  dammamToRiyadh: { source: "dammam", destination: "riyadh" },
};

function withCity(template, cityName) {
  return String(template || "").replaceAll("{city}", cityName);
}

const FILTER_KEYS = [
  "itemCode",
  "itemName",
  "unit",
  "sourceQty",
  "destinationQty",
  "peakWeeklyQty",
  "peakWeekKey",
  "dailyDemand",
  "targetCoverQty",
  "suggestedQty",
  "afterAtDestination",
  "remainingAtSource",
  "daysCoverAfter",
];

function formatQty(value) {
  if (value == null || value === "") return "—";
  return formatEodQty(value);
}

function formatDaysCover(value) {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString("en-SA", { maximumFractionDigits: 1 });
}

function cellValue(row, key) {
  if (key === "itemCode") return row.itemCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "unit") return row.unit || "";
  if (key === "peakWeekKey") return row.peakWeekKey || "";
  if (key === "daysCoverAfter") return formatDaysCover(row.daysCoverAfter);
  return formatQty(row[key]);
}

function DirectionTable({
  directionKey,
  rows,
  t,
  filename,
}) {
  const cities = DIRECTION_CITIES[directionKey] || DIRECTION_CITIES.riyadhToDammam;
  const sourceCityName = t(cities.source);
  const destinationCityName = t(cities.destination);
  const sourceQtyLabel = withCity(t("sourceQty"), sourceCityName);
  const destQtyLabel = withCity(t("destQty"), destinationCityName);
  const afterDestLabel = withCity(t("afterDest"), destinationCityName);
  const remainSourceLabel = withCity(t("remainSource"), sourceCityName);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, cellValue);
  const totals = useMemo(() => {
    let sourceQty = 0;
    let suggestedQty = 0;
    let targetCoverQty = 0;
    let peakWeeklyQty = 0;
    visibleRows.forEach((row) => {
      sourceQty += Number(row.sourceQty || 0);
      suggestedQty += Number(row.suggestedQty || 0);
      targetCoverQty += Number(row.targetCoverQty || 0);
      peakWeeklyQty += Number(row.peakWeeklyQty || 0);
    });
    return {
      sourceQty,
      suggestedQty,
      targetCoverQty,
      peakWeeklyQty,
    };
  }, [visibleRows]);

  if (!rows.length) {
    return <div className="moduleHint">{t("noRows")}</div>;
  }

  return (
    <ExportableTable filename={filename} sheetName={directionKey} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <BiExcelHead label={t("code")} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("item")} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("unit")} filterKey="unit" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={sourceQtyLabel} filterKey="sourceQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={destQtyLabel} filterKey="destinationQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("peakWeekly")} filterKey="peakWeeklyQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("peakWeek")} filterKey="peakWeekKey" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("dailyDemand")} filterKey="dailyDemand" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("targetCover")} filterKey="targetCoverQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("suggested")} filterKey="suggestedQty" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
            <BiExcelHead label={afterDestLabel} filterKey="afterAtDestination" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={remainSourceLabel} filterKey="remainingAtSource" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
            <BiExcelHead label={t("daysCover")} filterKey="daysCoverAfter" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={`${directionKey}-${row.itemCode}`}>
              <td>{row.itemCode}</td>
              <td>{row.itemName}</td>
              <td>{row.unit || "—"}</td>
              <td>{formatQty(row.sourceQty)}</td>
              <td>{formatQty(row.destinationQty)}</td>
              <td>{formatQty(row.peakWeeklyQty)}</td>
              <td>{row.peakWeekKey || "—"}</td>
              <td>{formatQty(row.dailyDemand)}</td>
              <td>{formatQty(row.targetCoverQty)}</td>
              <td className="moduleBiTotalCol moduleBiMonthCell--current">
                <div className="moduleBiAmountDelta">
                  <span>{formatQty(row.suggestedQty)}</span>
                  {row.cappedBySource ? <em>{t("capped")}</em> : null}
                  {!row.cappedBySource && row.usedUnsoldMinimum ? <em>{t("unsoldMin")}</em> : null}
                </div>
              </td>
              <td className="moduleBiMonthCell--up">{formatQty(row.afterAtDestination)}</td>
              <td className={Number(row.remainingAtSource) < Number(row.sourceQty) ? "moduleBiMonthCell--down" : ""}>
                {formatQty(row.remainingAtSource)}
              </td>
              <td>{formatDaysCover(row.daysCoverAfter)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t("total")}</td>
            <td>{visibleRows.length}</td>
            <td />
            <td>{formatQty(totals.sourceQty)}</td>
            <td />
            <td>{formatQty(totals.peakWeeklyQty)}</td>
            <td />
            <td />
            <td>{formatQty(totals.targetCoverQty)}</td>
            <td className="moduleBiTotalCol">{formatQty(totals.suggestedQty)}</td>
            <td />
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}

export default function InterCityStockTransferPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [report, setReport] = useState(null);
  const [direction, setDirection] = useState("riyadhToDammam");

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
      const response = await fetch("/api/inter-city-stock-transfer", {
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

  const activeDirection = report?.directions?.[direction] || null;
  const rows = useMemo(
    () => (Array.isArray(activeDirection?.rows) ? activeDirection.rows : []),
    [activeDirection],
  );

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Inter-city stock transfer unavailable"
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
    : "";
  const summary = report?.summary || {};

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
              <span>{rows.length}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            <p className="moduleHint">
              {t("stockDate")}: {report?.stockDate || "—"}
              {windowLabel ? ` · ${t("salesWindow")}: ${windowLabel}` : ""}
              {` · ${t("riyadhToDammam")}: ${summary.riyadhToDammamItems || 0} (${t("suggestedTotal")} ${formatQty(summary.riyadhToDammamSuggestedQty || 0)})`}
              {` · ${t("dammamToRiyadh")}: ${summary.dammamToRiyadhItems || 0} (${t("suggestedTotal")} ${formatQty(summary.dammamToRiyadhSuggestedQty || 0)})`}
            </p>

            <div className="moduleInlineActions" style={{ marginBottom: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`moduleInlineButton${direction === "riyadhToDammam" ? " moduleInlineButton--active" : ""}`}
                onClick={() => setDirection("riyadhToDammam")}
              >
                {t("riyadhToDammam")} ({summary.riyadhToDammamItems || 0})
              </button>
              <button
                type="button"
                className={`moduleInlineButton${direction === "dammamToRiyadh" ? " moduleInlineButton--active" : ""}`}
                onClick={() => setDirection("dammamToRiyadh")}
              >
                {t("dammamToRiyadh")} ({summary.dammamToRiyadhItems || 0})
              </button>
            </div>

            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : !report?.stockDate ? (
              <div className="moduleHint">{t("noStock")}</div>
            ) : (
              <DirectionTable
                directionKey={direction}
                rows={rows}
                t={t}
                filename={`inter-city-stock-${direction}`}
              />
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
