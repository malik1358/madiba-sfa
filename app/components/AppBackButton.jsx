"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { getSupabaseClient } from "../lib/supabase";
import { resolveBackFallbackPath } from "../lib/navigation";

const TEXT = {
  back: { en: "Back", ar: "رجوع" },
};

function hasPersistedSession() {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(window.localStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token") && window.localStorage.getItem(key),
    );
  } catch {
    return false;
  }
}

export default function AppBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const [visible, setVisible] = useState(false);

  const fallbackPath = resolveBackFallbackPath(pathname);
  const showBack = visible && Boolean(fallbackPath);

  useEffect(() => {
    setVisible(hasPersistedSession());
    const supabase = getSupabaseClient();
    if (!supabase) {
      setVisible(hasPersistedSession());
      return undefined;
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

  if (!showBack) return null;

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    if (fallbackPath) {
      router.push(fallbackPath);
    }
  }

  return (
    <button
      type="button"
      className="globalBackButton"
      onClick={handleBack}
      aria-label={t("back")}
    >
      ← {t("back")}
    </button>
  );
}
