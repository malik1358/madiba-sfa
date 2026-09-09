"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { availableStockTakeUnits, focusStockTakeAfterLookup, formatStockQty, previewConvertedQty, uomLabel, warehouseKey } from "../../lib/stockTake";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { formatKsaDateOnly, formatKsaTime } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "Stock Take", ar: "جرد المخزون" },
  subtitle: { en: "Enter barcode or item code, confirm name and unit, enter qty, save.", ar: "أدخل الباركود أو رمز الصنف، تأكد من الاسم والوحدة، أدخل الكمية واحفظ." },
  back: { en: "← Dashboard", ar: "← الرئيسية" },
  report: { en: "Report", ar: "التقرير" },
  warehouse: { en: "Warehouse name", ar: "اسم المستودع" },
  start: { en: "Start inventory", ar: "بدء الجرد" },
  changeWarehouse: { en: "Inventories", ar: "الجردات" },
  openInventories: { en: "Open inventories", ar: "الجردات المفتوحة" },
  openInventoriesHint: { en: "Select an inventory you opened, or one shared with you. Archive old counts so the same warehouse can be started again.", ar: "اختر جردًا فتحته أنت أو جردًا شاركه معك مستخدم آخر. أرشف الجردات القديمة حتى يمكن بدء نفس المستودع من جديد." },
  noneOpen: { en: "No open inventories yet.", ar: "لا توجد جردات مفتوحة." },
  openedBy: { en: "Opened by", ar: "فتحه" },
  access: { en: "Access", ar: "الصلاحية" },
  mine: { en: "Opened by me", ar: "فتحته أنا" },
  sharedWithMe: { en: "Shared with me", ar: "مشارك معي" },
  sharedWith: { en: "Shared with", ar: "مشارك مع" },
  openCount: { en: "Open", ar: "فتح" },
  share: { en: "Share", ar: "مشاركة" },
  sharing: { en: "Sharing...", ar: "جاري المشاركة..." },
  shareUser: { en: "Share with user", ar: "مشاركة مع مستخدم" },
  selectUser: { en: "Select user", ar: "اختر المستخدم" },
  archive: { en: "Archive", ar: "أرشفة" },
  archiving: { en: "Archiving...", ar: "جاري الأرشفة..." },
  archiveConfirm: { en: "Archive this inventory? It will leave the open list. Counted lines stay on the report.", ar: "أرشفة هذا الجرد؟ سيخرج من القائمة المفتوحة وتبقى الأسطر في التقرير." },
  barcode: { en: "Barcode", ar: "الباركود" },
  itemCode: { en: "Item code", ar: "رمز الصنف" },
  itemName: { en: "Name", ar: "الاسم" },
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
  qtyMid: { en: "MID qty", ar: "كمية الأوسط" },
  qtyMaster: { en: "Master qty", ar: "كمية الكرتون" },
  converted: { en: "Converted quantity", ar: "الكمية المحوّلة" },
  date: { en: "Date", ar: "التاريخ" },
  time: { en: "Time", ar: "الوقت" },
  warehouseHint: { en: "Start a new count by typing the warehouse name.", ar: "ابدأ جردًا جديدًا بكتابة اسم المستودع." },
};

export default function StockTakePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: accessLoading } = useModuleAccess();
  const barcodeRef = useRef(null);
  const itemCodeRef = useRef(null);
  const [warehouseInput, setWarehouseInput] = useState("");
  const [session, setSession] = useState(null);
  const [openSessions, setOpenSessions] = useState([]);
  const [shareUsers, setShareUsers] = useState([]);
  const [shareUserBySession, setShareUserBySession] = useState({});
  const [sharingId, setSharingId] = useState("");
  const [archivingId, setArchivingId] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [barcode, setBarcode] = useState("");
  const [itemCodeInput, setItemCodeInput] = useState("");
  const [item, setItem] = useState(null);
  const [lookupMode, setLookupMode] = useState("");
  const [scannedUom, setScannedUom] = useState("");
  const [unitLocked, setUnitLocked] = useState(false);
  const [qty, setQty] = useState("");
  const [pallet, setPallet] = useState("");
  const [location, setLocation] = useState("");
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  usePopupMessages({ message, error });

  const converted = useMemo(() => {
    if (!item || !scannedUom) return null;
    return previewConvertedQty({
      qtyEntered: qty,
      scannedUom,
      baseUomPackSize: item.base_uom_pack_size,
      midUomPackSize: item.mid_uom_pack_size,
    });
  }, [item, qty, scannedUom]);

  const canUseStockTake = access.canAccess("stockTake");

  useEffect(() => {
    if (session?.id || accessLoading || !canUseStockTake) return undefined;
    loadOpenSessions();
    return undefined;
  }, [session?.id, accessLoading, canUseStockTake]);

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

  function clearLookup() {
    setItem(null);
    setLookupMode("");
    setScannedUom("");
    setUnitLocked(false);
  }

  async function startSession(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const duplicate = openSessions.find((row) => warehouseKey(row.warehouse_name) === warehouseKey(warehouseInput));
    if (duplicate) {
      setError("An open inventory already exists for this warehouse. Open it from the list instead of starting a new one.");
      return;
    }
    setLoading(true);
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "start-session", warehouse: warehouseInput }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to start inventory.");
      setSession(payload.session);
      setMessage(`Counting ${payload.session.warehouse_name}`);
      setTimeout(() => barcodeRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message || "Unable to start inventory.");
    } finally {
      setLoading(false);
    }
  }

  async function loadOpenSessions() {
    setLoadingSessions(true);
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        "/api/stock-take?action=open-sessions",
        { headers: await authHeaders() },
      );
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load inventories.");
      setOpenSessions(payload.sessions || []);
      setShareUsers(payload.shareUsers || []);
    } catch (err) {
      setOpenSessions([]);
      setError(err.message || "Unable to load inventories.");
    } finally {
      setLoadingSessions(false);
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

  async function lookup({ nextBarcode, nextItemCode }) {
    const barcodeValue = String(nextBarcode || "").trim();
    const itemCodeValue = String(nextItemCode || "").trim();
    if (!barcodeValue && !itemCodeValue) return;
    setError("");
    try {
      const params = new URLSearchParams({ action: "lookup" });
      if (barcodeValue) params.set("barcode", barcodeValue);
      else params.set("itemCode", itemCodeValue);
      const { response, payload } = await fetchJsonWithTimeout(
        `/api/stock-take?${params.toString()}`,
        { headers: await authHeaders() },
      );
      if (!response.ok || !payload.success) throw new Error(payload.error || "Item not found.");
      setItem(payload.item);
      setLookupMode(payload.lookupMode || "");
      setItemCodeInput(payload.item.item_code || itemCodeValue);
      const units = availableStockTakeUnits(payload.item);
      const locked = Boolean(payload.unitLocked);
      const nextUom = locked
        ? (payload.scannedUom || "")
        : (units.length === 1 ? units[0].kind : (payload.scannedUom || ""));
      setScannedUom(nextUom);
      setUnitLocked(locked);
      return { ...payload, scannedUom: nextUom, unitCount: units.length };
    } catch (err) {
      clearLookup();
      setError(err.message || "Item not found.");
      return null;
    }
  }

  function openUnitPicker() {
    const unitEl = document.getElementById("stock-take-unit");
    if (!unitEl) return;
    unitEl.focus();
    if (typeof unitEl.showPicker === "function") {
      try {
        unitEl.showPicker();
      } catch {
        // Native picker can throw when the call is not tied to a user gesture.
      }
    }
  }

  function advanceAfterLookup(payload) {
    if (!payload) return;
    const units = availableStockTakeUnits(payload.item);
    const target = focusStockTakeAfterLookup({
      lookupMode: payload.lookupMode,
      unitLocked: payload.unitLocked,
      unitCount: units.length,
    });
    window.setTimeout(() => {
      if (target === "qty") document.getElementById("stock-take-qty")?.focus();
      else openUnitPicker();
    }, 0);
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
          itemCode: item?.item_code || itemCodeInput,
          qty,
          scannedUom,
          pallet,
          location,
        }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to save line.");
      setLines((current) => [payload.line, ...current].slice(0, 500));
      setMessage(`${payload.line.item_name} · ${formatStockQty(payload.line.qty_base)} base / ${formatStockQty(payload.line.qty_mid)} mid / ${formatStockQty(payload.line.qty_master)} master`);
      setBarcode("");
      setItemCodeInput("");
      setQty("");
      clearLookup();
      setTimeout(() => barcodeRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message || "Unable to save line.");
    } finally {
      setSaving(false);
    }
  }

  function openSelectedSession(nextSession) {
    setError("");
    setMessage("");
    setSession(nextSession);
    setWarehouseInput(nextSession.warehouse_name || "");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  async function shareSession(sessionId) {
    const userId = shareUserBySession[sessionId];
    if (!userId) {
      setError("Select a user to share with.");
      return;
    }
    setSharingId(sessionId);
    setError("");
    setMessage("");
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "share-session", sessionId, userId }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to share inventory.");
      setMessage("Inventory shared.");
      await loadOpenSessions();
    } catch (err) {
      setError(err.message || "Unable to share inventory.");
    } finally {
      setSharingId("");
    }
  }

  async function archiveSession(row) {
    if (!window.confirm(t("archiveConfirm"))) return;
    setArchivingId(row.id);
    setError("");
    setMessage("");
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ mode: "archive-session", sessionId: row.id }),
      });
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to archive inventory.");
      if (session?.id === row.id) {
        setSession(null);
        setLines([]);
      }
      setMessage(`${row.warehouse_name} archived.`);
      await loadOpenSessions();
    } catch (err) {
      setError(err.message || "Unable to archive inventory.");
    } finally {
      setArchivingId("");
    }
  }

  function resetWarehouse() {
    setSession(null);
    setLines([]);
  }

  const lockedUnitLabel = item && scannedUom ? uomLabel(item, scannedUom) : "";
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
            <>
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("openInventories")}</h2>
                </div>
                <p className="moduleHint">{t("openInventoriesHint")}</p>
                {loadingSessions ? (
                  <div className="moduleHint">{t("loading")}</div>
                ) : (
                  <div className="moduleTableWrap">
                    <table className="moduleTable">
                      <thead>
                        <tr>
                          <th>{t("warehouse")}</th>
                          <th>{t("openedBy")}</th>
                          <th>{t("date")}</th>
                          <th>{t("time")}</th>
                          <th>{t("access")}</th>
                          <th>{t("share")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openSessions.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <strong>{row.warehouse_name}</strong>
                            </td>
                            <td>{row.started_by_name || "—"}</td>
                            <td>{formatKsaDateOnly(row.started_at)}</td>
                            <td>{formatKsaTime(row.started_at)}</td>
                            <td>
                              {row.accessKind === "mine" ? t("mine") : t("sharedWithMe")}
                              {row.sharedWithNames?.length ? (
                                <div className="moduleHint">{t("sharedWith")}: {row.sharedWithNames.join(", ")}</div>
                              ) : null}
                            </td>
                            <td>
                              <div className="stockTakeSessionActions">
                                <button type="button" className="modulePrimaryButton" onClick={() => openSelectedSession(row)}>
                                  {t("openCount")}
                                </button>
                                {row.accessKind === "mine" ? (
                                  <>
                                    <select
                                      className="moduleInput"
                                      value={shareUserBySession[row.id] || ""}
                                      onChange={(event) => setShareUserBySession((current) => ({ ...current, [row.id]: event.target.value }))}
                                    >
                                      <option value="">{t("selectUser")}</option>
                                      {shareUsers.map((person) => (
                                        <option key={person.id} value={person.id}>{person.name}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="moduleInlineButton"
                                      disabled={!shareUserBySession[row.id] || sharingId === row.id}
                                      onClick={() => shareSession(row.id)}
                                    >
                                      {sharingId === row.id ? t("sharing") : t("share")}
                                    </button>
                                  </>
                                ) : null}
                                {row.accessKind === "mine" || access.role === "admin" ? (
                                  <button
                                    type="button"
                                    className="moduleInlineButton"
                                    disabled={archivingId === row.id}
                                    onClick={() => archiveSession(row)}
                                  >
                                    {archivingId === row.id ? t("archiving") : t("archive")}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {openSessions.length === 0 ? (
                          <tr><td colSpan={6}>{t("noneOpen")}</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="moduleSection">
                <p className="moduleHint">{t("warehouseHint")}</p>
                <form className="moduleFormGrid" onSubmit={startSession}>
                  <label>
                    {t("warehouse")}
                    <input
                      className="moduleInput stockTakeBarcodeInput"
                      required
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
            </>
          ) : (
            <>
              <section className="moduleSection stockTakeCountCard">
                <div className="moduleSectionHeader">
                  <h2>{session.warehouse_name}</h2>
                  <div className="stockTakeSessionActions">
                    {session.accessKind !== "shared" ? (
                      <>
                        <select
                          className="moduleInput"
                          value={shareUserBySession[session.id] || ""}
                          onChange={(event) => setShareUserBySession((current) => ({ ...current, [session.id]: event.target.value }))}
                        >
                          <option value="">{t("shareUser")}</option>
                          {shareUsers.map((person) => (
                            <option key={person.id} value={person.id}>{person.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="moduleInlineButton"
                          disabled={!shareUserBySession[session.id] || sharingId === session.id}
                          onClick={() => shareSession(session.id)}
                        >
                          {sharingId === session.id ? t("sharing") : t("share")}
                        </button>
                      </>
                    ) : null}
                    {session.accessKind !== "shared" || access.role === "admin" ? (
                      <button
                        type="button"
                        className="moduleInlineButton"
                        disabled={archivingId === session.id}
                        onClick={() => archiveSession(session)}
                      >
                        {archivingId === session.id ? t("archiving") : t("archive")}
                      </button>
                    ) : null}
                    <button type="button" className="moduleInlineButton" onClick={resetWarehouse}>{t("changeWarehouse")}</button>
                  </div>
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
                        setItemCodeInput("");
                        clearLookup();
                      }}
                      onBlur={(event) => {
                        if (!barcode.trim()) return;
                        const next = event.relatedTarget;
                        lookup({ nextBarcode: barcode }).then((found) => {
                          if (!found) return;
                          if (next?.id === "stock-take-qty") return;
                          advanceAfterLookup(found);
                        });
                      }}
                      onKeyDown={async (event) => {
                        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && barcode.trim())) {
                          event.preventDefault();
                          const found = await lookup({ nextBarcode: barcode });
                          advanceAfterLookup(found);
                        }
                      }}
                    />
                  </label>
                  <label>
                    {t("itemCode")}
                    <input
                      ref={itemCodeRef}
                      className="moduleInput"
                      autoComplete="off"
                      readOnly={lookupMode === "barcode"}
                      tabIndex={lookupMode === "barcode" ? -1 : 0}
                      value={itemCodeInput}
                      onChange={(event) => {
                        setItemCodeInput(event.target.value);
                        setBarcode("");
                        clearLookup();
                      }}
                      onBlur={(event) => {
                        if (barcode.trim()) return;
                        const next = event.relatedTarget;
                        lookup({ nextItemCode: itemCodeInput }).then((found) => {
                          if (!found) return;
                          if (next?.id === "stock-take-qty" || next?.id === "stock-take-unit") return;
                          advanceAfterLookup(found);
                        });
                      }}
                      onKeyDown={async (event) => {
                        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && itemCodeInput.trim())) {
                          event.preventDefault();
                          const found = await lookup({ nextItemCode: itemCodeInput });
                          advanceAfterLookup(found);
                        }
                      }}
                    />
                  </label>
                  <label>
                    {t("itemName")}
                    <input className="moduleInput" readOnly tabIndex={-1} value={item?.item_name || ""} />
                  </label>
                  <label>
                    {t("unit")}
                    {unitLocked || lookupMode === "barcode" ? (
                      <input className="moduleInput" readOnly tabIndex={-1} value={lockedUnitLabel} />
                    ) : (
                      <select
                        id="stock-take-unit"
                        className="moduleInput"
                        required={Boolean(item)}
                        value={scannedUom}
                        onChange={(event) => {
                          setScannedUom(event.target.value);
                          if (event.target.value) document.getElementById("stock-take-qty")?.focus();
                        }}
                        disabled={!item}
                      >
                        <option value="">Select unit</option>
                        {availableStockTakeUnits(item).map((unit) => (
                          <option key={unit.kind} value={unit.kind}>{unit.label}</option>
                        ))}
                      </select>
                    )}
                  </label>
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
                  <div className="stockTakeConverted">
                    <div className="stockTakeConvertedLabel">{t("converted")}</div>
                    <div className="stockTakeConvertedGrid">
                      <label>
                        {t("qtyBase")}
                        <input className="moduleInput" readOnly tabIndex={-1} value={converted ? formatStockQty(converted.qtyBase) : ""} />
                      </label>
                      <label>
                        {t("qtyMid")}
                        <input className="moduleInput" readOnly tabIndex={-1} value={converted?.qtyMid == null ? "" : formatStockQty(converted.qtyMid)} />
                      </label>
                      <label>
                        {t("qtyMaster")}
                        <input className="moduleInput" readOnly tabIndex={-1} value={converted ? formatStockQty(converted.qtyMaster) : ""} />
                      </label>
                    </div>
                  </div>
                  <label>
                    {t("pallet")}
                    <input className="moduleInput" value={pallet} onChange={(event) => setPallet(event.target.value)} />
                  </label>
                  <label>
                    {t("location")}
                    <input className="moduleInput" value={location} onChange={(event) => setLocation(event.target.value)} />
                  </label>
                  <button className="modulePrimaryButton" type="submit" disabled={saving || !item || !scannedUom}>
                    {saving ? t("saving") : t("save")}
                  </button>
                </form>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("recent")}</h2>
                </div>
                <ExportableTable filename="stock-take-count" sheetName="Count" className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>{t("date")}</th>
                        <th>{t("time")}</th>
                        <th>{t("item")}</th>
                        <th>{t("unit")}</th>
                        <th>{t("qty")}</th>
                        <th>{t("qtyBase")}</th>
                        <th>{t("qtyMid")}</th>
                        <th>{t("qtyMaster")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td>{formatKsaDateOnly(line.scanned_at)}</td>
                          <td>{formatKsaTime(line.scanned_at)}</td>
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
                          <td>{line.qty_mid == null ? "—" : formatStockQty(line.qty_mid)}</td>
                          <td>{formatStockQty(line.qty_master)}</td>
                        </tr>
                      ))}
                      {lines.length === 0 ? (
                        <tr><td colSpan={8}>No lines yet.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </ExportableTable>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
