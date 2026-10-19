export const ANDROID_APK_MIN_VERSION_SETTING_KEY = "android_apk_min_version_v1";

export function parseAndroidApkMinVersionConfig(raw) {
  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  const source = parsed && typeof parsed === "object" ? parsed : {};
  const minVersionCode = Number(source.minVersionCode ?? source.versionCode ?? 0);
  const minVersionName = String(source.minVersionName ?? source.versionName ?? "").trim();
  const downloadUrl = String(source.downloadUrl ?? source.apkDownloadUrl ?? "").trim();
  const messageEn = String(source.messageEn ?? source.message ?? "").trim();
  const messageAr = String(source.messageAr ?? "").trim();

  return {
    minVersionCode: Number.isFinite(minVersionCode) ? Math.max(0, Math.floor(minVersionCode)) : 0,
    minVersionName,
    downloadUrl,
    messageEn,
    messageAr,
  };
}

export function resolveAndroidApkMinVersionConfig({
  settingValue = null,
  envVersionCode = 0,
  envVersionName = "",
  envDownloadUrl = "",
} = {}) {
  const fromSetting = parseAndroidApkMinVersionConfig(settingValue);
  const fromEnv = parseAndroidApkMinVersionConfig({
    minVersionCode: envVersionCode,
    minVersionName: envVersionName,
    downloadUrl: envDownloadUrl,
  });

  return {
    minVersionCode: Math.max(fromSetting.minVersionCode, fromEnv.minVersionCode),
    minVersionName: fromSetting.minVersionName || fromEnv.minVersionName,
    downloadUrl: fromSetting.downloadUrl || fromEnv.downloadUrl,
    messageEn: fromSetting.messageEn,
    messageAr: fromSetting.messageAr,
  };
}

export function isAndroidApkVersionOutdated(currentVersionCode, minVersionCode) {
  const current = Number(currentVersionCode);
  const minimum = Number(minVersionCode);
  if (!Number.isFinite(minimum) || minimum <= 0) return false;
  if (!Number.isFinite(current) || current <= 0) return true;
  return current < minimum;
}
