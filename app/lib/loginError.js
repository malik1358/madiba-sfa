export function loginErrorMessage(error, ar = false) {
  const message = String(error?.message || "");
  const connectionFailed = error?.name === "AuthRetryableFetchError"
    || error?.status === 0
    || /failed to fetch|fetch failed|networkerror/i.test(message);

  if (connectionFailed) {
    return ar
      ? "تعذر الاتصال بخادم تسجيل الدخول. تحقق من الاتصال وإعدادات Supabase المحلية ثم حاول مرة أخرى."
      : "Cannot reach the sign-in server. Check your connection and local Supabase settings, then try again.";
  }

  return ar ? "البريد الإلكتروني أو كلمة المرور غير صحيحة" : "Incorrect email or password";
}