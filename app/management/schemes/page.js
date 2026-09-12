"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import {
  createEmptySchemeDraft,
  DEFAULT_ORDER_SCHEMES,
  describeOrderScheme,
  evaluateOrderSchemes,
  formatSchemeDetail,
  lookupSchemeApplication,
  parseItemCodeList,
} from "../../lib/orderSchemes";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Schemes", ar: "العروض" },
  subtitle: {
    en: "Configure carton schemes that apply automatically on New Order and Customers Audit.",
    ar: "إعداد عروض الكراتين التي تُطبَّق تلقائياً في الطلب الجديد وتدقيق العملاء.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading schemes...", ar: "جاري تحميل العروض..." },
  save: { en: "Save schemes", ar: "حفظ العروض" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  add: { en: "Add scheme", ar: "إضافة عرض" },
  remove: { en: "Remove", ar: "حذف" },
  saved: { en: "Schemes saved. New and edited sales orders will use the updated discount.", ar: "تم حفظ العروض. ستستخدم الطلبات الجديدة والمعدلة الخصم المحدث." },
  defaultHint: {
    en: "These starter rules are already used on sales orders. Save to keep them in the catalog.",
    ar: "هذه القواعد الأولية تُستخدم بالفعل على طلبات المبيعات. احفظها لتثبيتها في الكتالوج.",
  },
};

function newSchemeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `scheme-${Date.now()}`;
}

function toDraft(scheme) {
  return {
    ...createEmptySchemeDraft(),
    ...scheme,
    qualifierItemCodes: Array.isArray(scheme.qualifierItemCodes)
      ? scheme.qualifierItemCodes.join(", ")
      : String(scheme.qualifierItemCodes || ""),
    rewardEveryQty: String(scheme.rewardEveryQty ?? 40),
    unitDiscountSar: String(scheme.unitDiscountSar ?? ""),
    qualifierMinQty: String(scheme.qualifierMinQty ?? 1),
  };
}

function fromDraft(draft, index) {
  return {
    id: draft.id || `scheme-${index + 1}`,
    name: draft.name,
    active: draft.active !== false,
    type: "conditional_unit_discount",
    rewardItemCode: String(draft.rewardItemCode || "").trim().toUpperCase(),
    rewardEveryQty: Number(draft.rewardEveryQty || 0),
    applyTo: draft.applyTo,
    unitDiscountSar: Number(draft.unitDiscountSar || 0),
    qualifierItemCodes: parseItemCodeList(draft.qualifierItemCodes),
    qualifierMinQty: Number(draft.qualifierMinQty || 1),
    qualifierMode: draft.qualifierMode,
    excludeCashDiscount: draft.excludeCashDiscount !== false,
  };
}

export default function SchemesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(false);
  const [schemes, setSchemes] = useState(() => DEFAULT_ORDER_SCHEMES.map(toDraft));
  const [previewRewardQty, setPreviewRewardQty] = useState("40");
  const [previewQualifierQty, setPreviewQualifierQty] = useState("1");

  usePopupMessages({ message, error });

  async function loadSchemes() {
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
        "/api/admin/schemes",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load schemes.");
      }
      const configured = Boolean(payload.configured);
      const rows = Array.isArray(payload.schemes) && (payload.schemes.length || configured)
        ? payload.schemes
        : DEFAULT_ORDER_SCHEMES;
      setSchemes(rows.map(toDraft));
      setConfigured(configured);
    } catch (err) {
      setError(err.message || "Unable to load schemes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSchemes();
  }, []);

  async function saveSchemes() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/schemes",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            schemes: schemes.map(fromDraft),
          }),
        },
        30000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save schemes.");
      }
      setSchemes((payload.schemes || []).map(toDraft));
      setConfigured(true);
      setMessage(t("saved"));
    } catch (err) {
      setError(err.message || "Unable to save schemes.");
    } finally {
      setSaving(false);
    }
  }

  function updateScheme(index, patch) {
    setSchemes((current) => current.map((scheme, schemeIndex) => (
      schemeIndex === index ? { ...scheme, ...patch } : scheme
    )));
  }

  const preview = useMemo(() => {
    const normalized = schemes.map(fromDraft);
    const first = normalized[0];
    if (!first) return null;
    const quantities = {
      [first.rewardItemCode]: Number(previewRewardQty || 0),
    };
    (first.qualifierItemCodes || []).forEach((code) => {
      quantities[code] = Number(previewQualifierQty || 0);
    });
    const applications = evaluateOrderSchemes(quantities, normalized);
    return lookupSchemeApplication(applications, first.rewardItemCode);
  }, [previewQualifierQty, previewRewardQty, schemes]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Schemes unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to configure schemes."
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
              <MostVisitedPages />
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
              {schemes.map((scheme, index) => (
                <section key={scheme.id || index} className="moduleCard" style={{ marginBottom: 16 }}>
                  <div className="moduleFilterRow">
                    <label>
                      Scheme name
                      <input
                        className="moduleInput"
                        value={scheme.name}
                        onChange={(event) => updateScheme(index, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Reward item
                      <input
                        className="moduleInput"
                        value={scheme.rewardItemCode}
                        onChange={(event) => updateScheme(index, { rewardItemCode: event.target.value.toUpperCase() })}
                        placeholder="A005425"
                      />
                    </label>
                    <label>
                      Every (CTN)
                      <input
                        className="moduleInput"
                        type="number"
                        min="1"
                        value={scheme.rewardEveryQty}
                        onChange={(event) => updateScheme(index, { rewardEveryQty: event.target.value })}
                      />
                    </label>
                    <label>
                      Discount SAR / CTN
                      <input
                        className="moduleInput"
                        type="number"
                        min="0"
                        step="0.01"
                        value={scheme.unitDiscountSar}
                        onChange={(event) => updateScheme(index, { unitDiscountSar: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="moduleFilterRow">
                    <label style={{ flex: 1 }}>
                      Qualifier items
                      <input
                        className="moduleInput"
                        value={scheme.qualifierItemCodes}
                        onChange={(event) => updateScheme(index, { qualifierItemCodes: event.target.value.toUpperCase() })}
                        placeholder="A004224, A004225, A004226, A004227"
                      />
                    </label>
                    <label>
                      Min qualifier CTN
                      <input
                        className="moduleInput"
                        type="number"
                        min="1"
                        value={scheme.qualifierMinQty}
                        onChange={(event) => updateScheme(index, { qualifierMinQty: event.target.value })}
                      />
                    </label>
                    <label>
                      Qualifier mode
                      <select
                        className="moduleInput"
                        value={scheme.qualifierMode}
                        onChange={(event) => updateScheme(index, { qualifierMode: event.target.value })}
                      >
                        <option value="any">Any listed item</option>
                        <option value="all">All listed items</option>
                      </select>
                    </label>
                    <label>
                      Apply to
                      <select
                        className="moduleInput"
                        value={scheme.applyTo}
                        onChange={(event) => updateScheme(index, { applyTo: event.target.value })}
                      >
                        <option value="complete_lots">Complete lots only</option>
                        <option value="all_units">All cartons after minimum</option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select
                        className="moduleInput"
                        value={scheme.active ? "active" : "inactive"}
                        onChange={(event) => updateScheme(index, { active: event.target.value === "active" })}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label>
                      Cash discount
                      <select
                        className="moduleInput"
                        value={scheme.excludeCashDiscount === false ? "allow" : "exclude"}
                        onChange={(event) => updateScheme(index, {
                          excludeCashDiscount: event.target.value !== "allow",
                        })}
                      >
                        <option value="exclude">Do not combine</option>
                        <option value="allow">Allow stacking</option>
                      </select>
                    </label>
                  </div>
                  <p className="moduleHint">{describeOrderScheme(fromDraft(scheme, index))}</p>
                  <button type="button" className="moduleInlineButton" onClick={() => setSchemes((current) => current.filter((_, schemeIndex) => schemeIndex !== index))}>
                    {t("remove")}
                  </button>
                </section>
              ))}

              <section className="moduleCard">
                <div className="moduleFilterRow">
                  <label>
                    Preview reward CTN
                    <input
                      className="moduleInput"
                      type="number"
                      min="0"
                      value={previewRewardQty}
                      onChange={(event) => setPreviewRewardQty(event.target.value)}
                    />
                  </label>
                  <label>
                    Preview mix CTN
                    <input
                      className="moduleInput"
                      type="number"
                      min="0"
                      value={previewQualifierQty}
                      onChange={(event) => setPreviewQualifierQty(event.target.value)}
                    />
                  </label>
                  <div className="moduleHint" style={{ alignSelf: "end", paddingBottom: 8 }}>
                    First scheme preview: {formatSchemeDetail(preview)}
                  </div>
                </div>
              </section>

              <div className="moduleFilterRow" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="moduleInlineButton"
                  onClick={() => setSchemes((current) => [
                    ...current,
                    toDraft({ ...createEmptySchemeDraft(), id: newSchemeId(), name: "New scheme" }),
                  ])}
                >
                  {t("add")}
                </button>
                <button type="button" className="moduleInlineButton" onClick={saveSchemes} disabled={saving}>
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
