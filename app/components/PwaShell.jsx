"use client";

import { useEffect, useState } from "react";
import { countPendingOfflineQueue, processOfflineQueue } from "../lib/offlineSyncQueue";
import { fetchAndHydrateMobileSnapshot } from "../lib/mobileDataCache";
import { getSupabaseClient } from "../lib/supabase";

export default function PwaShell() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return undefined;

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return undefined;

    fetchAndHydrateMobileSnapshot().catch(() => undefined);

    const onOnline = () => {
      fetchAndHydrateMobileSnapshot().catch(() => undefined);
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshPendingCount() {
      try {
        const count = await countPendingOfflineQueue();
        if (!cancelled) setPendingCount(count);
      } catch {
        if (!cancelled) setPendingCount(0);
      }
    }

    refreshPendingCount();

    const onQueueChanged = () => refreshPendingCount();
    window.addEventListener("madiba-offline-queue-changed", onQueueChanged);
    window.addEventListener("online", onQueueChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("madiba-offline-queue-changed", onQueueChanged);
      window.removeEventListener("online", onQueueChanged);
    };
  }, []);

  useEffect(() => {
    async function getAccessToken() {
      const supabase = getSupabaseClient();
      if (!supabase) return "";
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || "";
    }

    async function syncNow() {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      await processOfflineQueue(getAccessToken);
    }

    syncNow();
    window.addEventListener("online", syncNow);
    const timer = setInterval(syncNow, 30000);

    return () => {
      window.removeEventListener("online", syncNow);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.offlineQueue = String(pendingCount);
  }, [pendingCount]);

  return null;
}
