"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  MORNING_ATTENDANCE_COMPLETE_EVENT,
  canAccessWithoutMorningAttendance,
  hasMorningAttendanceToday,
  isInlineMorningAttendancePath,
  isMorningAttendanceRequiredForRole,
  notifyMorningAttendanceComplete,
  readGateReadyState,
  writeGateReadyState,
} from "../lib/morningAttendance";
import { buildGpsActivityNote, requireGpsLocation, resolveGpsCapturePlatform } from "../lib/geo";
import { queueTransactionAlert } from "../lib/transactionAlertClient";
import { getSupabaseClient } from "../lib/supabase";
import { useAppPopup } from "./AppPopupProvider";
import { useAppLanguage } from "../lib/appLanguage";
import { isCollectionOnlyAccess } from "../lib/moduleAccess";

const MY_DAY_PATH = "/management/my-day";
const COLLECTIONS_PATH = "/management/payment-collections";

const REDIRECT_TEXT = {
  title: { en: "Morning attendance required", ar: "حضور الصباح مطلوب" },
  message: {
    en: "Open My Day and tap Morning Attendance before using any other module.",
    ar: "افتح يومي واضغط حضور الصباح قبل استخدام أي وحدة أخرى.",
  },
  inlineMessage: {
    en: "Tap Morning Attendance to start your day before recording collections.",
    ar: "اضغط حضور الصباح لبدء يومك قبل تسجيل التحصيلات.",
  },
  button: { en: "Morning Attendance", ar: "حضور الصباح" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  failed: { en: "Unable to save morning attendance.", ar: "تعذر حفظ حضور الصباح." },
};

export default function MorningAttendanceRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const { showPopup } = useAppPopup();
  const { language } = useAppLanguage();
  const [checking, setChecking] = useState(true);
  const [attendanceComplete, setAttendanceComplete] = useState(false);
  const [required, setRequired] = useState(false);
  const [role, setRole] = useState("");
  const [attendanceHome, setAttendanceHome] = useState(MY_DAY_PATH);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
          .select("role,salesman_code")
          .eq("id", userId)
          .maybeSingle();

        const needsAttendance = isMorningAttendanceRequiredForRole(profile?.role);
        const home = isCollectionOnlyAccess({
          role: profile?.role,
          salesmanCode: profile?.salesman_code,
          collectionOnlyMetadata: Boolean(session.user.user_metadata?.collection_only),
        }) ? COLLECTIONS_PATH : MY_DAY_PATH;
        if (!cancelled) {
          setRequired(needsAttendance);
          setRole(profile?.role || "");
          setAttendanceHome(home);
        }

        if (!needsAttendance) {
          if (!cancelled) setAttendanceComplete(true);
          return;
        }

        const cached = userId ? readGateReadyState(userId) : null;
        if (cached?.attendanceComplete) {
          if (!cancelled) setAttendanceComplete(true);
          return;
        }

        const complete = await hasMorningAttendanceToday(supabase, userId);
        if (!cancelled) setAttendanceComplete(complete);

        if (!complete && !canAccessWithoutMorningAttendance(pathname)) {
          if (home === MY_DAY_PATH) {
            showPopup({
              title: REDIRECT_TEXT.title[language] || REDIRECT_TEXT.title.en,
              message: REDIRECT_TEXT.message[language] || REDIRECT_TEXT.message.en,
              variant: "warning",
            });
          }
          router.replace(home);
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
    router.replace(attendanceHome);
  }, [attendanceComplete, attendanceHome, checking, pathname, required, router]);

  async function handleMorningAttendance() {
    const supabase = getSupabaseClient();
    if (!supabase || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Please login again.");

      const location = await requireGpsLocation({ role });
      const platform = await resolveGpsCapturePlatform();
      const note = buildGpsActivityNote("MORNING_ATTENDANCE", location, { note: null, platform });
      const { error: insertError } = await supabase.from("daily_activity_logs").insert({
        user_id: session.user.id,
        entry_type: "MORNING_ATTENDANCE",
        note,
      });
      if (insertError) throw insertError;

      queueTransactionAlert(session.access_token, {
        transactionType: "MORNING_ATTENDANCE",
        referenceKey: `activity:${session.user.id}:MORNING_ATTENDANCE:${note}`,
      });
      writeGateReadyState(session.user.id, true);
      setAttendanceComplete(true);
      notifyMorningAttendanceComplete();
    } catch (err) {
      setSaveError(err?.message || REDIRECT_TEXT.failed[language] || REDIRECT_TEXT.failed.en);
    } finally {
      setSaving(false);
    }
  }

  if (checking || !required || attendanceComplete || !isInlineMorningAttendancePath(pathname)) {
    return null;
  }

  const text = (key) => REDIRECT_TEXT[key][language] || REDIRECT_TEXT[key].en;
  return (
    <div className="appPopupOverlay" style={{ zIndex: 11000 }} role="dialog" aria-modal="true">
      <div className="appPopupDialog">
        <h2>{text("title")}</h2>
        <p>{text("inlineMessage")}</p>
        {saveError ? <p style={{ color: "#dc2626" }}>{saveError}</p> : null}
        <div className="appPopupActions">
          <button type="button" className="modulePrimaryButton" onClick={handleMorningAttendance} disabled={saving}>
            {saving ? text("saving") : text("button")}
          </button>
        </div>
      </div>
    </div>
  );
}
