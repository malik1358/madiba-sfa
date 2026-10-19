"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useLogoutWithDaySummary } from "../hooks/useLogoutWithDaySummary";
import { getSupabaseClient } from "../lib/supabase";

const TEXT = {
  logout: { en: "Logout", ar: "تسجيل الخروج" },
  loggingOut: { en: "Logging out...", ar: "جارٍ تسجيل الخروج..." },
};

function hasPersistedSession() {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token") && window.localStorage.getItem(key));
  } catch {
    return false;
  }
}

export default function GlobalLogoutButton() {
  const pathname = usePathname();
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const [visible, setVisible] = useState(false);
  const { requestLogout, dialog, busy } = useLogoutWithDaySummary();

  useEffect(() => {
    setVisible(hasPersistedSession());
    const supabase = getSupabaseClient();
    if (!supabase) {
      setVisible(hasPersistedSession());
      return;
    }

    let mounted = true;

    async function check() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (mounted) {
          setVisible(Boolean(session?.user) || hasPersistedSession());
        }
      } catch {
        if (mounted) {
          setVisible(hasPersistedSession());
        }
      }
    }

    check();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setVisible(Boolean(session?.user));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        className="globalLogoutButton"
        onClick={requestLogout}
        disabled={busy}
        aria-label={t("logout")}
      >
        {busy ? t("loggingOut") : t("logout")}
      </button>
      {dialog}
    </>
  );
}
