"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";
import { getSupabaseClient } from "../lib/supabase";
import {
  dismissLunchInSuggestion,
  getKsaDateString,
  getLunchInSuggestionMessage,
  getOpenLunchBreakOutTimestamp,
  isLunchInSuggestionPath,
  ksaDayBounds,
  readLunchInSuggestionDismissedTs,
  shouldSuggestLunchIn,
} from "../lib/workdayActivity";

const TEXT = {
  continue: { en: "Continue", ar: "متابعة" },
  myDay: { en: "Open My Day", ar: "فتح يومي" },
};

export default function LunchInSuggestionPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const { language, dir } = useAppLanguage();
  const copy = getLunchInSuggestionMessage(language);
  const [visible, setVisible] = useState(false);
  const [lunchOutTs, setLunchOutTs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function evaluateSuggestion() {
      if (!isLunchInSuggestionPath(pathname)) {
        setVisible(false);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        const reportDate = getKsaDateString();
        const { startIso, endIso } = ksaDayBounds(reportDate);
        const { data: logs } = await supabase
          .from("daily_activity_logs")
          .select("entry_type,note,created_at")
          .eq("user_id", userId)
          .in("entry_type", ["LUNCH_BREAK_OUT", "LUNCH_BREAK_IN"])
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        const userLogs = logs || [];
        const openLunchOutTs = getOpenLunchBreakOutTimestamp(userLogs);
        const suggest = shouldSuggestLunchIn({
          userLogs,
          pathname,
          dismissedLunchOutTs: readLunchInSuggestionDismissedTs(),
        });

        if (!suggest) {
          setVisible(false);
          return;
        }

        setLunchOutTs(openLunchOutTs);
        setVisible(true);
      } catch {
        // Ignore suggestion failures.
      }
    }

    evaluateSuggestion();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function closeSuggestion() {
    dismissLunchInSuggestion(lunchOutTs);
    setVisible(false);
  }

  if (!visible) return null;

  const onMyDay = String(pathname || "").startsWith("/management/my-day");

  return (
    <div className="moduleModalOverlay" dir={dir}>
      <div className="moduleModal" role="dialog" aria-modal="true">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <div className="moduleOrderActions">
          <button type="button" className="modulePrimaryButton" onClick={closeSuggestion}>
            {language === "ar" ? TEXT.continue.ar : TEXT.continue.en}
          </button>
          {onMyDay ? null : (
            <button
              type="button"
              className="moduleSecondaryButton"
              onClick={() => {
                closeSuggestion();
                router.push("/management/my-day");
              }}
            >
              {language === "ar" ? TEXT.myDay.ar : TEXT.myDay.en}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
