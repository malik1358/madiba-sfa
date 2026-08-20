"use client";

import { useEffect, useState } from "react";
import { countPendingOfflineQueue } from "../lib/offlineSyncQueue";
import { getSupabaseClient } from "../lib/supabase";

export default function GlobalAppStatus({ environment, buildId, buildTime = "" }) {
  const [identity, setIdentity] = useState("Not signed in");
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
      setIdentity("Supabase unavailable");
      return undefined;
    }

    let mounted = true;

    async function loadIdentity(session) {
      if (!session?.user) {
        if (mounted) setIdentity("Not signed in");
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
      const role = String(profile?.role || "").trim();
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
  }, []);

  return (
    <div className={`globalAppStatus globalAppStatus${environment}`} role="status">
      <span><strong>User:</strong> {identity}</span>
      <span><strong>Server:</strong> {environment}</span>
      <span>
        <strong>Build:</strong> {buildId}
        {buildTime ? ` · ${buildTime}` : ""}
      </span>
      <span><strong>Network:</strong> {online ? "Online" : "Offline"}</span>
      {pendingSync > 0 ? (
        <span><strong>Sync:</strong> {pendingSync} pending</span>
      ) : null}
    </div>
  );
}