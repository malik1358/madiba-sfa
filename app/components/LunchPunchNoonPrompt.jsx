"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";
import { getSupabaseClient } from "../lib/supabase";
import {
  areActivityRemindersEnabled,
  dismissLunchPunchNoonReminder,
  getKsaDateString,
  getLunchPunchNoonReminderMessage,
  getLunchPunchProgress,
  ksaDayBounds,
  logEventTimestamp,
  readLunchPunchNoonDismissedDate,
  shouldRemindLunchPunchNoon,
} from "../lib/workdayActivity";

const TEXT = {
  continue: { en: "Continue", ar: "متابعة" },
  myDay: { en: "Open My Day", ar: "فتح يومي" },
};

export default function LunchPunchNoonPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const { language, dir } = useAppLanguage();
  const [visible, setVisible] = useState(false);
  const [hasLunchOut, setHasLunchOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluateReminder() {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("activity_reminders_enabled")
          .eq("id", userId)
          .maybeSingle();
        if (!areActivityRemindersEnabled(profile)) {
          setVisible(false);
          return;
        }

        const reportDate = getKsaDateString();
        const { startIso, endIso } = ksaDayBounds(reportDate);
        const { data: logs } = await supabase
          .from("daily_activity_logs")
          .select("entry_type,note,created_at")
          .eq("user_id", userId)
          .in("entry_type", ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN", "END_OF_DAY"])
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        const userLogs = logs || [];
        const loginLog = userLogs.find((row) => row.entry_type === "MORNING_ATTENDANCE");
        const logoutLog = [...userLogs].reverse().find((row) => row.entry_type === "END_OF_DAY");
        const remind = shouldRemindLunchPunchNoon({
          loginAt: loginLog
            ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString()
            : null,
          logoutAt: logoutLog
            ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString()
            : null,
          userLogs,
          dismissedDate: readLunchPunchNoonDismissedDate(),
        });

        if (!remind) {
          setVisible(false);
          return;
        }

        setHasLunchOut(getLunchPunchProgress(userLogs).lunchOut);
        setVisible(true);
      } catch {
        // Ignore reminder failures.
      }
    }

    evaluateReminder();
    const timer = window.setInterval(evaluateReminder, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function closeReminder() {
    dismissLunchPunchNoonReminder();
    setVisible(false);
  }

  if (!visible) return null;

  const copy = getLunchPunchNoonReminderMessage({ hasLunchOut });
  const [bodyEn, bodyAr] = String(copy.body || "").split("\n");
  const onMyDay = String(pathname || "").startsWith("/management/my-day");

  return (
    <div className="moduleModalOverlay" dir={dir}>
      <div className="moduleModal" role="dialog" aria-modal="true">
        <h2>{copy.title}</h2>
        <p>{bodyEn}</p>
        <p>{bodyAr}</p>
        <div className="moduleOrderActions">
          <button
            type="button"
            className="modulePrimaryButton"
            onClick={() => {
              closeReminder();
              if (!onMyDay) router.push("/management/my-day");
            }}
          >
            {onMyDay
              ? (language === "ar" ? TEXT.continue.ar : TEXT.continue.en)
              : (language === "ar" ? TEXT.myDay.ar : TEXT.myDay.en)}
          </button>
          {onMyDay ? null : (
            <button type="button" className="moduleSecondaryButton" onClick={closeReminder}>
              {language === "ar" ? TEXT.continue.ar : TEXT.continue.en}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
