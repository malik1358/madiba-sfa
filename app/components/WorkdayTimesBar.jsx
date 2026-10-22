"use client";

import { useRef, useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useAppPopup } from "./AppPopupProvider";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { useTodayWorkdayLogs } from "../hooks/useTodayWorkdayLogs";
import { insertMorningAttendanceOnce, notifyMorningAttendanceComplete, notifyWorkdayTimesUpdated } from "../lib/morningAttendance";
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
  mergeLunchPunchTimes,
  releaseLunchPunch,
} from "../lib/workdayActivity";

const TEXT = {
  login: { en: "Login", ar: "تسجيل الدخول" },
  lunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  lunchIn: { en: "Lunch in", ar: "عودة الغداء" },
  dayOut: { en: "Out", ar: "خروج" },
  saving: { en: "Saving", ar: "جارٍ الحفظ" },
  saveFailed: {
    en: "Unable to save the punch. Check location access and try again.",
    ar: "تعذر حفظ البصمة. تحقق من إذن الموقع وحاول مرة أخرى.",
  },
};

export default function WorkdayTimesBar() {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const { showPopup } = useAppPopup();
  const { access } = useModuleAccess();
  const {
    signedIn,
    loginAt,
    lunchOutAt,
    lunchInAt,
    endOfDayAt,
    loginTime,
  } = useTodayWorkdayLogs();
  const [busy, setBusy] = useState("");
  const [savedPunches, setSavedPunches] = useState({});
  const punchGuardRef = useRef({ inFlight: false, saved: {} });

  if (!signedIn) return null;

  const lunchTimes = mergeLunchPunchTimes({ lunchOutAt, lunchInAt }, savedPunches);
  const loginDone = Boolean(loginAt || savedPunches.MORNING_ATTENDANCE);
  const lunchOutDone = Boolean(lunchTimes.lunchOutAt);
  const lunchInDone = Boolean(lunchTimes.lunchInAt);
  const dayOutDone = Boolean(endOfDayAt || savedPunches.END_OF_DAY);
  const lunchOutEnabled = loginDone && !lunchOutDone && !dayOutDone;
  const lunchInEnabled = lunchOutDone && !lunchInDone && !dayOutDone;

  function showSaveError() {
    showPopup({
      title: language === "ar" ? "الحضور" : "Attendance",
      message: language === "ar" ? TEXT.saveFailed.ar : TEXT.saveFailed.en,
      variant: "error",
    });
  }

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

  async function claimPunch(entryType) {
    const claim = acceptLunchPunch(punchGuardRef.current, entryType);
    if (!claim.accepted) return false;
    punchGuardRef.current = claim.guard;
    setBusy(entryType);
    return true;
  }

  function finishPunch(saved) {
    if (!saved) {
      punchGuardRef.current = releaseLunchPunch(punchGuardRef.current);
    }
    setBusy("");
  }

  async function punchLunch(entryType) {
    if (entryType === "LUNCH_BREAK_OUT" && !lunchOutEnabled) return;
    if (entryType === "LUNCH_BREAK_IN" && !lunchInEnabled) return;
    if (!(await claimPunch(entryType))) return;
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
      showSaveError();
    } finally {
      finishPunch(saved);
    }
  }

  async function punchDay(entryType) {
    if (entryType === "MORNING_ATTENDANCE" && loginDone) return;
    if (entryType === "END_OF_DAY" && (!loginDone || dayOutDone)) return;
    if (!(await claimPunch(entryType))) return;
    let saved = false;

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Please login again.");

      const location = await requireGpsLocation({ role: access.role });
      const platform = await resolveGpsCapturePlatform();
      const note = buildGpsActivityNote(entryType, location, { platform });

      let insertedFresh = true;
      if (entryType === "MORNING_ATTENDANCE") {
        const result = await insertMorningAttendanceOnce(supabase, session.user.id, note);
        insertedFresh = !result.alreadyExists;
      } else {
        const { error } = await supabase.from("daily_activity_logs").insert({
          user_id: session.user.id,
          entry_type: entryType,
          note,
        });
        if (error) throw error;
      }

      if (insertedFresh) {
        queueTransactionAlert(session.access_token, {
          transactionType: entryType,
          referenceKey: `activity:${session.user.id}:${entryType}:${getKsaDateString()}`,
        });
      }

      rememberPunch(entryType, new Date().toISOString());
      saved = true;
      if (entryType === "MORNING_ATTENDANCE") notifyMorningAttendanceComplete();
      else notifyWorkdayTimesUpdated();
    } catch {
      showSaveError();
    } finally {
      finishPunch(saved);
    }
  }

  return (
    <div className="workdayTimesBar workdayTimesBar--punches" role="status" dir={dir}>
      <span className="workdayTimesPunch">
        <button
          type="button"
          className="workdayTimesPunchButton"
          onClick={() => punchDay("MORNING_ATTENDANCE")}
          disabled={loginDone || Boolean(busy)}
        >
          {busy === "MORNING_ATTENDANCE" ? t("saving") : t("login")}
        </button>
        <strong>{t("login")}:</strong> {loginTime}
      </span>
      <span className="workdayTimesPunch">
        <button
          type="button"
          className="workdayTimesPunchButton"
          onClick={() => punchLunch("LUNCH_BREAK_OUT")}
          disabled={!lunchOutEnabled || Boolean(busy)}
        >
          {busy === "LUNCH_BREAK_OUT" ? t("saving") : t("lunchOut")}
        </button>
        <strong>{t("lunchOut")}:</strong> {formatKsaTime(lunchTimes.lunchOutAt)}
      </span>
      <span className="workdayTimesPunch">
        <button
          type="button"
          className="workdayTimesPunchButton"
          onClick={() => punchLunch("LUNCH_BREAK_IN")}
          disabled={!lunchInEnabled || Boolean(busy)}
        >
          {busy === "LUNCH_BREAK_IN" ? t("saving") : t("lunchIn")}
        </button>
        <strong>{t("lunchIn")}:</strong> {formatKsaTime(lunchTimes.lunchInAt)}
      </span>
      <span className="workdayTimesPunch">
        <button
          type="button"
          className="workdayTimesPunchButton"
          onClick={() => punchDay("END_OF_DAY")}
          disabled={!loginDone || dayOutDone || Boolean(busy)}
        >
          {busy === "END_OF_DAY" ? t("saving") : t("dayOut")}
        </button>
      </span>
    </div>
  );
}
