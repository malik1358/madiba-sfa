"use client";

export default function AppLanguageSwitch({ language, setLanguage }) {
  return (
    <div className="languageDashboard moduleLanguageSwitch">
      <button
        type="button"
        className={language === "en" ? "active" : ""}
        onClick={() => setLanguage("en")}
      >
        English
      </button>
      <button
        type="button"
        className={language === "ar" ? "active" : ""}
        onClick={() => setLanguage("ar")}
      >
        العربية
      </button>
    </div>
  );
}