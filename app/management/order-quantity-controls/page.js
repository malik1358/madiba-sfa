"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  DEFAULT_ORDER_QUANTITY_CONTROLS,
  createEmptyQuantityControlDraft,
  describeOrderQuantityControl,
  formatItemCodesLabel,
} from "../../lib/orderQuantityControls";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import ItemCodeSearchField from "./ItemCodeSearchField";

const TEXT = {
  title: { en: "Sales Qty Limits", ar: "حدود كمية البيع للعميل" },
  subtitle: {
    en: "Limit cartons per customer per week for one item, or a shared total across several SKUs.",
    ar: "حدد حد الكراتين لكل عميل أسبوعياً لصنف واحد، أو إجمالي مشترك لعدة أصناف.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  schemes: { en: "Schemes", ar: "العروض" },
  loading: { en: "Loading controls...", ar: "جاري تحميل الحدود..." },
  save: { en: "Save controls", ar: "حفظ الحدود" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  add: { en: "Add control", ar: "إضافة حد" },
  remove: { en: "Remove", ar: "حذف" },
  removeItem: { en: "Remove item", ar: "إزالة الصنف" },
  saved: {
    en: "Controls saved. New and edited sales orders will enforce the active limits.",
    ar: "تم حفظ الحدود. ستُطبَّق الحدود النشطة على الطلبات الجديدة والمعدلة.",
  },
  defaultHint: {
    en: "A004075 is limited to 20 CTN per customer per week by default. Save to keep this rule, or turn it off. Add more items to the same rule to share one weekly cap.",
    ar: "الصنف A004075 محدود بـ 20 كرتون لكل عميل أسبوعياً افتراضياً. احفظ لتثبيت القاعدة أو عطّلها. أضف أصنافاً أخرى لنفس القاعدة لمشاركة حد أسبوعي واحد.",
  },
  enabled: { en: "Enabled", ar: "مفعّل" },
  disabled: { en: "Disabled", ar: "معطّل" },
  totalRules: { en: "Total rules", ar: "إجمالي القواعد" },
  activeRules: { en: "Active", ar: "مفعّلة" },
  status: { en: "Status", ar: "الحالة" },
  name: { en: "Rule name", ar: "اسم القاعدة" },
  items: { en: "Items in this limit", ar: "الأصناف في هذا الحد" },
  addItem: { en: "Add item to group", ar: "إضافة صنف للمجموعة" },
  itemSearch: { en: "Search item code or name to add", ar: "ابحث بكود أو اسم الصنف للإضافة" },
  noItemsYet: { en: "No items yet — search below to add one or more SKUs.", ar: "لا أصناف بعد — ابحث بالأسفل لإضافة صنف أو أكثر." },
  groupHint: {
    en: "Several SKUs share one Max CTN / week total (not per item).",
    ar: "عدة أصناف تتشارك حداً واحداً من الكراتين أسبوعياً (وليس لكل صنف).",
  },
  maxQty: { en: "Max CTN / week", ar: "الحد الأقصى كرتون / أسبوع" },
  summary: { en: "Summary", ar: "الملخص" },
  searching: { en: "Searching...", ar: "جاري البحث..." },
  noMatches: { en: "No matching items", ar: "لا توجد أصناف مطابقة" },
  alreadyInRule: { en: "That item is already in this rule.", ar: "هذا الصنف موجود مسبقاً في هذه القاعدة." },
};

function newControlId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `qty-control-${Date.now()}`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function draftItemCodes(control) {
  if (Array.isArray(control?.itemCodes) && control.itemCodes.length) {
    return [...new Set(control.itemCodes.map(normalizeCode).filter(Boolean))];
  }
  const single = normalizeCode(control?.itemCode);
  return single ? [single] : [];
}

function toDraft(control) {
  const itemCodes = draftItemCodes(control);
  const itemNames = { ...(control.itemNames || {}) };
  itemCodes.forEach((code) => {
    if (!itemNames[code] && control.itemName && code === normalizeCode(control.itemCode)) {
      itemNames[code] = String(control.itemName || "").trim();
    }
  });
  return {
    ...createEmptyQuantityControlDraft(),
    ...control,
    itemCodes,
    itemCode: itemCodes[0] || "",
    itemNames,
    maxQty: String(control.maxQty ?? 20),
  };
}

function fromDraft(draft, index) {
  const itemCodes = draftItemCodes(draft);
  return {
    id: draft.id || `qty-control-${index + 1}`,
    name: draft.name,
    active: draft.active !== false,
    itemCode: itemCodes[0] || "",
    itemCodes,
    maxQty: Number(draft.maxQty || 0),
    unit: String(draft.unit || "CTN").trim().toUpperCase() || "CTN",
    period: "week",
    scope: "customer",
  };
}

function defaultRuleName(itemCodes, itemNames, maxQty) {
  const codes = (itemCodes || []).map(normalizeCode).filter(Boolean);
  if (codes.length === 0) return "New item weekly limit";
  if (codes.length === 1) {
    const code = codes[0];
    const itemName = itemNames?.[code] || "";
    const label = itemName && itemName !== code ? `${code} (${itemName})` : code;
    return `${label} max ${maxQty || 20} CTN / customer / week`;
  }
  return `${formatItemCodesLabel(codes)} max ${maxQty || 20} CTN combined / customer / week`;
}

function shouldAutofillName(name, previousItemCodes) {
  const current = String(name || "").trim();
  if (!current) return true;
  if (current === "New item weekly limit") return true;
  const prevCodes = (previousItemCodes || []).map(normalizeCode).filter(Boolean);
  if (prevCodes.length === 0) return true;
  const prevLabel = formatItemCodesLabel(prevCodes);
  if (prevLabel && current.toUpperCase().startsWith(prevLabel.toUpperCase())) return true;
  if (prevCodes.length === 1 && current.toUpperCase().startsWith(prevCodes[0])) return true;
  return false;
}

export default function OrderQuantityControlsPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(false);
  const [controls, setControls] = useState(() => DEFAULT_ORDER_QUANTITY_CONTROLS.map(toDraft));
  const [searchResetKeys, setSearchResetKeys] = useState({});

  usePopupMessages({ message, error });

  const activeCount = useMemo(
    () => controls.filter((control) => control.active !== false).length,
    [controls],
  );

  async function resolveItemNames(rows) {
    const codes = [...new Set(
      rows.flatMap((row) => draftItemCodes(row)).filter(Boolean),
    )];
    if (codes.length === 0) return rows;

    const nameByCode = {};
    try {
      const { response, payload } = await fetchJsonWithTimeout("/api/pricing/cache", {}, 30000);
      if (response.ok && payload?.success && Array.isArray(payload.sheetItems)) {
        payload.sheetItems.forEach((entry) => {
          const code = String(entry.item_code || "").trim().toUpperCase();
          if (!code || !codes.includes(code)) return;
          nameByCode[code] = String(entry.item_name || "").trim();
        });
      }
    } catch {
      // Fall through to per-code lookup below.
    }

    const missing = codes.filter((code) => !nameByCode[code]);
    if (missing.length > 0) {
      const supabase = getSupabaseClient();
      const session = supabase ? await resolveAuthSession(supabase) : null;
      if (session?.access_token) {
        await Promise.all(missing.map(async (code) => {
          try {
            const params = new URLSearchParams({ q: code });
            const { response, payload } = await fetchJsonWithTimeout(
              `/api/admin/item-price-history?${params}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } },
              20000,
            );
            if (!response.ok || !payload?.success) return;
            const match = (payload.matches || []).find((row) => String(row.itemCode || "").toUpperCase() === code)
              || payload.matches?.[0];
            if (match?.itemName) nameByCode[code] = String(match.itemName).trim();
          } catch {
            // Keep code-only display.
          }
        }));
      }
    }

    return rows.map((row) => {
      const itemCodes = draftItemCodes(row);
      const itemNames = { ...(row.itemNames || {}) };
      itemCodes.forEach((code) => {
        if (!itemNames[code] && nameByCode[code]) itemNames[code] = nameByCode[code];
      });
      return {
        ...row,
        itemCodes,
        itemCode: itemCodes[0] || "",
        itemNames,
        itemName: itemNames[itemCodes[0]] || row.itemName || "",
      };
    });
  }

  async function loadControls() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/order-quantity-controls",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load order quantity controls.");
      }
      const isConfigured = Boolean(payload.configured);
      const rows = Array.isArray(payload.controls) && (payload.controls.length || isConfigured)
        ? payload.controls
        : DEFAULT_ORDER_QUANTITY_CONTROLS;
      const drafts = rows.map(toDraft);
      setControls(drafts);
      setConfigured(isConfigured);
      const withNames = await resolveItemNames(drafts);
      setControls(withNames);
    } catch (err) {
      setError(err.message || "Unable to load order quantity controls.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadControls();
  }, []);

  async function saveControls() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/order-quantity-controls",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            controls: controls.map(fromDraft),
          }),
        },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save order quantity controls.");
      }
      const next = (payload.controls || []).map(toDraft);
      const withNames = await resolveItemNames(next.map((row, index) => ({
        ...row,
        itemNames: {
          ...(controls[index]?.itemNames || {}),
          ...(row.itemNames || {}),
        },
      })));
      setControls(withNames);
      setConfigured(true);
      setMessage(t("saved"));
    } catch (err) {
      setError(err.message || "Unable to save order quantity controls.");
    } finally {
      setSaving(false);
    }
  }

  function updateControl(index, patch) {
    setControls((current) => current.map((control, controlIndex) => (
      controlIndex === index ? { ...control, ...patch } : control
    )));
  }

  function addItemToControl(index, item) {
    const nextCode = normalizeCode(item.itemCode);
    if (!nextCode) return;

    const target = controls[index];
    if (!target) return;
    const previousCodes = draftItemCodes(target);
    if (previousCodes.includes(nextCode)) {
      setError(t("alreadyInRule"));
      setSearchResetKeys((current) => ({
        ...current,
        [index]: (current[index] || 0) + 1,
      }));
      return;
    }

    setError("");
    const nextCodes = [...previousCodes, nextCode];
    const nextNames = {
      ...(target.itemNames || {}),
      [nextCode]: String(item.itemName || "").trim(),
    };
    const nextMax = target.maxQty || "20";
    const patch = {
      itemCodes: nextCodes,
      itemCode: nextCodes[0] || "",
      itemNames: nextNames,
      itemName: nextNames[nextCodes[0]] || "",
    };
    if (shouldAutofillName(target.name, previousCodes)) {
      patch.name = defaultRuleName(nextCodes, nextNames, nextMax);
    }
    updateControl(index, patch);
    setSearchResetKeys((current) => ({
      ...current,
      [index]: (current[index] || 0) + 1,
    }));
  }

  function removeItemFromControl(index, itemCode) {
    const removeCode = normalizeCode(itemCode);
    setControls((current) => current.map((control, controlIndex) => {
      if (controlIndex !== index) return control;
      const previousCodes = draftItemCodes(control);
      const nextCodes = previousCodes.filter((code) => code !== removeCode);
      const nextNames = { ...(control.itemNames || {}) };
      delete nextNames[removeCode];
      const nextMax = control.maxQty || "20";
      const patch = {
        itemCodes: nextCodes,
        itemCode: nextCodes[0] || "",
        itemNames: nextNames,
        itemName: nextNames[nextCodes[0]] || "",
      };
      if (shouldAutofillName(control.name, previousCodes)) {
        patch.name = defaultRuleName(nextCodes, nextNames, nextMax);
      }
      return { ...control, ...patch };
    }));
  }

  function addControl() {
    setControls((current) => [
      ...current,
      toDraft({
        ...createEmptyQuantityControlDraft(),
        id: newControlId(),
        name: "New item weekly limit",
        active: true,
        itemCode: "",
        itemCodes: [],
        itemNames: {},
        maxQty: 20,
      }),
    ]);
  }

  function removeControl(index) {
    setControls((current) => current.filter((_, controlIndex) => controlIndex !== index));
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Order quantity controls unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to configure order limits."
      />
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage moduleQtyLimitsPage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management/schemes" className="moduleInlineButton">{t("schemes")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {!configured && (
            <p className="moduleHint">{t("defaultHint")}</p>
          )}

          {loading ? (
            <p className="moduleHint">{t("loading")}</p>
          ) : (
            <>
              <div className="moduleQtyLimitList">
                {controls.map((control, index) => {
                  const itemCodes = draftItemCodes(control);
                  const itemNames = control.itemNames || {};
                  return (
                    <section key={control.id || index} className="moduleQtyLimitCard">
                      <div className="moduleQtyLimitCardTop">
                        <label className="moduleQtyLimitStatus">
                          <input
                            type="checkbox"
                            checked={control.active !== false}
                            onChange={(event) => updateControl(index, { active: event.target.checked })}
                          />
                          <span>{control.active !== false ? t("enabled") : t("disabled")}</span>
                        </label>
                        <button
                          type="button"
                          className="moduleInlineButton"
                          onClick={() => removeControl(index)}
                        >
                          {t("remove")}
                        </button>
                      </div>

                      <label className="moduleQtyLimitField">
                        <span>{t("name")}</span>
                        <input
                          className="moduleInput"
                          value={control.name}
                          onChange={(event) => updateControl(index, { name: event.target.value })}
                        />
                      </label>

                      <div className="moduleQtyLimitField">
                        <span>{t("items")}</span>
                        {itemCodes.length === 0 ? (
                          <p className="moduleHint moduleQtyLimitItemMeta">{t("noItemsYet")}</p>
                        ) : (
                          <ul className="moduleQtyLimitItemChips">
                            {itemCodes.map((code) => (
                              <li key={code} className="moduleQtyLimitItemChip">
                                <span className="moduleQtyLimitItemChipLabel">
                                  <strong>{code}</strong>
                                  {itemNames[code] && itemNames[code] !== code
                                    ? <small>{itemNames[code]}</small>
                                    : null}
                                </span>
                                <button
                                  type="button"
                                  className="moduleQtyLimitItemChipRemove"
                                  aria-label={`${t("removeItem")} ${code}`}
                                  onClick={() => removeItemFromControl(index, code)}
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {itemCodes.length > 1 ? (
                          <small className="moduleHint moduleQtyLimitItemMeta">{t("groupHint")}</small>
                        ) : null}
                      </div>

                      <label className="moduleQtyLimitField">
                        <span>{t("addItem")}</span>
                        <ItemCodeSearchField
                          key={`qty-search-${control.id || index}-${searchResetKeys[index] || 0}`}
                          value=""
                          itemName=""
                          placeholder={t("itemSearch")}
                          searchingLabel={t("searching")}
                          noMatchesLabel={t("noMatches")}
                          onSelect={(item) => {
                            if (!item?.itemCode) return;
                            addItemToControl(index, item);
                          }}
                        />
                      </label>

                      <label className="moduleQtyLimitField moduleQtyLimitFieldNarrow">
                        <span>{t("maxQty")}</span>
                        <input
                          className="moduleInput"
                          type="number"
                          min="1"
                          inputMode="numeric"
                          value={control.maxQty}
                          onChange={(event) => {
                            const maxQty = event.target.value;
                            const patch = { maxQty };
                            if (shouldAutofillName(control.name, itemCodes) && itemCodes.length) {
                              patch.name = defaultRuleName(itemCodes, itemNames, maxQty);
                            }
                            updateControl(index, patch);
                          }}
                        />
                      </label>

                      <p className="moduleQtyLimitSummary">
                        <strong>{t("summary")}:</strong>{" "}
                        {describeOrderQuantityControl(fromDraft(control, index))}
                      </p>
                    </section>
                  );
                })}
              </div>

              <div className="moduleQtyLimitFooter">
                <div className="moduleQtyLimitTotals">
                  <span>{t("totalRules")}: <strong>{controls.length}</strong></span>
                  <span>{t("activeRules")}: <strong>{activeCount}</strong></span>
                </div>
                <div className="moduleActions moduleQtyLimitActions">
                  <button type="button" className="moduleInlineButton" onClick={addControl}>
                    {t("add")}
                  </button>
                  <button type="button" className="modulePrimaryButton" onClick={saveControls} disabled={saving}>
                    {saving ? t("saving") : t("save")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
