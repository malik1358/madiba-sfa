"use client";

import { translate, useAppLanguage } from "../lib/appLanguage";

const TEXT = {
  title: { en: "App update required", ar: "يجب تحديث التطبيق" },
  defaultDescription: {
    en: "This MADIBA APK is out of date. Install the latest APK from your administrator, then tap Check again.",
    ar: "إصدار MADIBA الحالي قديم. ثبّت أحدث APK من المسؤول، ثم اضغط تحقق مرة أخرى.",
  },
  currentVersion: { en: "Installed build", ar: "الإصدار المثبت" },
  requiredVersion: { en: "Required build", ar: "الإصدار المطلوب" },
  downloadApk: { en: "Download latest APK", ar: "تنزيل أحدث APK" },
  checkAgain: { en: "Check again", ar: "تحقق مرة أخرى" },
  checking: { en: "Checking app version...", ar: "جاري التحقق من إصدار التطبيق..." },
};

export default function AndroidApkUpdateRequired({
  currentVersion,
  minimum,
  checking = false,
  onRecheck,
}) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const customMessage = language === "ar"
    ? String(minimum?.messageAr || minimum?.messageEn || "").trim()
    : String(minimum?.messageEn || minimum?.messageAr || "").trim();

  const currentLabel = currentVersion?.versionName
    ? `${currentVersion.versionName} (${currentVersion.versionCode || "?"})`
    : String(currentVersion?.versionCode || "?");
  const requiredLabel = minimum?.minVersionName
    ? `${minimum.minVersionName} (${minimum.minVersionCode})`
    : String(minimum?.minVersionCode || "?");

  return (
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{checking ? t("checking") : t("title")}</h2>
          </div>
          {!checking && (
            <>
              <div className="moduleHint">{customMessage || t("defaultDescription")}</div>
              <div className="moduleHint">{`${t("currentVersion")}: ${currentLabel}`}</div>
              <div className="moduleHint">{`${t("requiredVersion")}: ${requiredLabel}`}</div>
              <div className="moduleActionRow">
                {minimum?.downloadUrl ? (
                  <a
                    className="modulePrimaryButton"
                    href={minimum.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("downloadApk")}
                  </a>
                ) : null}
                <button
                  type="button"
                  className={minimum?.downloadUrl ? "moduleInlineButton moduleActionButton" : "modulePrimaryButton"}
                  onClick={() => onRecheck?.()}
                >
                  {t("checkAgain")}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
