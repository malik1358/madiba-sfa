"use client";

import { useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { CUSTOMER_ORDER_LINK_TTL_HOURS } from "../lib/customerOrderLinks.js";

const TEXT = {
  generate: { en: "Generate order link", ar: "إنشاء رابط طلب" },
  sendLink: { en: "Send order link", ar: "إرسال رابط الطلب" },
  generating: { en: "Generating…", ar: "جاري الإنشاء…" },
  copy: { en: "Copy link", ar: "نسخ الرابط" },
  copied: { en: "Copied", ar: "تم النسخ" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
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

export default function GenerateOrderLinkButton({
  customerCode,
  customerName = "",
  pricingRegion = "",
  paymentType = "credit",
  language = "en",
  labelKey = "generate",
  className = "moduleInlineButton moduleActionButton",
  onCreated = null,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);

  async function createLink() {
    const code = String(customerCode || "").trim();
    if (!code || busy) return;
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
          pricingRegion,
          paymentType,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || t(language, "failed"));
      }
      setLink(payload.link);
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
    const text = language === "ar"
      ? `مرحباً${name ? ` ${name}` : ""}، رابط طلب MADIBA (صالح ${CUSTOMER_ORDER_LINK_TTL_HOURS} ساعة):\n${url}`
      : `Hello${name ? ` ${name}` : ""}, here is your MADIBA order link (valid ${CUSTOMER_ORDER_LINK_TTL_HOURS} hours):\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ display: "grid", gap: "8px", justifyItems: "start" }}>
      <button
        type="button"
        className={className}
        onClick={() => { void createLink(); }}
        disabled={busy || !customerCode}
      >
        {busy ? t(language, "generating") : t(language, labelKey)}
      </button>
      {error ? <em className="moduleHint" style={{ color: "#9b1c1c" }}>{error}</em> : null}
      {link?.url ? (
        <div style={{ display: "grid", gap: "6px", maxWidth: "100%" }}>
          <em className="moduleHint">{t(language, "validFor")}</em>
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
