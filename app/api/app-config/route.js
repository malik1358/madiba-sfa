import { createClient } from "@supabase/supabase-js";
import {
  ANDROID_APK_MIN_VERSION_SETTING_KEY,
  resolveAndroidApkMinVersionConfig,
} from "../../lib/androidAppVersionPolicy.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const envConfig = resolveAndroidApkMinVersionConfig({
      envVersionCode: Number(process.env.MIN_ANDROID_APK_VERSION_CODE || 0),
      envVersionName: process.env.MIN_ANDROID_APK_VERSION_NAME || "",
      envDownloadUrl: process.env.ANDROID_APK_DOWNLOAD_URL || "",
    });

    if (!supabaseUrl || !serviceKey) {
      return Response.json({
        success: true,
        androidApk: envConfig,
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", ANDROID_APK_MIN_VERSION_SETTING_KEY)
      .maybeSingle();

    if (error) throw error;

    const androidApk = resolveAndroidApkMinVersionConfig({
      settingValue: parseJson(data?.setting_value),
      envVersionCode: Number(process.env.MIN_ANDROID_APK_VERSION_CODE || 0),
      envVersionName: process.env.MIN_ANDROID_APK_VERSION_NAME || "",
      envDownloadUrl: process.env.ANDROID_APK_DOWNLOAD_URL || "",
    });

    return Response.json({
      success: true,
      androidApk,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error.message || "Unable to load app configuration.",
      },
      { status: 500 },
    );
  }
}
