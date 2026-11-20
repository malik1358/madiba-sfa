"use client";

import { useMemo, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { CUSTOMER_ORDER_LINK_TTL_HOURS } from "../lib/customerOrderLinks.js";
import {
  PRICING_REGIONS,
  pricingRegionLabel,
} from "../lib/regionalPricing.js";

const TEXT = {
  generate: { en: "Generate order link", ar: "إنشاء رابط طلب" },
  sendLink: { en: "Send order link", ar: "إرسال رابط الطلب" },
  choosePricing: {
    en: "Choose the price book for this customer link",
    ar: "اختر قائمة الأسعار لهذا الرابط",
  },
  choosePricingHint: {
    en: "The customer will see only this city and only wholesale or retail — nothing else.",
    ar: "سيرى العميل فقط هذه المدينة ونوع السعر المختار (جملة أو تجزئة) ولا شيء غير ذلك.",
  },
  cityPrice: { en: "City price", ar: "سعر المدينة" },
  priceType: { en: "Price type", ar: "نوع السعر" },
  wholesale: { en: "Wholesale", ar: "جملة" },
  retail: { en: "Retail", ar: "تجزئة" },
  createWith: { en: "Create link with", ar: "إنشاء الرابط بـ" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  generating: { en: "Generating…", ar: "جاري الإنشاء…" },
  copy: { en: "Copy link", ar: "نسخ الرابط" },
  copied: { en: "Copied", ar: "تم النسخ" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  needCity: { en: "Select which city price to send.", ar: "اختر سعر أي مدينة تريد إرساله." },
  needType: { en: "Select wholesale or retail.", ar: "اختر جملة أو تجزئة." },
  validFor: {
    en: `Valid for ${CUSTOMER_ORDER_LINK_TTL_HOURS} hours. Customer opens the catalogue without login.`,
    ar: `صالح لمدة ${CUSTOMER_ORDER_LINK_TTL_HOURS} ساعة. يفتح العميل الكتالوج بدون تسجيل دخول.`,
  },
  failed: { en: "Unable to create the order link.", ar: "تعذر إنشاء رابط الطلب." },
};

function t(language, key) {
  const row = TEXT[key] || {};
  return language === "ar" ? (row.ar || row.en || key) : (row.en || key);
}

function pricingTypeLabel(language, pricingType) {
  return pricingType === "retail" ? t(language, "retail") : t(language, "wholesale");
}

export default function GenerateOrderLinkButton({
  customerCode,
  customerName = "",
  pricingRegion = "",
  pricingType = "",
  paymentType = "credit",
  language = "en",
  labelKey = "generate",
  className = "moduleInlineButton moduleActionButton",
  onCreated = null,
}) {
  const defaultRegion = PRICING_REGIONS.includes(String(pricingRegion || "").trim().toLowerCase())
    ? String(pricingRegion).trim().toLowerCase()
    : "";
  const defaultType = ["wholesale", "retail"].includes(String(pricingType || "").trim().toLowerCase())
    ? String(pricingType).trim().toLowerCase()
    : "";

  const [open, setOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState(defaultRegion);
  const [selectedType, setSelectedType] = useState(defaultType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);

  const selectionLabel = useMemo(() => {
    if (!selectedRegion || !selectedType) return "";
    return `${pricingRegionLabel(selectedRegion)} · ${pricingTypeLabel(language, selectedType)}`;
  }, [selectedRegion, selectedType, language]);

  function openChooser() {
    setError("");
    setCopied(false);
    setSelectedRegion(defaultRegion);
    setSelectedType(defaultType);
    setOpen(true);
  }

  async function createLink() {
    const code = String(customerCode || "").trim();
    if (!code || busy) return;
    if (!selectedRegion) {
      setError(t(language, "needCity"));
      return;
    }
    if (!selectedType) {
      setError(t(language, "needType"));
      return;
    }

    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error(t(language, "failed"));
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const response = await fetch("/api/customer-order-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customerCode: code,
          customerName,
          pricingRegion: selectedRegion,
          pricingType: selectedType,
          paymentType,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || t(language, "failed"));
      }
      setLink(payload.link);
      setOpen(false);
      if (typeof onCreated === "function") onCreated(payload.link);
    } catch (err) {
      setError(err.message || t(language, "failed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const url = String(link?.url || "").trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(language === "ar" ? "تعذر النسخ." : "Could not copy the link.");
    }
  }

  function openWhatsapp() {
    const url = String(link?.url || "").trim();
    if (!url) return;
    const name = String(customerName || customerCode || "").trim();
    const city = pricingRegionLabel(link?.pricingRegion || selectedRegion);
    const type = pricingTypeLabel(language, link?.pricingType || selectedType);
    const text = language === "ar"
      ? `مرحباً${name ? ` ${name}` : ""}، رابط طلب MADIBA (${city} · ${type}، صالح ${CUSTOMER_ORDER_LINK_TTL_HOURS} ساعة):\n${url}`
      : `Hello${name ? ` ${name}` : ""}, here is your MADIBA order link (${city} · ${type}, valid ${CUSTOMER_ORDER_LINK_TTL_HOURS} hours):\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ display: "grid", gap: "8px", justifyItems: "start", maxWidth: "100%" }}>
      <button
        type="button"
        className={className}
        onClick={openChooser}
        disabled={busy || !customerCode}
      >
        {busy ? t(language, "generating") : t(language, labelKey)}
      </button>

      {open ? (
        <div
          style={{
            display: "grid",
            gap: "10px",
            width: "min(100%, 420px)",
            padding: "12px",
            borderRadius: "12px",
            border: "1px solid #bed3d9",
            background: "#fff",
          }}
        >
          <strong>{t(language, "choosePricing")}</strong>
          <em className="moduleHint" style={{ margin: 0 }}>{t(language, "choosePricingHint")}</em>

          <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
            {t(language, "cityPrice")}
            <select
              className="moduleInput"
              value={selectedRegion}
              onChange={(event) => setSelectedRegion(event.target.value)}
              aria-label={t(language, "cityPrice")}
            >
              <option value="">{language === "ar" ? "— اختر المدينة —" : "— Select city —"}</option>
              {PRICING_REGIONS.map((region) => (
                <option key={region} value={region}>{pricingRegionLabel(region)}</option>
              ))}
            </select>
          </label>

          <fieldset style={{ border: "1px solid #dce6e9", borderRadius: "10px", padding: "10px 12px", margin: 0 }}>
            <legend style={{ fontWeight: 700, padding: "0 4px" }}>{t(language, "priceType")}</legend>
            <div className="moduleInlineStack" style={{ gap: "16px" }}>
              <label className="moduleInlineStack" style={{ gap: "6px" }}>
                <input
                  type="radio"
                  name={`order-link-pricing-type-${customerCode || "x"}`}
                  checked={selectedType === "wholesale"}
                  onChange={() => setSelectedType("wholesale")}
                />
                <span>{t(language, "wholesale")}</span>
              </label>
              <label className="moduleInlineStack" style={{ gap: "6px" }}>
                <input
                  type="radio"
                  name={`order-link-pricing-type-${customerCode || "x"}`}
                  checked={selectedType === "retail"}
                  onChange={() => setSelectedType("retail")}
                />
                <span>{t(language, "retail")}</span>
              </label>
            </div>
          </fieldset>

          <div className="moduleInlineStack" style={{ gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="modulePrimaryButton"
              onClick={() => { void createLink(); }}
              disabled={busy || !selectedRegion || !selectedType}
            >
              {busy
                ? t(language, "generating")
                : `${t(language, "createWith")} ${selectionLabel || "…"}`}
            </button>
            <button
              type="button"
              className="moduleInlineButton"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t(language, "cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <em className="moduleHint" style={{ color: "#9b1c1c" }}>{error}</em> : null}

      {link?.url ? (
        <div style={{ display: "grid", gap: "6px", maxWidth: "100%" }}>
          <em className="moduleHint">{t(language, "validFor")}</em>
          <strong style={{ color: "#0f4c5c" }}>
            {pricingRegionLabel(link.pricingRegion)} · {pricingTypeLabel(language, link.pricingType)}
          </strong>
          <code style={{
            display: "block",
            wordBreak: "break-all",
            fontSize: "12px",
            background: "#edf6f7",
            padding: "8px 10px",
            borderRadius: "8px",
          }}
          >
            {link.url}
          </code>
          <div className="moduleInlineStack" style={{ gap: "8px" }}>
            <button type="button" className="moduleInlineButton" onClick={() => { void copyLink(); }}>
              {copied ? t(language, "copied") : t(language, "copy")}
            </button>
            <button type="button" className="moduleInlineButton" onClick={openWhatsapp}>
              {t(language, "whatsapp")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
