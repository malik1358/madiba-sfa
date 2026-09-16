"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  DEFAULT_ORDER_QUANTITY_CONTROLS,
  createEmptyQuantityControlDraft,
  describeOrderQuantityControl,
} from "../../lib/orderQuantityControls";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Sales Qty Limits", ar: "حدود كمية البيع للعميل" },
  subtitle: {
    en: "Control how many cartons of an item each customer can buy per week. Find this under Management → Sales Qty Limits.",
    ar: "تحكم في الحد الأقصى لكراتين الصنف التي يمكن لكل عميل شراؤها أسبوعياً. متاحة من الإدارة ← حدود كمية البيع للعميل.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  schemes: { en: "Schemes", ar: "العروض" },
  loading: { en: "Loading controls...", ar: "جاري تحميل الحدود..." },
  save: { en: "Save controls", ar: "حفظ الحدود" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  add: { en: "Add control", ar: "إضافة حد" },
  remove: { en: "Remove", ar: "حذف" },
  saved: {
    en: "Controls saved. New and edited sales orders will enforce the active limits.",
    ar: "تم حفظ الحدود. ستُطبَّق الحدود النشطة على الطلبات الجديدة والمعدلة.",
  },
  defaultHint: {
    en: "A004075 is limited to 20 CTN per customer per week by default. Save to keep this rule in the catalog, or turn it off.",
    ar: "الصنف A004075 محدود بـ 20 كرتون لكل عميل أسبوعياً افتراضياً. احفظ لتثبيت القاعدة أو عطّلها.",
  },
  enabled: { en: "Enabled", ar: "مفعّل" },
  disabled: { en: "Disabled", ar: "معطّل" },
  totalRules: { en: "Total rules", ar: "إجمالي القواعد" },
  activeRules: { en: "Active", ar: "مفعّلة" },
};

function newControlId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `qty-control-${Date.now()}`;
}

function toDraft(control) {
  return {
    ...createEmptyQuantityControlDraft(),
    ...control,
    maxQty: String(control.maxQty ?? 20),
  };
}

function fromDraft(draft, index) {
  return {
    id: draft.id || `qty-control-${index + 1}`,
    name: draft.name,
    active: draft.active !== false,
    itemCode: String(draft.itemCode || "").trim().toUpperCase(),
    maxQty: Number(draft.maxQty || 0),
    unit: String(draft.unit || "CTN").trim().toUpperCase() || "CTN",
    period: "week",
    scope: "customer",
  };
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

  usePopupMessages({ message, error });

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
      setControls(rows.map(toDraft));
      setConfigured(isConfigured);
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
      setControls((payload.controls || []).map(toDraft));
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

  function addControl() {
    setControls((current) => [
      ...current,
      toDraft({
        ...createEmptyQuantityControlDraft(),
        id: newControlId(),
        name: "New item weekly limit",
        active: true,
        itemCode: "",
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
              <div className="moduleTableWrap" style={{ marginBottom: 16 }}>
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Name</th>
                      <th>Item</th>
                      <th>Max CTN / week</th>
                      <th>Summary</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {controls.map((control, index) => (
                      <tr key={control.id || index}>
                        <td>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={control.active !== false}
                              onChange={(event) => updateControl(index, { active: event.target.checked })}
                            />
                            {control.active !== false ? t("enabled") : t("disabled")}
                          </label>
                        </td>
                        <td>
                          <input
                            className="moduleInput"
                            value={control.name}
                            onChange={(event) => updateControl(index, { name: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="moduleInput"
                            value={control.itemCode}
                            onChange={(event) => updateControl(index, { itemCode: event.target.value.toUpperCase() })}
                            placeholder="A004075"
                          />
                        </td>
                        <td>
                          <input
                            className="moduleInput"
                            type="number"
                            min="1"
                            value={control.maxQty}
                            onChange={(event) => updateControl(index, { maxQty: event.target.value })}
                          />
                        </td>
                        <td>{describeOrderQuantityControl(fromDraft(control, index))}</td>
                        <td>
                          <button type="button" className="moduleInlineButton" onClick={() => removeControl(index)}>
                            {t("remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="modulePendingOrdersTotalRow">
                      <td colSpan={3}>{t("totalRules")}</td>
                      <td className="moduleBiTotalCol">{controls.length}</td>
                      <td colSpan={2}>
                        {t("activeRules")}: {controls.filter((control) => control.active !== false).length}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="moduleActions">
                <button type="button" className="moduleInlineButton" onClick={addControl}>
                  {t("add")}
                </button>
                <button type="button" className="modulePrimaryButton" onClick={saveControls} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
