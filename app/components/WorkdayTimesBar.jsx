"use client";

import { useState } from "react";
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
import { getKsaDateString, lunchPunchButtons } from "../lib/workdayActivity";

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
    lunchOutTime,
    lunchInTime,
  } = useTodayWorkdayLogs();
  const [busy, setBusy] = useState("");

  if (!signedIn) return null;

  const punches = lunchPunchButtons({
    attendanceRequired: !accessLoading && isMorningAttendanceRequiredForRole(access.role),
    loginAt,
    lunchOutAt,
    lunchInAt,
  });

  async function punchLunch(entryType) {
    if (busy) return;
    if (entryType === "LUNCH_BREAK_OUT" && !punches.lunchOutEnabled) return;
    if (entryType === "LUNCH_BREAK_IN" && !punches.lunchInEnabled) return;

    setBusy(entryType);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Please login again.");

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
      notifyWorkdayTimesUpdated();
    } catch {
      showPopup({
        title: language === "ar" ? "الغداء" : "Lunch",
        message: language === "ar" ? TEXT.saveFailed.ar : TEXT.saveFailed.en,
        variant: "error",
      });
    } finally {
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
        <strong>{t("lunchOut")}:</strong> {lunchOutTime}
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
        <strong>{t("lunchIn")}:</strong> {lunchInTime}
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
