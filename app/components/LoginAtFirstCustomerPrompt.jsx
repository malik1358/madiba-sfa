"use client";

import { useEffect, useState } from "react";
import { useAppLanguage } from "../lib/appLanguage";
import {
  dismissLoginFirstCustomerHint,
  dismissLogoutLastCustomerHint,
  getLoginFirstCustomerHintCopy,
  getLogoutLastCustomerHintCopy,
  LOGIN_LOGOUT_CUSTOMER_HINT_EVENT,
  shouldShowLoginFirstCustomerHint,
  shouldShowLogoutLastCustomerHint,
} from "../lib/loginFirstCustomerHint";
import { WORKDAY_TIMES_UPDATED_EVENT } from "../lib/morningAttendance";
import { getKsaDateString, ksaDayBounds } from "../lib/workdayActivity";
import { getSupabaseClient } from "../lib/supabase";

const HINT_ENTRY_TYPES = [
  "MORNING_ATTENDANCE",
  "END_OF_DAY",
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "ORDER_SUBMITTED",
  "ORDER_DRAFT",
  "PROSPECT_FOLLOW_UP",
  "PROSPECT_REGISTERED",
];

export default function LoginAtFirstCustomerPrompt() {
  const { dir } = useAppLanguage();
  const loginCopy = getLoginFirstCustomerHintCopy();
  const logoutCopy = getLogoutLastCustomerHintCopy();
  const [visibleKind, setVisibleKind] = useState("");
  const [hintKey, setHintKey] = useState({ userId: "", reportDate: "" });

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function evaluateHint() {
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
          .in("entry_type", HINT_ENTRY_TYPES)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        const hintArgs = { logs: logs || [], userId, reportDate };
        const showLogin = shouldShowLoginFirstCustomerHint(hintArgs);
        const showLogout = shouldShowLogoutLastCustomerHint(hintArgs);

        if (!showLogin && !showLogout) {
          setVisibleKind("");
          return;
        }

        setHintKey({ userId, reportDate });
        setVisibleKind(showLogin ? "login" : "logout");
      } catch {
        // Ignore hint failures; never block the user.
      }
    }

    function scheduleEvaluate() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        evaluateHint();
      }, 800);
    }

    scheduleEvaluate();
    window.addEventListener(LOGIN_LOGOUT_CUSTOMER_HINT_EVENT, scheduleEvaluate);
    window.addEventListener(WORKDAY_TIMES_UPDATED_EVENT, scheduleEvaluate);
    window.addEventListener("focus", scheduleEvaluate);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(LOGIN_LOGOUT_CUSTOMER_HINT_EVENT, scheduleEvaluate);
      window.removeEventListener(WORKDAY_TIMES_UPDATED_EVENT, scheduleEvaluate);
      window.removeEventListener("focus", scheduleEvaluate);
    };
  }, []);

  function closeHint() {
    if (visibleKind === "logout") {
      dismissLogoutLastCustomerHint(hintKey.userId, hintKey.reportDate);
    } else {
      dismissLoginFirstCustomerHint(hintKey.userId, hintKey.reportDate);
    }
    setVisibleKind("");
    window.dispatchEvent(new CustomEvent(LOGIN_LOGOUT_CUSTOMER_HINT_EVENT));
  }

  if (!visibleKind) return null;

  const copy = visibleKind === "logout" ? logoutCopy : loginCopy;
  const titleId = visibleKind === "logout"
    ? "logout-last-customer-title-en"
    : "login-first-customer-title-en";

  return (
    <div className="moduleModalOverlay" dir={dir}>
      <div className="moduleModal" role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <h2 id={titleId}>{copy.titleEn}</h2>
        <p>{copy.bodyEn}</p>
        <h2 dir="rtl">{copy.titleAr}</h2>
        <p dir="rtl">{copy.bodyAr}</p>
        <div className="moduleOrderActions">
          <button type="button" className="modulePrimaryButton" onClick={closeHint}>
            {copy.okEn} / {copy.okAr}
          </button>
        </div>
      </div>
    </div>
  );
}
