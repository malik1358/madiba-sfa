"use client";

import { useRef, useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useAppPopup } from "./AppPopupProvider";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { useTodayWorkdayLogs } from "../hooks/useTodayWorkdayLogs";
import { isMorningAttendanceRequiredForRole, notifyWorkdayTimesUpdated } from "../lib/morningAttendance";
import { getSupabaseClient } from "../lib/supabase";
import {
  buildGpsActivityNote,
  requireGpsLocation,
  resolveGpsCapturePlatform,
} from "../lib/geo";
import { queueTransactionAlert } from "../lib/transactionAlertClient";
import {
  acceptLunchPunch,
  completeLunchPunch,
  extractLunchTimes,
  formatKsaTime,
  getKsaDateString,
  ksaDayBounds,
  lunchPunchButtons,
  mergeLunchPunchTimes,
  releaseLunchPunch,
} from "../lib/workdayActivity";

const TEXT = {
  login: { en: "Login", ar: "تسجيل الدخول" },
  lunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  lunchIn: { en: "Lunch in", ar: "عودة الغداء" },
  punchLunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  punchLunchIn: { en: "Lunch in", ar: "عودة الغداء" },
  saving: { en: "Saving", ar: "جارٍ الحفظ" },
  saveFailed: {
    en: "Unable to save the lunch punch. Check location access and try again.",
    ar: "تعذر حفظ بصمة الغداء. تحقق من إذن الموقع وحاول مرة أخرى.",
  },
};

export default function WorkdayTimesBar() {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const { showPopup } = useAppPopup();
  const { access, loading: accessLoading } = useModuleAccess();
  const {
    signedIn,
    loginAt,
    lunchOutAt,
    lunchInAt,
    loginTime,
  } = useTodayWorkdayLogs();
  const [busy, setBusy] = useState("");
  const [savedPunches, setSavedPunches] = useState({});
  const punchGuardRef = useRef({ inFlight: false, saved: {} });

  if (!signedIn) return null;

  const lunchTimes = mergeLunchPunchTimes({ lunchOutAt, lunchInAt }, savedPunches);
  const punches = lunchPunchButtons({
    attendanceRequired: !accessLoading && isMorningAttendanceRequiredForRole(access.role),
    loginAt,
    lunchOutAt: lunchTimes.lunchOutAt,
    lunchInAt: lunchTimes.lunchInAt,
  });

  async function readTodayLunchTimes(supabase, userId) {
    const { startIso, endIso } = ksaDayBounds(getKsaDateString());
    const { data, error } = await supabase
      .from("daily_activity_logs")
      .select("entry_type,note,created_at")
      .eq("user_id", userId)
      .in("entry_type", ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN"])
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return extractLunchTimes(data || []);
  }

  function rememberPunch(entryType, savedAt) {
    punchGuardRef.current = completeLunchPunch(punchGuardRef.current, entryType, savedAt);
    setSavedPunches(punchGuardRef.current.saved);
  }

  async function punchLunch(entryType) {
    if (entryType === "LUNCH_BREAK_OUT" && !punches.lunchOutEnabled) return;
    if (entryType === "LUNCH_BREAK_IN" && !punches.lunchInEnabled) return;

    const claim = acceptLunchPunch(punchGuardRef.current, entryType);
    if (!claim.accepted) return;
    punchGuardRef.current = claim.guard;
    setBusy(entryType);
    let saved = false;

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Please login again.");

      const existing = await readTodayLunchTimes(supabase, session.user.id);
      const alreadyAt = entryType === "LUNCH_BREAK_OUT" ? existing.lunchOutAt : existing.lunchInAt;
      if (!alreadyAt) {
        const location = await requireGpsLocation({ role: access.role });
        const platform = await resolveGpsCapturePlatform();
        const note = buildGpsActivityNote(entryType, location, { platform });
        const { error } = await supabase.from("daily_activity_logs").insert({
          user_id: session.user.id,
          entry_type: entryType,
          note,
        });
        if (error) throw error;

        queueTransactionAlert(session.access_token, {
          transactionType: entryType,
          referenceKey: `activity:${session.user.id}:${entryType}:${getKsaDateString()}`,
        });
      }

      rememberPunch(entryType, alreadyAt || new Date().toISOString());
      saved = true;
      notifyWorkdayTimesUpdated();
    } catch {
      showPopup({
        title: language === "ar" ? "الغداء" : "Lunch",
        message: language === "ar" ? TEXT.saveFailed.ar : TEXT.saveFailed.en,
        variant: "error",
      });
    } finally {
      if (!saved) {
        punchGuardRef.current = releaseLunchPunch(punchGuardRef.current);
      }
      setBusy("");
    }
  }

  return (
    <div
      className={`workdayTimesBar${punches.showLunchOut || punches.showLunchIn ? " workdayTimesBar--punches" : ""}`}
      role="status"
      dir={dir}
    >
      <span><strong>{t("login")}:</strong> {loginTime}</span>
      <span className="workdayTimesPunch">
        <strong>{t("lunchOut")}:</strong> {formatKsaTime(lunchTimes.lunchOutAt)}
        {punches.showLunchOut ? (
          <button
            type="button"
            className="workdayTimesPunchButton"
            onClick={() => punchLunch("LUNCH_BREAK_OUT")}
            disabled={!punches.lunchOutEnabled || Boolean(busy)}
          >
            {busy === "LUNCH_BREAK_OUT" ? t("saving") : t("punchLunchOut")}
          </button>
        ) : null}
      </span>
      <span className="workdayTimesPunch">
        <strong>{t("lunchIn")}:</strong> {formatKsaTime(lunchTimes.lunchInAt)}
        {punches.showLunchIn ? (
          <button
            type="button"
            className="workdayTimesPunchButton"
            onClick={() => punchLunch("LUNCH_BREAK_IN")}
            disabled={!punches.lunchInEnabled || Boolean(busy)}
          >
            {busy === "LUNCH_BREAK_IN" ? t("saving") : t("punchLunchIn")}
          </button>
        ) : null}
      </span>
    </div>
  );
}
