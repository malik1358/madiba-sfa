"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";
import { copyTextToClipboard, shareTextOnWhatsapp } from "../lib/whatsappShare";

const AppPopupContext = createContext(null);

const VARIANT_LABELS = {
  success: { en: "Done", ar: "تم" },
  error: { en: "Error", ar: "خطأ" },
  warning: { en: "Notice", ar: "تنبيه" },
  info: { en: "MADIBA SFA", ar: "MADIBA SFA" },
};

export function AppPopupProvider({ children }) {
  const { language, dir } = useAppLanguage();
  const [popup, setPopup] = useState(null);

  const closePopup = useCallback(() => {
    setPopup(null);
  }, []);

  const showPopup = useCallback((input) => {
    const payload = typeof input === "string" ? { message: input } : (input || {});
    const message = String(payload.message || "").trim();
    if (!message) return;

    setPopup({
      title: String(payload.title || VARIANT_LABELS[payload.variant || "info"]?.[language] || VARIANT_LABELS.info[language]).trim(),
      message,
      variant: payload.variant || "info",
      whatsappText: String(payload.whatsappText || "").trim(),
      autoShareWhatsapp: Boolean(payload.autoShareWhatsapp),
    });
  }, [language]);

  useEffect(() => {
    if (!popup?.whatsappText) return undefined;

    void copyTextToClipboard(popup.whatsappText);

    if (!popup.autoShareWhatsapp) return undefined;

    const timer = window.setTimeout(() => {
      void shareTextOnWhatsapp(popup.whatsappText, {
        title: language === "ar" ? "ملخص الزيارة" : "Visit summary",
        dialogTitle: language === "ar" ? "مشاركة على واتساب" : "Share on WhatsApp",
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [popup?.whatsappText, popup?.autoShareWhatsapp, language]);

  const shareWhatsappFromPopup = useCallback(async () => {
    const text = String(popup?.whatsappText || "").trim();
    if (!text) return;

    const result = await shareTextOnWhatsapp(text, {
      title: language === "ar" ? "ملخص الزيارة" : "Visit summary",
      dialogTitle: language === "ar" ? "مشاركة على واتساب" : "Share on WhatsApp",
    });

    if (result.success || result.reason === "cancelled") return;

    setPopup((current) => {
      if (!current) return current;
      return {
        ...current,
        message: language === "ar"
          ? "تعذر فتح واتساب. انسخ الملخص أدناه والصقه يدوياً."
          : "Could not open WhatsApp. Copy the summary below and paste manually.",
        variant: "warning",
      };
    });
  }, [popup?.whatsappText, language]);

  const value = useMemo(() => ({ showPopup, closePopup }), [showPopup, closePopup]);

  return (
    <AppPopupContext.Provider value={value}>
      {children}
      {popup ? (
        <div className="appPopupOverlay" dir={dir} role="presentation" onClick={closePopup}>
          <div
            className={`appPopupDialog appPopupDialog${String(popup.variant || "info").charAt(0).toUpperCase()}${String(popup.variant || "info").slice(1)}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-popup-title"
            aria-describedby="app-popup-message"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="app-popup-title">{popup.title}</h2>
            <p id="app-popup-message">{popup.message}</p>
            {popup.whatsappText ? (
              <>
                <p className="appPopupWhatsappHint">
                  {language === "ar"
                    ? "تم نسخ الملخص. شاركه على واتساب الآن."
                    : "Summary copied. Share it on WhatsApp now."}
                </p>
                <textarea
                  className="moduleTextArea appPopupWhatsappSummary"
                  rows={7}
                  value={popup.whatsappText}
                  readOnly
                />
                <div className="appPopupActions">
                  <button type="button" className="modulePrimaryButton" onClick={() => { void shareWhatsappFromPopup(); }}>
                    {language === "ar" ? "مشاركة على واتساب" : "Share on WhatsApp"}
                  </button>
                  <button type="button" className="moduleInlineButton moduleActionButton appPopupOkButton" onClick={closePopup}>
                    {language === "ar" ? "حسناً" : "OK"}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="modulePrimaryButton appPopupOkButton" onClick={closePopup}>
                {language === "ar" ? "حسناً" : "OK"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </AppPopupContext.Provider>
  );
}

export function useAppPopup() {
  const context = useContext(AppPopupContext);
  if (!context) {
    throw new Error("useAppPopup must be used within AppPopupProvider.");
  }
  return context;
}
