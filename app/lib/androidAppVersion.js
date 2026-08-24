import {
  isAndroidApkVersionOutdated,
  parseAndroidApkMinVersionConfig,
} from "./androidAppVersionPolicy.js";
import { isNativeAndroidPlatform } from "./nativeFieldTracking.js";

export async function getNativeAndroidAppVersion() {
  if (!(await isNativeAndroidPlatform())) return null;

  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return {
      versionCode: Number(info?.build) || 0,
      versionName: String(info?.version || "").trim(),
    };
  } catch {
    return null;
  }
}

export async function fetchAndroidApkMinimumRequirement() {
  try {
    const response = await fetch("/api/app-config", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      return parseAndroidApkMinVersionConfig({});
    }
    return parseAndroidApkMinVersionConfig(payload?.androidApk || {});
  } catch {
    return parseAndroidApkMinVersionConfig({});
  }
}

export async function evaluateNativeAndroidApkVersion() {
  const current = await getNativeAndroidAppVersion();
  if (!current) {
    return {
      applies: false,
      outdated: false,
      current: null,
      minimum: parseAndroidApkMinVersionConfig({}),
    };
  }

  const minimum = await fetchAndroidApkMinimumRequirement();
  const outdated = isAndroidApkVersionOutdated(current.versionCode, minimum.minVersionCode);

  return {
    applies: minimum.minVersionCode > 0,
    outdated,
    current,
    minimum,
  };
}
