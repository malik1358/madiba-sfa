"use client";

import { useEffect, useState } from "react";

const TEXT = {
  title: { en: "Install MADIBA SFA", ar: "تثبيت MADIBA SFA" },
  subtitle: {
    en: "Install the app on your phone for faster access, GPS, and camera support.",
    ar: "ثبّت التطبيق على هاتفك للوصول الأسرع ودعم GPS والكاميرا.",
  },
  androidTitle: { en: "Android (Chrome)", ar: "أندرويد (Chrome)" },
  iphoneTitle: { en: "iPhone (Safari)", ar: "آيفون (Safari)" },
  androidSteps: {
    en: [
      "Open https://madiba-sfa.vercel.app in Chrome.",
      "Tap the menu (3 dots) in the top-right corner.",
      "Tap Install app or Add to Home screen.",
      "Confirm Install.",
      "Open MADIBA from your home screen before each workday.",
    ],
    ar: [
      "افتح https://madiba-sfa.vercel.app في Chrome.",
      "اضغط قائمة الثلاث نقاط أعلى اليمين.",
      "اختر Install app أو Add to Home screen.",
      "أكد التثبيت.",
      "افتح MADIBA من الشاشة الرئيسية قبل بداية يوم العمل.",
    ],
  },
  iphoneSteps: {
    en: [
      "Open https://madiba-sfa.vercel.app in Safari.",
      "Do not use the WhatsApp or Instagram browser.",
      "Tap Share (square with arrow).",
      "Tap Add to Home Screen.",
      "Tap Add, then open MADIBA from your home screen.",
    ],
    ar: [
      "افتح https://madiba-sfa.vercel.app في Safari.",
      "لا تستخدم متصفح واتساب أو إنستغرام.",
      "اضغط Share (المربع والسهم).",
      "اختر Add to Home Screen.",
      "اضغط Add ثم افتح MADIBA من الشاشة الرئيسية.",
    ],
  },
  offlineNote: {
    en: "After install: open My Day or Collections once while online so customer data is saved on the phone. Visits and collections can then be saved offline and will sync automatically when internet returns.",
    ar: "بعد التثبيت: افتح My Day أو Collections مرة واحدة وأنت متصل بالإنترنت لحفظ بيانات العملاء على الهاتف. بعد ذلك يمكن حفظ الزيارات والتحصيلات بدون إنترنت وسيتم المزامنة تلقائياً عند عودة الشبكة.",
  },
  installNow: { en: "Install now", ar: "ثبّت الآن" },
  close: { en: "Close", ar: "إغلاق" },
};

function translate(language, key) {
  const entry = TEXT[key];
  if (!entry) return "";
  return entry[language] || entry.en;
}

function renderSteps(language, key) {
  const steps = TEXT[key]?.[language] || TEXT[key]?.en || [];
  return (
    <ol className="pwaInstallSteps">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export default function PwaInstallGuide({ language = "en", open = false, onClose }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  if (!open) return null;

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
  }

  return (
    <div className="moduleModalOverlay" role="presentation" onClick={onClose}>
      <div
        className="moduleModal pwaInstallModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="moduleSectionHeader">
          <h2 id="pwa-install-title">{translate(language, "title")}</h2>
        </div>
        <p className="moduleSubtitle">{translate(language, "subtitle")}</p>

        <section className="moduleSection">
          <h3>{translate(language, "androidTitle")}</h3>
          {renderSteps(language, "androidSteps")}
        </section>

        <section className="moduleSection">
          <h3>{translate(language, "iphoneTitle")}</h3>
          {renderSteps(language, "iphoneSteps")}
        </section>

        <div className="moduleHint">{translate(language, "offlineNote")}</div>

        <div className="moduleOrderActions">
          {deferredPrompt ? (
            <button type="button" className="modulePrimaryButton" onClick={handleInstallClick}>
              {translate(language, "installNow")}
            </button>
          ) : null}
          <button type="button" className="moduleInlineButton" onClick={onClose}>
            {translate(language, "close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PwaInstallButton({ language = "en", className = "moduleInlineButton moduleActionButton" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {language === "ar" ? "تثبيت التطبيق" : "Install App"}
      </button>
      <PwaInstallGuide language={language} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
