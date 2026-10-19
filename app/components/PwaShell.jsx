"use client";

import { useEffect, useState } from "react";
import { countPendingOfflineQueue, processOfflineQueue } from "../lib/offlineSyncQueue";
import { fetchAndHydrateMobileSnapshot, hydrateFoundationFromCache } from "../lib/mobileDataCache";
import {
  OFFLINE_DATA_REFRESH_EVENT,
  refreshOfflineDeviceData,
} from "../lib/offlineDataRefresh";
import { getSupabaseClient } from "../lib/supabase";

async function hydrateMobileSnapshotIfMissing() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const foundation = await hydrateFoundationFromCache(session.user.id);
    if (Array.isArray(foundation?.customers) && foundation.customers.length > 0) return;
    await fetchAndHydrateMobileSnapshot();
  } catch {
    // Keep using whatever is already saved on the device.
  }
}

export default function PwaShell() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return undefined;

    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(
        registrations
          .filter((registration) => {
            const scriptUrl = registration.active?.scriptURL || registration.installing?.scriptURL || "";
            return scriptUrl.includes("/sw.js");
          })
          .map((registration) => registration.update()),
      ))
      .catch(() => undefined);

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    hydrateMobileSnapshotIfMissing();

    const supabase = getSupabaseClient();
    if (!supabase) {
      const onOnline = () => hydrateMobileSnapshotIfMissing();
      window.addEventListener("online", onOnline);
      return () => window.removeEventListener("online", onOnline);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        hydrateMobileSnapshotIfMissing();
      }
    });

    const onOnline = () => hydrateMobileSnapshotIfMissing();
    window.addEventListener("online", onOnline);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
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
    const onRefresh = (event) => {
      refreshOfflineDeviceData(event?.detail || {}).catch(() => undefined);
    };
    window.addEventListener(OFFLINE_DATA_REFRESH_EVENT, onRefresh);

    const supabase = getSupabaseClient();
    let cancelled = false;
    let channel = null;

    async function pollVersion() {
      try {
        if (!supabase) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const response = await fetch("/api/offline-data-version", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.version) return;
        await refreshOfflineDeviceData(payload);
      } catch {
        // Keep using saved device data if the version check fails.
      }
    }

    pollVersion();
    const timer = window.setInterval(pollVersion, 30 * 1000);

    if (supabase) {
      channel = supabase
        .channel("offline-data-version")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "system_settings",
            filter: "setting_key=eq.offline_data_version_v1",
          },
          (message) => {
            try {
              const payload = JSON.parse(message?.new?.setting_value || "null");
              if (payload) refreshOfflineDeviceData(payload).catch(() => undefined);
            } catch {
              pollVersion();
            }
          },
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(OFFLINE_DATA_REFRESH_EVENT, onRefresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.offlineQueue = String(pendingCount);
  }, [pendingCount]);

  return null;
}
