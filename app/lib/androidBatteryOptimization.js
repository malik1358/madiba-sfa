import { isNativeAndroidPlatform } from "./nativeFieldTracking.js";

export async function isAndroidBatteryRestricted() {
  if (!(await isNativeAndroidPlatform())) return false;

  try {
    const { BatteryOptimization } = await import("@capawesome-team/capacitor-android-battery-optimization");
    const { enabled } = await BatteryOptimization.isBatteryOptimizationEnabled();
    return Boolean(enabled);
  } catch {
    // Older APK builds without the plugin should not hard-block the web shell.
    return false;
  }
}

export async function openAndroidBatterySettings() {
  if (!(await isNativeAndroidPlatform())) return;

  const { BatteryOptimization } = await import("@capawesome-team/capacitor-android-battery-optimization");
  await BatteryOptimization.openBatteryOptimizationSettings();
}

export async function requestAndroidBatteryUnrestricted() {
  if (!(await isNativeAndroidPlatform())) return;

  const { BatteryOptimization } = await import("@capawesome-team/capacitor-android-battery-optimization");
  await BatteryOptimization.requestIgnoreBatteryOptimization();
}
