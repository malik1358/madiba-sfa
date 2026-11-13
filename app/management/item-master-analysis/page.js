"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { isAdminRole } from "../../lib/moduleAccess";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const TEXT = {
  title: { en: "Item Master Analysis", ar: "تحليل أصناف المخزون" },
  subtitle: {
    en: "Tally stock items joined with the Swamiji Google Sheet Item Master, refreshed from Power BI every 8 hours.",
    ar: "أصناف تالي معروضة مع ورقة جوجل لمعلم الأصناف، وتُحدَّث من Power BI كل 8 ساعات.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  syncNow: { en: "Sync now", ar: "مزامنة الآن" },
  syncing: { en: "Syncing...", ar: "جاري المزامنة..." },
  lastSync: { en: "Last sync", ar: "آخر مزامنة" },
  neverSynced: { en: "Never synced", ar: "لم تتم المزامنة بعد" },
  source: { en: "Source", ar: "المصدر" },
  rows: { en: "Rows", ar: "الصفوف" },
  importOrLocal: { en: "Import / Local", ar: "استيراد / محلي" },
  mainGroup: { en: "Main group", ar: "المجموعة الرئيسية" },
  subGroup: { en: "Sub group", ar: "المجموعة الفرعية" },
  category: { en: "Category", ar: "الفئة" },
  tallyCode: { en: "Tally item code", ar: "رمز صنف تالي" },
  tallyName: { en: "Tally item name", ar: "اسم صنف تالي" },
  articleNo: { en: "Google article no", ar: "رقم مقال جوجل" },
  articleName: { en: "Google common name", ar: "الاسم الشائع في جوجل" },
  brand: { en: "Brand", ar: "العلامة" },
  baseUom: { en: "Base UOM", ar: "وحدة الأساس" },
  altUom: { en: "Alt UOM", ar: "الوحدة البديلة" },
  altConv: { en: "Alt UOM conv", ar: "معامل الوحدة البديلة" },
  total: { en: "Total", ar: "الإجمالي" },
  noRows: {
    en: "No mirrored rows yet. Run Sync now (admin) or wait for the 8-hour cron after Power BI secrets are set.",
    ar: "لا توجد صفوف بعد. شغّل المزامنة (أدمن) أو انتظر مهمة الـ 8 ساعات بعد ضبط أسرار Power BI.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
};

const FILTER_KEYS = [
  "importOrLocal",
  "mainGroup",
  "subGroup",
  "category",
  "tallyItemCode",
  "tallyItemName",
  "googleArticleNo",
  "googleArticleCommonName",
  "brandName",
  "tallyBaseUom",
  "tallyAltUom",
  "tallyAltUomConv",
];

function formatConv(value) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-SA", { maximumFractionDigits: 6 });
}

function formatSyncTime(iso) {
  const text = String(iso || "").trim();
  if (!text) return "";
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
  if (key === "tallyAltUomConv") return formatConv(row.tallyAltUomConv);
  return String(row?.[key] ?? "");
}

export default function ItemMasterAnalysisPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [canSync, setCanSync] = useState(false);
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      setCanSync(isAdminRole(profile?.role));

      const response = await fetch("/api/item-master-analysis", {
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

  const runSync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase);
      const token = session?.access_token || "";
      if (!token) {
        setSignedOut(true);
        return;
      }
      const response = await fetch("/api/admin/item-master-analysis-sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Sync failed.");
      }
      await loadReport();
    } catch (err) {
      setError(err.message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [loadReport]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const rows = useMemo(() => (Array.isArray(report?.rows) ? report.rows : []), [report]);
  const filterValueOf = useMemo(() => (row, key) => cellValue(row, key), []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, filterValueOf);

  const totals = useMemo(() => {
    let altConv = 0;
    visibleRows.forEach((row) => {
      const num = Number(row.tallyAltUomConv);
      if (Number.isFinite(num)) altConv += num;
    });
    return {
      rowCount: visibleRows.length,
      altConv: Math.round(altConv * 1e6) / 1e6,
    };
  }, [visibleRows]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Item Master Analysis unavailable"
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

  const syncStamp = report?.sync;
  const lastSyncLabel = syncStamp?.syncedAt
    ? formatSyncTime(syncStamp.syncedAt)
    : t("neverSynced");

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
              <button type="button" className="moduleInlineButton" onClick={loadReport} disabled={loading || syncing}>
                {t("refresh")}
              </button>
              {canSync ? (
                <button
                  type="button"
                  className="moduleInlineButton"
                  onClick={runSync}
                  disabled={loading || syncing}
                >
                  {syncing ? t("syncing") : t("syncNow")}
                </button>
              ) : null}
            </div>
            <p className="moduleHint">
              {t("lastSync")}: {lastSyncLabel}
              {syncStamp?.source ? ` · ${t("source")}: ${syncStamp.source}` : ""}
              {typeof syncStamp?.rowCount === "number" ? ` · ${t("rows")}: ${syncStamp.rowCount}` : ""}
              {syncStamp?.ok === false && syncStamp?.error ? ` · ${syncStamp.error}` : ""}
            </p>
            {error ? <p className="moduleHint">{error}</p> : null}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable
                filename="item-master-analysis"
                sheetName="Item Master"
                className="moduleTableWrap moduleBiTableWrap"
              >
                <table className="moduleTable moduleBiTable">
                  <thead>
                    <tr>
                      <BiExcelHead label={t("importOrLocal")} filterKey="importOrLocal" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("mainGroup")} filterKey="mainGroup" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("subGroup")} filterKey="subGroup" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("category")} filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("tallyCode")} filterKey="tallyItemCode" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("tallyName")} filterKey="tallyItemName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("articleNo")} filterKey="googleArticleNo" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("articleName")} filterKey="googleArticleCommonName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("brand")} filterKey="brandName" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("baseUom")} filterKey="tallyBaseUom" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("altUom")} filterKey="tallyAltUom" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} />
                      <BiExcelHead label={t("altConv")} filterKey="tallyAltUomConv" options={options} filters={filters} onChange={setFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.rowKey}>
                        <td>{row.importOrLocal || "—"}</td>
                        <td>{row.mainGroup || "—"}</td>
                        <td>{row.subGroup || "—"}</td>
                        <td>{row.category || "—"}</td>
                        <td>{row.tallyItemCode || "—"}</td>
                        <td>{row.tallyItemName || "—"}</td>
                        <td>{row.googleArticleNo || "—"}</td>
                        <td>{row.googleArticleCommonName || "—"}</td>
                        <td>{row.brandName || "—"}</td>
                        <td>{row.tallyBaseUom || "—"}</td>
                        <td>{row.tallyAltUom || "—"}</td>
                        <td className="moduleBiTotalCol">{formatConv(row.tallyAltUomConv)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("total")}</td>
                      <td colSpan={10}>{totals.rowCount}</td>
                      <td className="moduleBiTotalCol">{formatConv(totals.altConv)}</td>
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
