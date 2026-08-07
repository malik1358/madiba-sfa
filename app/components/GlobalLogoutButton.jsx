"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";

export default function GlobalLogoutButton() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let mounted = true;

    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (mounted) {
        setVisible(Boolean(session?.user));
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
  }, []);

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
