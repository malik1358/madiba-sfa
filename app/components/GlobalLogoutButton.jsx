"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";

function hasPersistedSession() {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token") && window.localStorage.getItem(key));
  } catch {
    return false;
  }
}

export default function GlobalLogoutButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

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

  async function handleLogout() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setBusy(true);
    try {
      await supabase.auth.signOut();
      router.replace("/");
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <button
      type="button"
      className="globalLogoutButton"
      onClick={handleLogout}
      disabled={busy}
      aria-label="Logout"
    >
      {busy ? "Logging out..." : "Logout"}
    </button>
  );
}
