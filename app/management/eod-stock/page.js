"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { eodQtyMovement, formatEodDelta, formatEodQty } from "../../lib/eodStock.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "End-of-day Stock", ar: "مخزون نهاية اليوم" },
  subtitle: {
    en: "Closing quantity by city from the latest stock upload. Green is higher than the previous stock date, red is lower.",
    ar: "كمية الإغلاق حسب المدينة من آخر رفع للمخزون. الأخضر أعلى من تاريخ المخزون السابق، والأحمر أقل.",
  },
  back: { en: "← Imports", ar: "← الاستيراد" },
  loading: { en: "Loading stock...", ar: "جاري تحميل المخزون..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Item code", ar: "رمز الصنف" },
  item: { en: "Item", ar: "الصنف" },
  unit: { en: "Unit", ar: "الوحدة" },
  riyadh: { en: "Riyadh", ar: "الرياض" },
  dammam: { en: "Dammam", ar: "الدمام" },
  jeddah: { en: "Jeddah", ar: "جدة" },
  total: { en: "Total", ar: "الإجمالي" },
  noRows: { en: "No end-of-day stock has been uploaded yet.", ar: "لم يُرفع مخزون نهاية اليوم بعد." },
  accessDenied: { en: "Only admin, manager, or invoice maker can open this report.", ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير." },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  stockDate: { en: "Stock date", ar: "تاريخ المخزون" },
  previousDate: { en: "Previous stock date", ar: "تاريخ المخزون السابق" },
  items: { en: "Items", ar: "الأصناف" },
  all: { en: "All", ar: "الكل" },
};

const FILTER_KEYS = ["itemCode", "itemName", "unit", "riyadh", "dammam", "jeddah", "total"];
const CITY_KEYS = ["riyadh", "dammam", "jeddah"];

const MOVEMENT_CLASS = {
  up: "moduleBiMonthCell--up",
  down: "moduleBiMonthCell--down",
  current: "moduleBiMonthCell--current",
};

function stockValue(row, key) {
  if (key === "itemCode") return row.itemCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "unit") return row.unit || "";
  return formatEodQty(row[key]);
}

function QtyCell({ qty, previous, hasPrevious, total = false }) {
  const movement = eodQtyMovement(qty, previous, hasPrevious);
  const delta = hasPrevious ? formatEodDelta(qty, previous) : "";
  return (
    <td className={`${MOVEMENT_CLASS[movement]}${total ? " moduleBiTotalCol" : ""}`}>
      <div className="moduleBiAmountDelta">
        <span>{formatEodQty(qty)}</span>
        {delta ? <em>{delta}</em> : null}
      </div>
    </td>
  );
}

export default function EodStockPage() {
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
      const response = await fetch("/api/eod-stock", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load end-of-day stock.");
      setReport(payload);
    } catch (err) {
      setError(err.message || "Unable to load end-of-day stock.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const rows = useMemo(() => (Array.isArray(report?.rows) ? report.rows : []), [report]);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, stockValue);
  const hasPrevious = Boolean(report?.hasPrevious);
  const totals = useMemo(() => {
    const sum = { riyadh: 0, dammam: 0, jeddah: 0, total: 0, riyadhPrev: 0, dammamPrev: 0, jeddahPrev: 0, totalPrev: 0 };
    visibleRows.forEach((row) => {
      CITY_KEYS.forEach((city) => {
        sum[city] += Number(row[city] || 0);
        sum[`${city}Prev`] += Number(row[`${city}Prev`] || 0);
      });
      sum.total += Number(row.total || 0);
      sum.totalPrev += Number(row.totalPrev || 0);
    });
    return sum;
  }, [visibleRows]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="End-of-day stock unavailable"
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
              <Link href="/management/upload" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("title")}</h2>
              <span>{visibleRows.length}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            {report?.stockDate ? (
              <p className="moduleHint">
                {t("stockDate")}: {report.stockDate}
                {report.previousStockDate ? ` · ${t("previousDate")}: ${report.previousStockDate}` : ""}
                {` · ${t("items")}: ${rows.length.toLocaleString()}`}
              </p>
            ) : null}
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="end-of-day-stock-citywise" sheetName="EOD stock" className="moduleTableWrap moduleBiTableWrap">
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("code")} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("item")} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("unit")} filterKey="unit" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("riyadh")} filterKey="riyadh" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("dammam")} filterKey="dammam" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("jeddah")} filterKey="jeddah" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("total")} filterKey="total" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.itemCode}>
                        <td>{row.itemCode}</td>
                        <td>{row.itemName}</td>
                        <td>{row.unit || "—"}</td>
                        {CITY_KEYS.map((city) => (
                          <QtyCell
                            key={city}
                            qty={row[city]}
                            previous={row[`${city}Prev`]}
                            hasPrevious={hasPrevious}
                          />
                        ))}
                        <QtyCell qty={row.total} previous={row.totalPrev} hasPrevious={hasPrevious} total />
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td>{visibleRows.length}</td>
                      <td />
                      {CITY_KEYS.map((city) => (
                        <QtyCell
                          key={city}
                          qty={totals[city]}
                          previous={totals[`${city}Prev`]}
                          hasPrevious={hasPrevious}
                        />
                      ))}
                      <td className="moduleBiTotalCol">{formatEodQty(totals.total)}</td>
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
