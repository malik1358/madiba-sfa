"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { formatStockQty, STOCK_TAKE_UOM } from "../../lib/stockTake";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Stock Take", ar: "جرد المخزون" },
  subtitle: { en: "Scan barcode, confirm item and unit, enter qty, save.", ar: "امسح الباركود، تأكد من الصنف والوحدة، أدخل الكمية واحفظ." },
  back: { en: "← Dashboard", ar: "← الرئيسية" },
  report: { en: "Report", ar: "التقرير" },
  warehouse: { en: "Warehouse name", ar: "اسم المستودع" },
  start: { en: "Start inventory", ar: "بدء الجرد" },
  changeWarehouse: { en: "Change warehouse", ar: "تغيير المستودع" },
  barcode: { en: "Barcode", ar: "الباركود" },
  qty: { en: "Quantity", ar: "الكمية" },
  unit: { en: "Unit", ar: "الوحدة" },
  item: { en: "Item", ar: "الصنف" },
  pallet: { en: "Pallet (optional)", ar: "الباليت (اختياري)" },
  location: { en: "Location (optional)", ar: "الموقع (اختياري)" },
  save: { en: "Save line", ar: "حفظ السطر" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  starting: { en: "Starting...", ar: "جاري البدء..." },
  loading: { en: "Loading stock take...", ar: "جاري تحميل الجرد..." },
  denied: { en: "Stock Take is not enabled for your user. Ask an admin to tick Stock Take on Salesman Hierarchy.", ar: "الجرد غير مفعّل لحسابك. اطلب من المدير تحديد الجرد في هيكل المندوبين." },
  recent: { en: "Saved on this count", ar: "المحفوظ في هذا الجرد" },
  qtyBase: { en: "Base qty", ar: "كمية الأساس" },
  qtyMaster: { en: "Master qty", ar: "كمية الكرتون" },
  warehouseHint: { en: "Required before scanning. Type the warehouse you are counting.", ar: "مطلوب قبل المسح. اكتب المستودع الذي تجرده." },
};

const SESSION_KEY = "madiba-sfa:stock-take-session";

function readSavedSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function StockTakePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const barcodeRef = useRef(null);
  const [warehouseInput, setWarehouseInput] = useState("");
  const [session, setSession] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [item, setItem] = useState(null);
  const [scannedUom, setScannedUom] = useState("");
  const [needsUom, setNeedsUom] = useState(false);
  const [qty, setQty] = useState("");
  const [pallet, setPallet] = useState("");
  const [location, setLocation] = useState("");
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  usePopupMessages({ message, error });

  useEffect(() => {
    const saved = readSavedSession();
    if (saved?.id && saved?.warehouse_name) {
      setSession(saved);
      setWarehouseInput(saved.warehouse_name);
    }
  }, []);

  useEffect(() => {
    if (!session?.id) return undefined;
    loadSessionLines(session.id);
    return undefined;
  }, [session?.id]);

  async function authHeaders() {
    const supabase = getSupabaseClient();
    const sessionAuth = await resolveAuthSession(supabase);
    if (!sessionAuth?.access_token) throw new Error("Please login again.");
    return { Authorization: `Bearer ${sessionAuth.access_token}` };
  }

  async function startSession(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "start-session", warehouse: warehouseInput }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to start inventory.");
      setSession(payload.session);
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload.session));
      setMessage(`Counting ${payload.session.warehouse_name}`);
      setTimeout(() => barcodeRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message || "Unable to start inventory.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSessionLines(sessionId) {
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/stock-take?action=session-lines&sessionId=${encodeURIComponent(sessionId)}`,
        { headers: await authHeaders() },
      );
      if (response.ok && payload.success) setLines(payload.lines || []);
    } catch {
      // Keep counting usable if recent lines fail to refresh.
    }
  }

  async function lookupBarcode(nextBarcode) {
    const code = String(nextBarcode || "").trim();
    if (!code) return;
    setError("");
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/stock-take?action=lookup&barcode=${encodeURIComponent(code)}`,
        { headers: await authHeaders() },
      );
      if (!response.ok || !payload.success) throw new Error(payload.error || "Barcode not found.");
      setItem(payload.item);
      setScannedUom(payload.scannedUom || "");
      setNeedsUom(Boolean(payload.needsUom));
    } catch (err) {
      setItem(null);
      setScannedUom("");
      setNeedsUom(false);
      setError(err.message || "Barcode not found.");
    }
  }

  async function saveLine(event) {
    event.preventDefault();
    if (!session?.id) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          mode: "save-line",
          sessionId: session.id,
          warehouse: session.warehouse_name,
          barcode,
          qty,
          scannedUom,
          pallet,
          location,
        }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to save line.");
      setLines((current) => [payload.line, ...current].slice(0, 30));
      setMessage(`${payload.line.item_name} · ${formatStockQty(payload.line.qty_base)} base / ${formatStockQty(payload.line.qty_master)} master`);
      setBarcode("");
      setQty("");
      setItem(null);
      setScannedUom("");
      setNeedsUom(false);
      setTimeout(() => barcodeRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message || "Unable to save line.");
    } finally {
      setSaving(false);
    }
  }

  function resetWarehouse() {
    setSession(null);
    setLines([]);
    window.sessionStorage.removeItem(SESSION_KEY);
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return <SupabaseUnavailable title="Stock Take unavailable" message="Set Supabase keys to use stock take." />;
  }

  if (accessLoading) {
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
            <div className="moduleHeader">
              <div>
                <p className="moduleEyebrow">MADIBA SFA</p>
                <h1>{t("title")}</h1>
              </div>
              <div className="moduleHeaderMeta">
                <AppLanguageSwitch language={language} setLanguage={setLanguage} />
                <MostVisitedPages />
                <Link href="/" className="moduleBackLink">{t("back")}</Link>
              </div>
            </div>
            <div className="moduleHint">{t("denied")}</div>
          </div>
        </main>
      </MorningAttendanceGate>
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell stockTakeShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <MostVisitedPages />
              <Link href="/management/stock-take/report" className="moduleInlineButton">{t("report")}</Link>
              <Link href="/" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {!session ? (
            <section className="moduleSection">
              <p className="moduleHint">{t("warehouseHint")}</p>
              <form className="moduleFormGrid" onSubmit={startSession}>
                <label>
                  {t("warehouse")}
                  <input
                    className="moduleInput stockTakeBarcodeInput"
                    required
                    autoFocus
                    value={warehouseInput}
                    onChange={(event) => setWarehouseInput(event.target.value)}
                    placeholder="Riyadh DC"
                  />
                </label>
                <div className="moduleFieldFull">
                  <button className="modulePrimaryButton" type="submit" disabled={loading}>
                    {loading ? t("starting") : t("start")}
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <>
              <section className="moduleSection stockTakeCountCard">
                <div className="moduleSectionHeader">
                  <h2>{session.warehouse_name}</h2>
                  <button type="button" className="moduleInlineButton" onClick={resetWarehouse}>{t("changeWarehouse")}</button>
                </div>
                <form className="stockTakeForm" onSubmit={saveLine}>
                  <label>
                    {t("barcode")}
                    <input
                      ref={barcodeRef}
                      className="moduleInput stockTakeBarcodeInput"
                      autoFocus
                      autoComplete="off"
                      value={barcode}
                      onChange={(event) => {
                        setBarcode(event.target.value);
                        setItem(null);
                      }}
                      onBlur={() => lookupBarcode(barcode)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          lookupBarcode(barcode);
                          document.getElementById("stock-take-qty")?.focus();
                        }
                      }}
                    />
                  </label>

                  {item ? (
                    <div className="stockTakeItemBox">
                      <strong>{item.item_name}</strong>
                      <div className="moduleCode">{item.item_code}</div>
                      <div className="moduleHint">
                        {t("unit")}: {needsUom && !scannedUom ? "—" : (item && scannedUom === STOCK_TAKE_UOM.MID ? item.mid_uom : scannedUom === STOCK_TAKE_UOM.MASTER ? item.master_uom : item.base_uom)}
                        {" · "}1 {item.master_uom} = {formatStockQty(item.base_uom_pack_size)} {item.base_uom}
                        {Number(item.mid_uom_pack_size) > 0 ? ` · 1 ${item.mid_uom} = ${formatStockQty(item.mid_uom_pack_size)} ${item.base_uom}` : ""}
                      </div>
                    </div>
                  ) : null}

                  {needsUom ? (
                    <label>
                      {t("unit")}
                      <select
                        className="moduleInput"
                        required
                        value={scannedUom}
                        onChange={(event) => setScannedUom(event.target.value)}
                      >
                        <option value="">Select unit</option>
                        <option value={STOCK_TAKE_UOM.BASE}>{item?.base_uom || "Base"}</option>
                        <option value={STOCK_TAKE_UOM.MID}>{item?.mid_uom || "MID"}</option>
                        <option value={STOCK_TAKE_UOM.MASTER}>{item?.master_uom || "Master"}</option>
                      </select>
                    </label>
                  ) : null}

                  <label>
                    {t("qty")}
                    <input
                      id="stock-take-qty"
                      className="moduleInput stockTakeBarcodeInput"
                      inputMode="decimal"
                      value={qty}
                      onChange={(event) => setQty(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    {t("pallet")}
                    <input className="moduleInput" value={pallet} onChange={(event) => setPallet(event.target.value)} />
                  </label>
                  <label>
                    {t("location")}
                    <input className="moduleInput" value={location} onChange={(event) => setLocation(event.target.value)} />
                  </label>
                  <button className="modulePrimaryButton" type="submit" disabled={saving || !item}>
                    {saving ? t("saving") : t("save")}
                  </button>
                </form>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("recent")}</h2>
                </div>
                <div className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>{t("item")}</th>
                        <th>{t("unit")}</th>
                        <th>{t("qty")}</th>
                        <th>{t("qtyBase")}</th>
                        <th>{t("qtyMaster")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td>
                            <strong>{line.item_name}</strong>
                            <div className="moduleCode">{line.item_code}</div>
                            {(line.pallet_ref || line.location_ref) ? (
                              <div className="moduleHint">{[line.pallet_ref, line.location_ref].filter(Boolean).join(" · ")}</div>
                            ) : null}
                          </td>
                          <td>{line.scanned_uom_label || line.scanned_uom}</td>
                          <td>{formatStockQty(line.qty_entered)}</td>
                          <td>{formatStockQty(line.qty_base)}</td>
                          <td>{formatStockQty(line.qty_master)}</td>
                        </tr>
                      ))}
                      {lines.length === 0 ? (
                        <tr><td colSpan={5}>No lines yet.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
