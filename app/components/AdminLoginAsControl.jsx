"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { ADMIN_LOGIN_AS_SESSION_KEY } from "../lib/adminLoginAs";
import { useAppLanguage } from "../lib/appLanguage";

const COPY = {
  loginAs: { en: "Login as", ar: "تسجيل الدخول كمستخدم" },
  viewingAs: { en: "Viewing as", ar: "الدخول باسم" },
  returnToAdmin: { en: "Return to admin", ar: "العودة إلى المسؤول" },
  title: { en: "Sign in as a user", ar: "تسجيل الدخول كمستخدم" },
  choose: { en: "Select an active user", ar: "اختر مستخدماً نشطاً" },
  warning: {
    en: "This creates a real session as the selected user. Pages, permissions, and API data will match that account. Any changes you make will be saved as that user.",
    ar: "سيتم إنشاء جلسة فعلية باسم المستخدم المحدد. ستظهر الصفحات والصلاحيات والبيانات كما تظهر لذلك الحساب، وستُسجل أي تغييرات باسمه.",
  },
  confirm: {
    en: "I understand changes will be made as this user",
    ar: "أفهم أن التغييرات ستُسجل باسم هذا المستخدم",
  },
  continue: { en: "Continue", ar: "متابعة" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  switching: { en: "Signing in...", ar: "جارٍ تسجيل الدخول..." },
  returning: { en: "Returning...", ar: "جارٍ الرجوع..." },
  loading: { en: "Loading users...", ar: "جارٍ تحميل المستخدمين..." },
  unavailable: { en: "Could not load users. Try again.", ar: "تعذر تحميل المستخدمين. حاول مرة أخرى." },
  failed: { en: "Could not start that user session.", ar: "تعذر بدء جلسة هذا المستخدم." },
  returnFailed: { en: "Could not restore the admin session. Try again.", ar: "تعذر استعادة جلسة المسؤول. حاول مرة أخرى." },
};

function readSavedSession() {
  try {
    const value = window.sessionStorage.getItem(ADMIN_LOGIN_AS_SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed?.session?.access_token || !parsed?.session?.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadTargets(accessToken) {
  const response = await fetch("/api/admin/login-as", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not load users.");
  return payload.targets || [];
}

export default function AdminLoginAsControl() {
  const { language, dir } = useAppLanguage();
  const ar = language === "ar";
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [returnContext, setReturnContext] = useState(null);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    let mounted = true;
    const syncSession = async (nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
      const saved = readSavedSession();
      setReturnContext(saved);
      if (saved || !nextSession?.access_token) {
        setIsAdmin(false);
        return;
      }

      try {
        const availableTargets = await loadTargets(nextSession.access_token);
        if (mounted) setIsAdmin(availableTargets.length > 0);
      } catch {
        if (mounted) setIsAdmin(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => syncSession(data?.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const text = (key) => COPY[key][ar ? "ar" : "en"];

  async function openPicker() {
    setOpen(true);
    setError("");
    setTargetId("");
    setConfirmed(false);
    setLoadingTargets(true);
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.access_token) throw new Error("Session unavailable");
      setSession(data.session);
      setTargets(await loadTargets(data.session.access_token));
    } catch {
      setError(text("unavailable"));
    } finally {
      setLoadingTargets(false);
    }
  }

  async function switchUser(event) {
    event.preventDefault();
    if (!targetId || !confirmed || busy) return;

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    try {
      const { data: current } = await supabase.auth.getSession();
      const adminSession = current?.session || session;
      if (!adminSession?.access_token || !adminSession?.refresh_token) {
        throw new Error("Admin session unavailable");
      }

      const response = await fetch("/api/admin/login-as", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetId }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.tokenHash) throw new Error(payload.error || "Could not start session");

      const target = targets.find((item) => item.id === targetId) || payload.target;
      window.sessionStorage.setItem(ADMIN_LOGIN_AS_SESSION_KEY, JSON.stringify({
        session: {
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        },
        targetName: target?.salesmanName || target?.name || "User",
      }));

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: payload.tokenHash,
        type: payload.verificationType || "magiclink",
      });
      if (verifyError) {
        window.sessionStorage.removeItem(ADMIN_LOGIN_AS_SESSION_KEY);
        throw verifyError;
      }

      window.location.assign("/");
    } catch {
      setError(text("failed"));
      setBusy(false);
    }
  }

  async function returnToAdmin() {
    const supabase = getSupabaseClient();
    const saved = readSavedSession();
    if (!supabase || !saved?.session) return;
    setBusy(true);
    setError("");
    const { error: restoreError } = await supabase.auth.setSession(saved.session);
    if (restoreError) {
      setError(text("returnFailed"));
      setBusy(false);
      return;
    }
    window.sessionStorage.removeItem(ADMIN_LOGIN_AS_SESSION_KEY);
    window.location.assign("/");
  }

  if (!returnContext && !isAdmin) return null;

  return (
    <>
      <div className="globalLoginAsControl" dir={dir}>
        {returnContext ? (
          <>
            <span className="globalLoginAsName" title={`${text("viewingAs")} ${returnContext.targetName}`}>
              {text("viewingAs")}: {returnContext.targetName}
            </span>
            <button type="button" className="globalLoginAsButton" onClick={returnToAdmin} disabled={busy}>
              {busy ? text("returning") : text("returnToAdmin")}
            </button>
          </>
        ) : (
          <button type="button" className="globalLoginAsButton" onClick={openPicker}>
            {text("loginAs")}
          </button>
        )}
      </div>

      {open && !returnContext ? (
        <div className="moduleModalOverlay" dir={dir}>
          <form className="moduleModal adminLoginAsModal" onSubmit={switchUser} role="dialog" aria-modal="true" aria-labelledby="adminLoginAsTitle">
            <h2 id="adminLoginAsTitle">{text("title")}</h2>
            <p className="adminLoginAsWarning">{text("warning")}</p>

            {loadingTargets ? (
              <div className="moduleLoading">{text("loading")}</div>
            ) : (
              <>
                <label className="adminLoginAsField">
                  <span>{text("choose")}</span>
                  <select value={targetId} onChange={(event) => setTargetId(event.target.value)} required>
                    <option value="">{text("choose")}</option>
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {[target.salesmanName, target.salesmanCode, target.role].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="adminLoginAsConfirm">
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  <span>{text("confirm")}</span>
                </label>
              </>
            )}

            {error ? <p className="moduleHint" role="alert">{error}</p> : null}
            <div className="moduleOrderActions">
              <button type="submit" className="modulePrimaryButton" disabled={loadingTargets || busy || !targetId || !confirmed}>
                {busy ? text("switching") : text("continue")}
              </button>
              <button type="button" className="moduleInlineButton" onClick={() => setOpen(false)} disabled={busy}>
                {text("cancel")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}