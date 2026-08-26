"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";
import {
  copyTextToClipboard,
  shareTextAndFilesOnWhatsapp,
  shareTextOnWhatsapp,
} from "../lib/whatsappShare";

const AppPopupContext = createContext(null);

const VARIANT_LABELS = {
  success: { en: "Done", ar: "تم" },
  error: { en: "Error", ar: "خطأ" },
  warning: { en: "Notice", ar: "تنبيه" },
  info: { en: "MADIBA SFA", ar: "MADIBA SFA" },
};

function normalizeWhatsappFile(file) {
  return file instanceof Blob ? file : null;
}

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
      whatsappFile: normalizeWhatsappFile(payload.whatsappFile),
      autoShareWhatsapp: Boolean(payload.autoShareWhatsapp),
    });
  }, [language]);

  const shareWhatsappPayload = useCallback(async (payload, options = {}) => {
    const text = String(payload?.whatsappText || "").trim();
    const file = normalizeWhatsappFile(payload?.whatsappFile);
    if (!text && !file) return { success: false, reason: "empty" };

    const title = language === "ar" ? "ملخص للمشاركة" : "Share summary";
    const dialogTitle = file
      ? (language === "ar" ? "مشاركة PDF والملخص على واتساب" : "Share PDF and summary on WhatsApp")
      : (language === "ar" ? "مشاركة على واتساب" : "Share on WhatsApp");

    if (file) {
      return shareTextAndFilesOnWhatsapp(text, [file], {
        title,
        dialogTitle,
        ...options,
      });
    }

    return shareTextOnWhatsapp(text, {
      title,
      dialogTitle,
      ...options,
    });
  }, [language]);

  useEffect(() => {
    if (!popup?.whatsappText && !popup?.whatsappFile) return undefined;

    if (popup.whatsappText) {
      void copyTextToClipboard(popup.whatsappText);
    }

    if (!popup.autoShareWhatsapp) return undefined;

    const timer = window.setTimeout(() => {
      void shareWhatsappPayload(popup);
    }, 450);

    return () => window.clearTimeout(timer);
  }, [popup, shareWhatsappPayload]);

  const shareWhatsappFromPopup = useCallback(async () => {
    if (!popup) return;

    const result = await shareWhatsappPayload(popup);

    if (result.success) {
      if (result.fallback) {
        setPopup((current) => {
          if (!current) return current;
          return {
            ...current,
            message: language === "ar"
              ? "تم فتح واتساب بالملخص. أرفق ملف PDF يدوياً إذا لم يُرفق تلقائياً."
              : "WhatsApp opened with the summary. Attach the PDF manually if it was not included.",
            variant: "warning",
          };
        });
      }
      return;
    }

    if (result.reason === "cancelled") return;

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
  }, [language, popup, shareWhatsappPayload]);

  const value = useMemo(() => ({ showPopup, closePopup }), [showPopup, closePopup]);

  const whatsappHint = popup?.whatsappFile
    ? (language === "ar"
      ? "تم نسخ الملخص. شارك PDF والملخص على واتساب الآن."
      : "Summary copied. Share the PDF and summary on WhatsApp now.")
    : (language === "ar"
      ? "تم نسخ الملخص. شاركه على واتساب الآن."
      : "Summary copied. Share it on WhatsApp now.");

  const whatsappButtonLabel = popup?.whatsappFile
    ? (language === "ar" ? "مشاركة PDF على واتساب" : "Share PDF on WhatsApp")
    : (language === "ar" ? "مشاركة على واتساب" : "Share on WhatsApp");

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
            {popup.whatsappText || popup.whatsappFile ? (
              <>
                <p className="appPopupWhatsappHint">{whatsappHint}</p>
                {popup.whatsappText ? (
                  <textarea
                    className="moduleTextArea appPopupWhatsappSummary"
                    rows={7}
                    value={popup.whatsappText}
                    readOnly
                  />
                ) : null}
                <div className="appPopupActions">
                  <button type="button" className="modulePrimaryButton" onClick={() => { void shareWhatsappFromPopup(); }}>
                    {whatsappButtonLabel}
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
