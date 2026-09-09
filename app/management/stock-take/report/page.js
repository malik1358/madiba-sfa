"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../../components/MorningAttendanceGate";
import MostVisitedPages from "../../../components/MostVisitedPages";
import SupabaseUnavailable from "../../../components/SupabaseUnavailable";
import ExportableTable from "../../../components/ExportableTable";
import { translate, useAppLanguage } from "../../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../../lib/authSession";
import { getSupabaseClient } from "../../../lib/supabase";
import { usePopupMessages } from "../../../hooks/usePopupMessages";
import { consolidateStockTakeReportLines, formatStockQty } from "../../../lib/stockTake";
import {
  stockTakeMasterTemplateMatrix,
  stockTakeSystemTemplateMatrix,
} from "../../../lib/stockTakeMasterImport";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { formatKsaDateTime } from "../../../lib/workdayActivity";

const TEXT = {
  title: { en: "Stock Take Report", ar: "تقرير الجرد" },
  subtitle: {
    en: "One row per item and warehouse with summed qty. Click + to see each scan.",
    ar: "صف واحد لكل صنف ومستودع بالكميات المجمّعة. اضغط + لعرض كل مسح.",
  },
  scans: { en: "scans", ar: "مسح" },
  lastScan: { en: "Last", ar: "آخر" },
  expand: { en: "Show scans", ar: "عرض المسوحات" },
  collapse: { en: "Hide scans", ar: "إخفاء المسوحات" },
  back: { en: "← Count", ar: "← الجرد" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  warehouse: { en: "Warehouse", ar: "المستودع" },
  refresh: { en: "Refresh", ar: "تحديث" },
  master: { en: "Upload item master", ar: "رفع أصناف الجرد" },
  system: { en: "Upload system inventory (base unit)", ar: "رفع مخزون النظام (وحدة الأساس)" },
  downloadMasterTemplate: { en: "Download item master template", ar: "تنزيل قالب أصناف الجرد" },
  downloadSystemTemplate: { en: "Download system inventory template", ar: "تنزيل قالب مخزون النظام" },
  uploading: { en: "Uploading...", ar: "جاري الرفع..." },
  denied: { en: "Stock Take is not enabled for your user.", ar: "الجرد غير مفعّل لحسابك." },
  user: { en: "User", ar: "المستخدم" },
  item: { en: "Item", ar: "الصنف" },
  barcode: { en: "Barcode", ar: "الباركود" },
  unit: { en: "Unit scanned", ar: "الوحدة الممسوحة" },
  qty: { en: "Qty entered", ar: "الكمية المدخلة" },
  qtyBase: { en: "Qty base", ar: "كمية الأساس" },
  qtyMaster: { en: "Qty master", ar: "كمية الكرتون" },
  systemQty: { en: "System qty (base)", ar: "كمية النظام (أساس)" },
  pallet: { en: "Pallet", ar: "الباليت" },
  location: { en: "Location", ar: "الموقع" },
  time: { en: "Time", ar: "الوقت" },
  masterHint: {
    en: "Excel columns: Product Code, Item Name, Base UOM, MID UOM, Master UOM, Base UOM Pack Size (base units in 1 master), MID UOM Pack Size (base units in 1 mid), Base Barcode, MID Barcode, Master Barcode. Sheet named Master is preferred.",
    ar: "أعمدة الإكسل: رمز المنتج، الاسم، وحدات الأساس/الأوسط/الكرتون، أحجام التعبئة، والباركود لكل وحدة. يُفضّل ورقة Master.",
  },
};

export default function StockTakeReportPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const [warehouse, setWarehouse] = useState("");
  const [lines, setLines] = useState([]);
  const [systemItemCount, setSystemItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const groups = useMemo(() => consolidateStockTakeReportLines(lines), [lines]);

  usePopupMessages({ message, error });

  async function authHeaders() {
    const supabase = getSupabaseClient();
    const sessionAuth = await resolveAuthSession(supabase);
    if (!sessionAuth?.access_token) throw new Error("Please login again.");
    return { Authorization: `Bearer ${sessionAuth.access_token}` };
  }

  async function loadReport(nextWarehouse = warehouse) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ action: "report" });
      if (nextWarehouse) params.set("warehouse", nextWarehouse);
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/stock-take?${params.toString()}`,
        { headers: await authHeaders() },
        60000,
      );
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load report.");
      setLines(payload.lines || []);
      setSystemItemCount(payload.systemItemCount || 0);
    } catch (err) {
      setError(err.message || "Unable to load report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!accessLoading && access.canAccess("stockTake")) {
      loadReport("");
    } else if (!accessLoading) {
      setLoading(false);
    }
  }, [accessLoading]);

  async function uploadFile(mode, file) {
    if (!file) return;
    setUploading(mode);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("mode", mode);
      form.set("file", file);
      if (mode === "upload-system") form.set("warehouse", warehouse);
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      }, 60000);
      if (!response.ok || !payload.success) throw new Error(payload.error || "Upload failed.");
      setMessage(payload.message || "Uploaded.");
      await loadReport(warehouse);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading("");
    }
  }

  function toggleGroup(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function downloadTemplate(kind) {
    setError("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      if (kind === "master") {
        const sheet = XLSX.utils.aoa_to_sheet(stockTakeMasterTemplateMatrix());
        XLSX.utils.book_append_sheet(workbook, sheet, "Master");
        XLSX.writeFile(workbook, "stock-take-item-master-template.xlsx");
        return;
      }
      const sheet = XLSX.utils.aoa_to_sheet(stockTakeSystemTemplateMatrix());
      XLSX.utils.book_append_sheet(workbook, sheet, "System");
      XLSX.writeFile(workbook, "stock-take-system-inventory-template.xlsx");
    } catch (err) {
      setError(err.message || "Unable to download template.");
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return <SupabaseUnavailable title="Stock Take unavailable" message="Set Supabase keys to use stock take." />;
  }

  if (accessLoading || loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  if (!access.canAccess("stockTake")) {
    return (
      <MorningAttendanceGate>
        <main className="modulePage" dir={dir}>
          <div className="moduleShell">
            <div className="moduleHint">{t("denied")}</div>
          </div>
        </main>
      </MorningAttendanceGate>
    );
  }

  return (
    <MorningAttendanceGate>
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
              <MostVisitedPages />
              <Link href="/management/stock-take" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <form
              className="moduleFormGrid"
              onSubmit={(event) => {
                event.preventDefault();
                loadReport(warehouse);
              }}
            >
              <label>
                {t("warehouse")}
                <input
                  className="moduleInput"
                  value={warehouse}
                  onChange={(event) => setWarehouse(event.target.value)}
                  placeholder="Filter, and required for system upload"
                />
              </label>
              <div className="moduleFieldFull">
                <button className="modulePrimaryButton" type="submit">{t("refresh")}</button>
              </div>
            </form>
            {systemItemCount > 0 ? (
              <p className="moduleHint">System snapshot for this warehouse: {systemItemCount} items (shown on matching scanned rows only).</p>
            ) : null}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("master")}</h2>
            </div>
            <p className="moduleHint">{t("masterHint")}</p>
            <div className="stockTakeSessionActions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
              <button type="button" className="moduleInlineButton" onClick={() => downloadTemplate("master")}>
                {t("downloadMasterTemplate")}
              </button>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={Boolean(uploading)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                uploadFile("upload-master", file);
                event.target.value = "";
              }}
            />
            {uploading === "upload-master" ? <div className="moduleHint">{t("uploading")}</div> : null}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("system")}</h2>
            </div>
            <div className="stockTakeSessionActions" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
              <button type="button" className="moduleInlineButton" onClick={() => downloadTemplate("system")}>
                {t("downloadSystemTemplate")}
              </button>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={Boolean(uploading) || !warehouse.trim()}
              onChange={(event) => {
                const file = event.target.files?.[0];
                uploadFile("upload-system", file);
                event.target.value = "";
              }}
            />
            {!warehouse.trim() ? <div className="moduleHint">Enter warehouse name above, then upload Item Code + Qty (base unit). Latest file replaces the snapshot for that warehouse.</div> : null}
            {uploading === "upload-system" ? <div className="moduleHint">{t("uploading")}</div> : null}
          </section>

          <section className="moduleSection">
            <ExportableTable filename="stock-take-report" sheetName="StockTake" className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th aria-label={t("expand")} />
                    <th>{t("time")}</th>
                    <th>{t("user")}</th>
                    <th>{t("warehouse")}</th>
                    <th>{t("item")}</th>
                    <th>{t("barcode")}</th>
                    <th>{t("unit")}</th>
                    <th>{t("qty")}</th>
                    <th>{t("qtyBase")}</th>
                    <th>{t("qtyMaster")}</th>
                    <th>{t("systemQty")}</th>
                    <th>{t("pallet")}</th>
                    <th>{t("location")}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.flatMap((group) => {
                    const expanded = expandedKeys.has(group.key);
                    const summary = (
                      <tr key={group.key} className="stockTakeReportSummaryRow">
                        <td>
                          <button
                            type="button"
                            className="stockTakeReportExpandBtn"
                            aria-expanded={expanded}
                            aria-label={expanded ? t("collapse") : t("expand")}
                            onClick={() => toggleGroup(group.key)}
                          >
                            {expanded ? "−" : "+"}
                          </button>
                        </td>
                        <td>
                          {group.last_scanned_at ? `${t("lastScan")} ${formatKsaDateTime(group.last_scanned_at)}` : "—"}
                          <div className="moduleCode">{group.scanCount} {t("scans")}</div>
                        </td>
                        <td>{group.userLabel}</td>
                        <td>{group.warehouse_name}</td>
                        <td>
                          <strong>{group.item_name}</strong>
                          <div className="moduleCode">{group.item_code}</div>
                        </td>
                        <td>{group.barcodeLabel}</td>
                        <td>{group.unitLabel}</td>
                        <td>{group.qtyEnteredLabel == null ? "—" : formatStockQty(group.qtyEnteredLabel)}</td>
                        <td>{formatStockQty(group.qty_base)}</td>
                        <td>{formatStockQty(group.qty_master)}</td>
                        <td>{group.system_qty_base == null ? "—" : formatStockQty(group.system_qty_base)}</td>
                        <td>{group.palletLabel}</td>
                        <td>{group.locationLabel}</td>
                      </tr>
                    );
                    if (!expanded) return [summary];
                    return [
                      summary,
                      ...group.lines.map((line) => (
                        <tr key={`${group.key}-${line.id}`} className="stockTakeReportDetailRow">
                          <td />
                          <td>{formatKsaDateTime(line.scanned_at)}</td>
                          <td>{line.scanned_by_name || line.scanned_by}</td>
                          <td>{line.warehouse_name}</td>
                          <td>
                            <strong>{line.item_name}</strong>
                            <div className="moduleCode">{line.item_code}</div>
                          </td>
                          <td>{line.barcode}</td>
                          <td>{line.scanned_uom_label || line.scanned_uom}</td>
                          <td>{formatStockQty(line.qty_entered)}</td>
                          <td>{formatStockQty(line.qty_base)}</td>
                          <td>{formatStockQty(line.qty_master)}</td>
                          <td>{line.system_qty_base == null ? "—" : formatStockQty(line.system_qty_base)}</td>
                          <td>{line.pallet_ref || "—"}</td>
                          <td>{line.location_ref || "—"}</td>
                        </tr>
                      )),
                    ];
                  })}
                  {groups.length === 0 ? (
                    <tr><td colSpan={13}>No scans yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </ExportableTable>
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
