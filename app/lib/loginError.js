function isConnectionFailure(error, message) {
  return error?.name === "AuthRetryableFetchError"
    || error?.status === 0
    || /failed to fetch|fetch failed|networkerror/i.test(message);
}

function isServiceRestricted(error, message) {
  const status = Number(error?.status || 0);
  return status === 402
    || /exceed_egress|egress_quota|spend caps|upgrade their plan|service for this project is restricted|project is paused|over_quota|quota.?exceeded/i.test(message);
}

export function loginErrorMessage(error, ar = false) {
  const message = String(error?.message || "");

  if (isConnectionFailure(error, message)) {
    return ar
      ? "تعذر الاتصال بخادم تسجيل الدخول. تحقق من الاتصال وإعدادات Supabase المحلية ثم حاول مرة أخرى."
      : "Cannot reach the sign-in server. Check your connection and local Supabase settings, then try again.";
  }

  if (isServiceRestricted(error, message)) {
    return ar
      ? "تسجيل الدخول غير متاح مؤقتاً: مشروع قاعدة البيانات تجاوز حد الاستخدام. رقِّ خطة Supabase أو أزل حد الإنفاق ثم حاول مرة أخرى."
      : "Sign-in is temporarily unavailable: the database project has hit its usage limit. Upgrade the Supabase plan or remove the spend cap, then try again.";
  }

  return ar ? "البريد الإلكتروني أو كلمة المرور غير صحيحة" : "Incorrect email or password";
}
