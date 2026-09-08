"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../../components/MorningAttendanceGate";
import MostVisitedPages from "../../../components/MostVisitedPages";
import SupabaseUnavailable from "../../../components/SupabaseUnavailable";
import ExportableTable from "../../../components/ExportableTable";
import { translate, useAppLanguage } from "../../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../../lib/authSession";
import { getSupabaseClient } from "../../../lib/supabase";
import { usePopupMessages } from "../../../hooks/usePopupMessages";
import { formatStockQty } from "../../../lib/stockTake";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { formatKsaDateTime } from "../../../lib/workdayActivity";

const TEXT = {
  title: { en: "Stock Take Report", ar: "تقرير الجرد" },
  subtitle: { en: "Every scan: item, why it converted, who counted it, optional pallet/location.", ar: "كل مسح: الصنف، التحويل، من جرده، والباليت/الموقع إن وُجد." },
  back: { en: "← Count", ar: "← الجرد" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  warehouse: { en: "Warehouse", ar: "المستودع" },
  refresh: { en: "Refresh", ar: "تحديث" },
  master: { en: "Upload item master", ar: "رفع أصناف الجرد" },
  system: { en: "Upload system inventory (base unit)", ar: "رفع مخزون النظام (وحدة الأساس)" },
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
                  {lines.map((line) => (
                    <tr key={line.id}>
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
                  ))}
                  {lines.length === 0 ? (
                    <tr><td colSpan={12}>No scans yet.</td></tr>
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
