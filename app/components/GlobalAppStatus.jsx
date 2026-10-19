"use client";

import { useEffect, useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { localizedRoleLabel } from "../lib/moduleAccess";
import { countPendingOfflineQueue } from "../lib/offlineSyncQueue";
import { getSupabaseClient } from "../lib/supabase";

const TEXT = {
  user: { en: "User", ar: "المستخدم" },
  server: { en: "Server", ar: "الخادم" },
  build: { en: "Build", ar: "الإصدار" },
  network: { en: "Network", ar: "الشبكة" },
  sync: { en: "Sync", ar: "المزامنة" },
  online: { en: "Online", ar: "متصل" },
  offline: { en: "Offline", ar: "غير متصل" },
  pending: { en: "pending", ar: "معلق" },
  notSignedIn: { en: "Not signed in", ar: "غير مسجل" },
  supabaseUnavailable: { en: "Supabase unavailable", ar: "Supabase غير متاح" },
};

export default function GlobalAppStatus({ environment, buildId, buildTime = "" }) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [identity, setIdentity] = useState("");
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function refreshOnline() {
      setOnline(window.navigator.onLine);
    }

    refreshOnline();
    window.addEventListener("online", refreshOnline);
    window.addEventListener("offline", refreshOnline);
    return () => {
      window.removeEventListener("online", refreshOnline);
      window.removeEventListener("offline", refreshOnline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshPending() {
      try {
        const count = await countPendingOfflineQueue();
        if (!cancelled) setPendingSync(count);
      } catch {
        if (!cancelled) setPendingSync(0);
      }
    }

    refreshPending();
    window.addEventListener("madiba-offline-queue-changed", refreshPending);
    window.addEventListener("online", refreshPending);
    return () => {
      cancelled = true;
      window.removeEventListener("madiba-offline-queue-changed", refreshPending);
      window.removeEventListener("online", refreshPending);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIdentity(t("supabaseUnavailable"));
      return undefined;
    }

    let mounted = true;

    async function loadIdentity(session) {
      const translateStatus = translate(language, TEXT);

      if (!session?.user) {
        if (mounted) setIdentity(translateStatus("notSignedIn"));
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("salesman_name,salesman_code,role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!mounted) return;

      const name = String(profile?.salesman_name || session.user.email || session.user.id).trim();
      const code = String(profile?.salesman_code || "").trim();
      const role = localizedRoleLabel(profile?.role, language);
      const details = [code, role].filter(Boolean).join(" / ");
      setIdentity(details ? `${name} (${details})` : name);
    }

    supabase.auth.getSession().then(({ data }) => loadIdentity(data?.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadIdentity(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [language]);

  return (
    <div className={`globalAppStatus globalAppStatus${environment}`} role="status" dir={dir}>
      <span><strong>{t("user")}:</strong> {identity || t("notSignedIn")}</span>
      <span><strong>{t("server")}:</strong> {environment}</span>
      <span>
        <strong>{t("build")}:</strong> {buildId}
        {buildTime ? ` · ${buildTime}` : ""}
      </span>
      <span><strong>{t("network")}:</strong> {online ? t("online") : t("offline")}</span>
      {pendingSync > 0 ? (
        <span><strong>{t("sync")}:</strong> {pendingSync} {t("pending")}</span>
      ) : null}
    </div>
  );
}
