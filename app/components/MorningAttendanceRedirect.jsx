"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  MORNING_ATTENDANCE_COMPLETE_EVENT,
  canAccessWithoutMorningAttendance,
  hasMorningAttendanceToday,
  insertMorningAttendanceOnce,
  isInlineMorningAttendancePath,
  isMorningAttendanceRequiredForRole,
  notifyMorningAttendanceComplete,
  readGateReadyState,
  resolveMorningAttendanceRedirectPath,
  writeGateReadyState,
} from "../lib/morningAttendance";
import {
  buildGpsActivityNote,
  formatGpsFailureMessage,
  probeGpsLocationWithRetries,
  resolveGpsCapturePlatform,
} from "../lib/geo";
import { isAtHomeDeskLocation } from "../lib/deskMode";
import { evaluateDeskModeForMissingAttendance } from "../lib/deskModeClient";
import { queueTransactionAlert } from "../lib/transactionAlertClient";
import { getSupabaseClient } from "../lib/supabase";
import { useAppPopup } from "./AppPopupProvider";
import { useAppLanguage } from "../lib/appLanguage";
import { isCollectionOnlyAccess, shouldRequireTransactionGps } from "../lib/moduleAccess";

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
  homeBlocked: {
    en: "Morning Attendance (field Login) cannot be recorded within 500 m of your saved home. You can keep working from home; punch Login after you leave home.",
    ar: "لا يمكن تسجيل حضور الصباح (دخول الميدان) ضمن 500 م من موقع المنزل المحفوظ. يمكنك متابعة العمل من المنزل؛ سجّل الحضور بعد مغادرة المنزل.",
  },
  gpsHint: {
    en: "Phone GPS can be on while Safari still blocks this website. Allow Location for madiba-sfa.vercel.app, then tap again.",
    ar: "قد يكون GPS الهاتف مفعلاً بينما Safari ما زال يحظر هذا الموقع. اسمح بالموقع لـ madiba-sfa.vercel.app ثم اضغط مرة أخرى.",
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
  const [deskModeActive, setDeskModeActive] = useState(false);
  const [homeLatitude, setHomeLatitude] = useState(null);
  const [homeLongitude, setHomeLongitude] = useState(null);

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
            setDeskModeActive(false);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role,salesman_code,home_latitude,home_longitude")
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
          setHomeLatitude(profile?.home_latitude ?? null);
          setHomeLongitude(profile?.home_longitude ?? null);
        }

        if (!needsAttendance) {
          if (!cancelled) {
            setAttendanceComplete(true);
            setDeskModeActive(false);
          }
          return;
        }

        const cached = userId ? readGateReadyState(userId) : null;
        if (cached?.attendanceComplete) {
          if (!cancelled) {
            setAttendanceComplete(true);
            setDeskModeActive(false);
          }
          return;
        }

        const complete = await hasMorningAttendanceToday(supabase, userId);
        if (!cancelled) setAttendanceComplete(complete);

        if (complete) {
          if (!cancelled) setDeskModeActive(false);
          return;
        }

        const desk = await evaluateDeskModeForMissingAttendance({
          userId,
          homeLatitude: profile?.home_latitude,
          homeLongitude: profile?.home_longitude,
        });
        if (!cancelled) setDeskModeActive(Boolean(desk.allowDeskMode));

        if (desk.allowDeskMode) {
          return;
        }

        if (!canAccessWithoutMorningAttendance(pathname)) {
          if (home === MY_DAY_PATH) {
            showPopup({
              title: REDIRECT_TEXT.title[language] || REDIRECT_TEXT.title.en,
              message: REDIRECT_TEXT.message[language] || REDIRECT_TEXT.message.en,
              variant: "warning",
            });
          }
          const search = typeof window !== "undefined" ? window.location.search : "";
          router.replace(resolveMorningAttendanceRedirectPath(pathname, search, home));
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
      setDeskModeActive(false);
    }

    window.addEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);
    return () => {
      cancelled = true;
      window.removeEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);
    };
  }, [language, pathname, router, showPopup]);

  useEffect(() => {
    if (checking || !required || attendanceComplete || deskModeActive) return;
    if (canAccessWithoutMorningAttendance(pathname)) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    router.replace(resolveMorningAttendanceRedirectPath(pathname, search, attendanceHome));
  }, [attendanceComplete, attendanceHome, checking, deskModeActive, pathname, required, router]);

  async function handleMorningAttendance() {
    const supabase = getSupabaseClient();
    if (!supabase || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Please login again.");

      let location = null;
      if (shouldRequireTransactionGps(role)) {
        try {
          location = await probeGpsLocationWithRetries({ attempts: 3, timeoutMs: 12000, retryDelayMs: 1200 });
        } catch (gpsError) {
          throw new Error(formatGpsFailureMessage(gpsError, language));
        }
        if (isAtHomeDeskLocation(location, {
          latitude: homeLatitude,
          longitude: homeLongitude,
        })) {
          throw new Error(REDIRECT_TEXT.homeBlocked[language] || REDIRECT_TEXT.homeBlocked.en);
        }
      }
      const platform = await resolveGpsCapturePlatform();
      const note = buildGpsActivityNote("MORNING_ATTENDANCE", location, { note: null, platform });
      const result = await insertMorningAttendanceOnce(supabase, session.user.id, note);

      if (!result.alreadyExists) {
        queueTransactionAlert(session.access_token, {
          transactionType: "MORNING_ATTENDANCE",
          referenceKey: `activity:${session.user.id}:MORNING_ATTENDANCE:${note}`,
        });
      }
      writeGateReadyState(session.user.id, true);
      setAttendanceComplete(true);
      setDeskModeActive(false);
      notifyMorningAttendanceComplete();
    } catch (err) {
      setSaveError(err?.message || REDIRECT_TEXT.failed[language] || REDIRECT_TEXT.failed.en);
    } finally {
      setSaving(false);
    }
  }

  // At home without field Login: allow Collections viewing; do not force the punch overlay.
  if (checking || !required || attendanceComplete || deskModeActive || !isInlineMorningAttendancePath(pathname)) {
    return null;
  }

  const text = (key) => REDIRECT_TEXT[key][language] || REDIRECT_TEXT[key].en;
  return (
    <div className="appPopupOverlay" style={{ zIndex: 11000 }} role="dialog" aria-modal="true">
      <div className="appPopupDialog">
        <h2>{text("title")}</h2>
        <p>{text("inlineMessage")}</p>
        <p className="moduleHint" style={{ marginTop: 0 }}>{text("gpsHint")}</p>
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
