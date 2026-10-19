"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  MORNING_ATTENDANCE_COMPLETE_EVENT,
  canAccessWithoutMorningAttendance,
  hasMorningAttendanceToday,
  isMorningAttendanceRequiredForRole,
} from "../lib/morningAttendance";
import { getSupabaseClient } from "../lib/supabase";
import { useAppPopup } from "./AppPopupProvider";
import { useAppLanguage } from "../lib/appLanguage";

const REDIRECT_TEXT = {
  title: { en: "Morning attendance required", ar: "حضور الصباح مطلوب" },
  message: {
    en: "Open My Day and tap Morning Attendance before using any other module.",
    ar: "افتح يومي واضغط حضور الصباح قبل استخدام أي وحدة أخرى.",
  },
};

export default function MorningAttendanceRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const { showPopup } = useAppPopup();
  const { language } = useAppLanguage();
  const [checking, setChecking] = useState(true);
  const [attendanceComplete, setAttendanceComplete] = useState(false);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluateRoute() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (!cancelled) {
          setChecking(false);
          setRequired(false);
        }
        return;
      }

      setChecking(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          if (!cancelled) {
            setRequired(false);
            setAttendanceComplete(true);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();

        const needsAttendance = isMorningAttendanceRequiredForRole(profile?.role);
        if (!cancelled) setRequired(needsAttendance);

        if (!needsAttendance) {
          if (!cancelled) setAttendanceComplete(true);
          return;
        }

        const complete = await hasMorningAttendanceToday(supabase, userId);
        if (!cancelled) setAttendanceComplete(complete);

        if (!complete && !canAccessWithoutMorningAttendance(pathname)) {
          showPopup({
            title: REDIRECT_TEXT.title[language] || REDIRECT_TEXT.title.en,
            message: REDIRECT_TEXT.message[language] || REDIRECT_TEXT.message.en,
            variant: "warning",
          });
          router.replace("/management/my-day");
        }
      } catch {
        if (!cancelled) setAttendanceComplete(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    evaluateRoute();

    function handleAttendanceComplete() {
      setAttendanceComplete(true);
    }

    window.addEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);
    return () => {
      cancelled = true;
      window.removeEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);
    };
  }, [language, pathname, router, showPopup]);

  useEffect(() => {
    if (checking || !required || attendanceComplete) return;
    if (canAccessWithoutMorningAttendance(pathname)) return;
    router.replace("/management/my-day");
  }, [attendanceComplete, checking, pathname, required, router]);

  return null;
}
