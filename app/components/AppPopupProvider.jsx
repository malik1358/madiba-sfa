"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";

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
    });
  }, [language]);

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
            <button type="button" className="modulePrimaryButton appPopupOkButton" onClick={closePopup}>
              {language === "ar" ? "حسناً" : "OK"}
            </button>
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
