INSERT INTO public.system_settings (setting_key, setting_value)
VALUES (
  'android_apk_min_version_v1',
  '{"minVersionCode":24,"minVersionName":"1.0.24","messageEn":"Install the latest MADIBA APK from your administrator, then sign in again.","messageAr":"ثبّت أحدث APK من المسؤول ثم سجّل الدخول مرة أخرى."}'
)
ON CONFLICT (setting_key) DO UPDATE
SET
  setting_value = EXCLUDED.setting_value,
  updated_at = now();
