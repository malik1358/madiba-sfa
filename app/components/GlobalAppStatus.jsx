"use client";

import { useEffect, useMemo, useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import {
  dataRefreshProgressPercent,
  formatDataAge,
  getDataRefreshStatus,
  isDataRefreshStale,
  seedDataRefreshMeta,
  subscribeDataRefreshStatus,
} from "../lib/dataRefreshStatus";
import { ensureMobileSnapshotFresh, readMobileSnapshotMeta } from "../lib/mobileDataCache";
import { localizedRoleLabel } from "../lib/moduleAccess";
import { countPendingOfflineQueue } from "../lib/offlineSyncQueue";
import { getSupabaseClient } from "../lib/supabase";

const TEXT = {
  user: { en: "User", ar: "المستخدم" },
  server: { en: "Server", ar: "الخادم" },
  build: { en: "Build", ar: "الإصدار" },
  network: { en: "Network", ar: "الشبكة" },
  sync: { en: "Sync", ar: "المزامنة" },
  data: { en: "Data", ar: "البيانات" },
  online: { en: "Online", ar: "متصل" },
  offline: { en: "Offline", ar: "غير متصل" },
  pending: { en: "pending", ar: "معلق" },
  old: { en: "old", ar: "قديمة" },
  refresh: { en: "Refresh", ar: "تحديث" },
  refreshing: { en: "Refreshing", ar: "جاري التحديث" },
  notSignedIn: { en: "Not signed in", ar: "غير مسجل" },
  supabaseUnavailable: { en: "Supabase unavailable", ar: "Supabase غير متاح" },
};

const STEP_LABELS = {
  download: { en: "Download", ar: "تنزيل" },
  customers: { en: "Customers", ar: "العملاء" },
  collections: { en: "Collections", ar: "التحصيل" },
  items: { en: "Items", ar: "الأصناف" },
  orders: { en: "Orders", ar: "الطلبات" },
  prices: { en: "Prices", ar: "الأسعار" },
};

export default function GlobalAppStatus({ environment, buildId, buildTime = "" }) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [identity, setIdentity] = useState("");
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [dataStatus, setDataStatus] = useState(() => getDataRefreshStatus());
  const [refreshingNow, setRefreshingNow] = useState(false);

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
    let cancelled = false;
    readMobileSnapshotMeta()
      .then((meta) => {
        if (cancelled || !meta) return;
        seedDataRefreshMeta({ lastBuiltAt: meta.builtAt, lastSavedAt: meta.savedAt });
      })
      .catch(() => {});
    return subscribeDataRefreshStatus((next) => {
      if (!cancelled) setDataStatus(next);
    });
  }, []);

  const dataAge = useMemo(() => {
    const stamp = dataStatus.lastSavedAt || dataStatus.lastBuiltAt;
    return formatDataAge(stamp, Date.now(), language);
  }, [dataStatus.lastBuiltAt, dataStatus.lastSavedAt, language]);
  const dataStale = isDataRefreshStale(dataStatus);
  const progress = dataRefreshProgressPercent(dataStatus);

  async function refreshDeviceData() {
    if (dataStatus.active || refreshingNow) return;
    setRefreshingNow(true);
    try {
      await ensureMobileSnapshotFresh({ forceRefresh: true });
    } catch {
      // Status bar already shows the error from the refresh job.
    } finally {
      setRefreshingNow(false);
    }
  }

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
      <span className={dataStale || dataStatus.error ? "globalAppStatusDataWarn" : undefined}>
        <strong>{t("data")}:</strong>{" "}
        {dataStatus.active || refreshingNow
          ? `${t("refreshing")} ${dataStatus.doneCount}/${dataStatus.totalCount || 0}`
          : `${dataAge}${dataStale ? ` · ${t("old")}` : ""}`}
      </span>
      {dataStatus.active || refreshingNow ? (
        <span className="globalAppStatusMeter" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
      ) : null}
      {(dataStatus.steps || []).length > 0 ? (
        <span className="globalAppStatusSteps">
          {dataStatus.steps.map((step) => {
            const label = STEP_LABELS[step.id]?.[language] || step.id;
            const mark = step.status === "done" ? "✓" : step.status === "running" ? "…" : step.status === "error" ? "!" : "·";
            return (
              <em key={step.id} data-status={step.status}>
                {mark} {label}
              </em>
            );
          })}
        </span>
      ) : null}
      <button
        type="button"
        className="globalAppStatusRefresh"
        onClick={() => { void refreshDeviceData(); }}
        disabled={dataStatus.active || refreshingNow}
      >
        {t("refresh")}
      </button>
    </div>
  );
}
