"use client";

import { useCallback, useEffect, useState } from "react";
import { WORKDAY_TIMES_UPDATED_EVENT } from "../lib/morningAttendance";
import { getSupabaseClient } from "../lib/supabase";
import {
  extractLunchTimes,
  formatKsaTime,
  getKsaDateString,
  ksaDayBounds,
  logEventIso,
} from "../lib/workdayActivity";

export function useTodayWorkdayLogs() {
  const [signedIn, setSignedIn] = useState(false);
  const [loginAt, setLoginAt] = useState(null);
  const [lunchOutAt, setLunchOutAt] = useState(null);
  const [lunchInAt, setLunchInAt] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSignedIn(false);
      setLoginAt(null);
      setLunchOutAt(null);
      setLunchInAt(null);
      setLoading(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setSignedIn(false);
        setLoginAt(null);
        setLunchOutAt(null);
        setLunchInAt(null);
        setLoading(false);
        return;
      }

      setSignedIn(true);

      const reportDate = getKsaDateString();
      const { startIso, endIso } = ksaDayBounds(reportDate);
      const { data: logs, error } = await supabase
        .from("daily_activity_logs")
        .select("entry_type,note,created_at")
        .eq("user_id", userId)
        .in("entry_type", ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN"])
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const rows = logs || [];
      const loginLog = rows.find((row) => row.entry_type === "MORNING_ATTENDANCE");
      const { lunchOutAt: lunchOut, lunchInAt: lunchIn } = extractLunchTimes(rows);

      setLoginAt(loginLog ? logEventIso(loginLog) : null);
      setLunchOutAt(lunchOut);
      setLunchInAt(lunchIn);
    } catch {
      // Keep last known values on transient failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSignedIn(false);
      setLoginAt(null);
      setLunchOutAt(null);
      setLunchInAt(null);
      setLoading(false);
      return undefined;
    }

    refresh();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });

    const handleUpdated = () => {
      refresh();
    };

    window.addEventListener(WORKDAY_TIMES_UPDATED_EVENT, handleUpdated);
    window.addEventListener("focus", handleUpdated);

    const timer = window.setInterval(refresh, 60 * 1000);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener(WORKDAY_TIMES_UPDATED_EVENT, handleUpdated);
      window.removeEventListener("focus", handleUpdated);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return {
    signedIn,
    loading,
    loginAt,
    lunchOutAt,
    lunchInAt,
    loginTime: formatKsaTime(loginAt),
    lunchOutTime: formatKsaTime(lunchOutAt),
    lunchInTime: formatKsaTime(lunchInAt),
    refresh,
  };
}
