"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../lib/authSession";
import { NATIVE_WORKDAY_STOP_EVENT } from "../lib/nativeFieldTracking";
import { getSupabaseClient } from "../lib/supabase";
import { shareTextOnWhatsapp } from "../lib/whatsappShare";

const TEXT = {
  title: { en: "Logout", ar: "تسجيل الخروج" },
  subtitle: {
    en: "Share your daily visit summary on WhatsApp before logging out?",
    ar: "هل تريد مشاركة ملخص زيارات اليوم على واتساب قبل تسجيل الخروج؟",
  },
  loading: { en: "Loading daily summary...", ar: "جاري تحميل ملخص اليوم..." },
  noVisits: {
    en: "No collection visits recorded today.",
    ar: "لا توجد زيارات تحصيل مسجلة اليوم.",
  },
  shareWhatsapp: { en: "Share on WhatsApp", ar: "مشاركة على واتساب" },
  logoutAnyway: { en: "Logout without sharing", ar: "تسجيل الخروج بدون مشاركة" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  sharing: { en: "Opening WhatsApp...", ar: "جاري فتح واتساب..." },
  loggingOut: { en: "Logging out...", ar: "جاري تسجيل الخروج..." },
  summaryTitle: { en: "Daily visit summary", ar: "ملخص الزيارات اليومي" },
  loadFailed: {
    en: "Could not load today's summary. You can still log out.",
    ar: "تعذر تحميل ملخص اليوم. يمكنك تسجيل الخروج.",
  },
};

async function fetchDaySummary(accessToken) {
  const { response, payload } = await fetchJsonWithTimeout(
    "/api/payment-collections/day-summary",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    20000,
  );

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load day summary.");
  }

  return payload;
}

export function useLogoutWithDaySummary() {
  const router = useRouter();
  const { language, dir } = useAppLanguage();
  const t = useMemo(() => translate(language, TEXT), [language]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [summaryPayload, setSummaryPayload] = useState(null);

  const summaryLines = useMemo(() => {
    if (!summaryPayload?.daySummary) return [];
    return language === "ar"
      ? (summaryPayload.daySummary.linesAr || summaryPayload.daySummary.lines || [])
      : (summaryPayload.daySummary.lines || []);
  }, [language, summaryPayload]);

  const summaryText = useMemo(() => {
    if (!summaryPayload) return "";
    return language === "ar"
      ? (summaryPayload.summaryTextAr || summaryPayload.summaryTextEn || "")
      : (summaryPayload.summaryTextEn || "");
  }, [language, summaryPayload]);

  const performLogout = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setBusyAction("logout");
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(NATIVE_WORKDAY_STOP_EVENT));
      }
      await supabase.auth.signOut();
      setOpen(false);
      router.replace("/");
    } finally {
      setBusyAction("");
    }
  }, [router]);

  const requestLogout = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setOpen(true);
    setLoading(true);
    setError("");
    setSummaryPayload(null);

    try {
      const session = await resolveAuthSession(supabase, 10000);
      if (!session?.access_token) {
        await performLogout();
        return;
      }

      const payload = await fetchDaySummary(session.access_token);
      setSummaryPayload(payload);
    } catch (err) {
      setError(err.message || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [performLogout, t]);

  const closeDialog = useCallback(() => {
    if (busyAction) return;
    setOpen(false);
    setError("");
    setSummaryPayload(null);
  }, [busyAction]);

  const shareOnWhatsapp = useCallback(async () => {
    const message = String(summaryText || "").trim();
    if (!message) {
      await performLogout();
      return;
    }

    setBusyAction("share");
    try {
      const result = await shareTextOnWhatsapp(message, {
        dialogTitle: t("shareWhatsapp"),
        title: t("summaryTitle"),
      });
      if (result.success || result.reason === "unavailable") {
        await performLogout();
      }
    } finally {
      setBusyAction("");
    }
  }, [performLogout, summaryText, t]);

  const dialog = open ? (
    <div className="moduleModalOverlay" dir={dir}>
      <div className="moduleModal" role="dialog" aria-modal="true">
        <h2>{t("title")}</h2>
        <p className="moduleSubtitle">{t("subtitle")}</p>

        {loading ? (
          <div className="moduleLoading">{t("loading")}</div>
        ) : (
          <>
            {error ? <div className="moduleHint">{error}</div> : null}
            <section className="moduleDaySummary" aria-label={t("summaryTitle")}>
              <h3>{t("summaryTitle")}</h3>
              {summaryLines.length ? (
                <ul className="moduleDaySummaryList">
                  {summaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="moduleHint">{t("noVisits")}</p>
              )}
            </section>
          </>
        )}

        <div className="moduleOrderActions">
          <button
            type="button"
            className="modulePrimaryButton"
            onClick={shareOnWhatsapp}
            disabled={loading || Boolean(busyAction) || !summaryText}
          >
            {busyAction === "share" ? t("sharing") : t("shareWhatsapp")}
          </button>
          <button
            type="button"
            className="moduleInlineButton"
            onClick={performLogout}
            disabled={loading || Boolean(busyAction)}
          >
            {busyAction === "logout" ? t("loggingOut") : t("logoutAnyway")}
          </button>
          <button
            type="button"
            className="moduleInlineButton"
            onClick={closeDialog}
            disabled={Boolean(busyAction)}
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return {
    requestLogout,
    dialog,
    busy: Boolean(busyAction) || loading,
  };
}
