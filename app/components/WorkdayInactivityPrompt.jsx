"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { getSupabaseClient } from "../lib/supabase";
import {
  getKsaDateString,
  INACTIVITY_PROMPT_DISMISS_SNOOZE_MS,
  INACTIVITY_PROMPT_SHOWN_SNOOZE_MS,
  isInactivityPromptSnoozed,
  ksaDayBounds,
  logEventTimestamp,
  shouldWarnInactivity,
  snoozeInactivityPrompt,
} from "../lib/workdayActivity";

const TEXT = {
  title: { en: "No activity recorded", ar: "لا يوجد نشاط مسجل" },
  message: {
    en: "You have not logged a visit, order, or collection in the last 30 minutes. Please record your current activity.",
    ar: "لم تسجل زيارة أو طلب أو تحصيل خلال آخر 30 دقيقة. يرجى تسجيل نشاطك الحالي.",
  },
  dismiss: { en: "Remind me in 15 minutes", ar: "ذكرني بعد 15 دقيقة" },
  myDay: { en: "Open My Day", ar: "فتح يومي" },
};

export default function WorkdayInactivityPrompt() {
  const router = useRouter();
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluateInactivity() {
      if (typeof window === "undefined") return;
      if (isInactivityPromptSnoozed()) return;

      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        const reportDate = getKsaDateString();
        const { startIso, endIso } = ksaDayBounds(reportDate);

        const [logsRes, collectionsRes, ordersRes] = await Promise.all([
          supabase
            .from("daily_activity_logs")
            .select("entry_type,note,created_at")
            .eq("user_id", userId)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: true }),
          supabase
            .from("collection_visits")
            .select("saved_at")
            .eq("created_by", userId)
            .gte("saved_at", startIso)
            .lte("saved_at", endIso),
          supabase
            .from("sales_orders")
            .select("created_at,updated_at,submitted_at")
            .eq("created_by", userId)
            .gte("updated_at", startIso)
            .lte("updated_at", endIso),
        ]);

        if (cancelled || isInactivityPromptSnoozed()) return;

        const logs = logsRes.data || [];
        const loginLog = logs.find((row) => row.entry_type === "MORNING_ATTENDANCE");
        const logoutLog = [...logs].reverse().find((row) => row.entry_type === "END_OF_DAY");

        const warn = shouldWarnInactivity({
          loginAt: loginLog ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString() : null,
          logoutAt: logoutLog ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString() : null,
          userLogs: logs,
          collections: collectionsRes.data || [],
          orders: ordersRes.data || [],
        });

        if (!warn) {
          setVisible(false);
          return;
        }

        snoozeInactivityPrompt(INACTIVITY_PROMPT_SHOWN_SNOOZE_MS);
        setVisible(true);
      } catch {
        // Ignore prompt failures.
      }
    }

    evaluateInactivity();
    const timer = window.setInterval(evaluateInactivity, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="moduleModalOverlay" dir={dir}>
      <div className="moduleModal" role="dialog" aria-modal="true">
        <h2>{t("title")}</h2>
        <p>{t("message")}</p>
        <div className="moduleOrderActions">
          <button
            type="button"
            className="modulePrimaryButton"
            onClick={() => {
              snoozeInactivityPrompt(INACTIVITY_PROMPT_SHOWN_SNOOZE_MS);
              setVisible(false);
              router.push("/management/my-day");
            }}
          >
            {t("myDay")}
          </button>
          <button
            type="button"
            className="moduleSecondaryButton"
            onClick={() => {
              snoozeInactivityPrompt(INACTIVITY_PROMPT_DISMISS_SNOOZE_MS);
              setVisible(false);
            }}
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
